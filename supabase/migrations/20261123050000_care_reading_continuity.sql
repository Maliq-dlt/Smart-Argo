-- A new moisture calibration changes the meaning of the index. Older samples
-- stay in history, but cannot establish a band, slope, or inferred watering on the new scale.
-- care_unit_device looks up the newest packet for every device before loading the garden.
CREATE INDEX care_device_latest_packet ON public.telemetry_packet(device_id,measured_at DESC,id DESC)
  INCLUDE (unit_id,received_at);

CREATE INDEX care_moisture_calibrations ON public.telemetry_packet(unit_id,device_id,measured_at DESC)
  WHERE clock_status='synced' AND payload IS JSON OBJECT AND payload::jsonb#>>'{calibration,moisture_at}' IS NOT NULL;

-- plpgsql, not sql: a SQL function with SET search_path is never inlined and was planned on every call (about 2 ms
-- against 0.05 ms to run, twice per pot), which doubled my_overview. plpgsql keeps the plan for the session.
CREATE FUNCTION public.care_moisture_since(p_unit uuid,p_device uuid,p_since timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE STRICT SET search_path='' AS $$
DECLARE stamp text; stamped_at timestamptz;
BEGIN
  SELECT t.payload::jsonb#>>'{calibration,moisture_at}',t.measured_at INTO stamp,stamped_at
    FROM public.telemetry_packet t
    WHERE t.unit_id=p_unit AND t.device_id=p_device AND t.clock_status='synced' AND t.payload IS JSON OBJECT
      AND t.payload::jsonb#>>'{calibration,moisture_at}' IS NOT NULL AND t.measured_at BETWEEN p_since AND now()
      AND t.received_at BETWEEN p_since AND now() ORDER BY t.measured_at DESC,t.id DESC LIMIT 1;
  RETURN greatest(p_since,public.care_calibration_at(stamp,stamped_at)::timestamptz);
END $$;
REVOKE ALL ON FUNCTION public.care_moisture_since(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.care_band(p_unit uuid,p_version uuid,p_owner uuid,p_device uuid,p_since timestamptz) RETURNS numeric[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE limits numeric[]; cycle_start timestamptz;
BEGIN
  SELECT v.care_limits INTO limits FROM public.profile_version v WHERE v.id=p_version AND v.published_at<=now()
    AND v.provenance IS NOT NULL AND v.parameters_and_scope->>'pot_id'=p_unit::text;
  IF limits IS NOT NULL OR p_device IS NULL THEN RETURN limits; END IF;
  SELECT greatest(public.care_moisture_since(p_unit,p_device,p_since),c.created_at) INTO cycle_start FROM public.garden_slot s
    JOIN public.plant_cycle c ON c.slot_id=s.id AND c.ended_on IS NULL
    JOIN public.ownership o ON o.id=p_owner AND o.account_id=s.account_id
    WHERE s.unit_id=p_unit;
  IF cycle_start IS NULL THEN RETURN NULL; END IF;
  WITH readings AS MATERIALIZED (
    SELECT m.measured_at AS at, m.value_nullable AS value
    FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.unit_id=p_unit AND m.device_id=p_device AND m.source='device' AND m.sensor_id='moisture' AND m.quality_status='ok'
      AND t.clock_status='synced' AND m.measured_at>=cycle_start AND m.received_at>=p_since AND m.measured_at<=now()
  ), visits AS MATERIALIZED (
    SELECT j.kind, j.observed_at AS at, lower(j.notes) AS note FROM public.care_journal j
    WHERE j.ownership_id=p_owner AND j.unit_id=p_unit AND j.kind IN ('inspection','watering')
      AND j.observed_at BETWEEN cycle_start AND now()
  )
  SELECT ARRAY[floor(min(r.value)),ceil(max(r.value))]::numeric[] INTO limits FROM readings r
  WHERE EXISTS (SELECT 1 FROM visits v WHERE v.kind='inspection' AND v.note='sehat' AND r.at BETWEEN v.at AND v.at+interval '6 hours')
    AND (SELECT max(at)-min(at) FROM readings)>=interval '7 days'
    AND (SELECT count(*) FROM visits WHERE kind='inspection')>=3
    AND (SELECT count(*) FROM visits w WHERE w.kind='watering'  -- measured: a reading 2 h before and one 3 h after
      AND EXISTS (SELECT 1 FROM readings b WHERE b.at BETWEEN w.at-interval '2 hours' AND w.at)
      AND EXISTS (SELECT 1 FROM readings a WHERE a.at>w.at AND a.at<=w.at+interval '3 hours'))>=2
  HAVING count(DISTINCT r.at)>=3;
  RETURN limits;
END
$$;

CREATE OR REPLACE FUNCTION public.care_water_analysis(p_unit uuid,p_device uuid,p_since timestamptz,p_owner uuid,p_band numeric[],
  p_days integer,p_zone text DEFAULT 'Asia/Jakarta')
RETURNS TABLE(moisture numeric, measured_at timestamptz, outlook jsonb, rises jsonb)
LANGUAGE plpgsql STABLE ROWS 1 SET search_path='' AS $$
DECLARE r record; prev numeric; prev_at timestamptz; hours numeric; rise_start timestamptz; rise_base numeric;
  watering timestamptz; first_valid timestamptz; below_since timestamptz; n int:=0; falling int:=0; loss numeric:=0; elapsed_hours numeric:=0; pairs int:=0;
  rate numeric; eta numeric; lo timestamptz; hi timestamptz; state text; consecutive boolean; rising boolean;
BEGIN
  p_since:=public.care_moisture_since(p_unit,p_device,p_since);
  rises:='[]';
  SELECT max(j.observed_at) INTO watering FROM public.care_journal j WHERE j.ownership_id=p_owner
    AND j.unit_id=p_unit AND j.kind='watering' AND j.observed_at<=now();
  FOR r IN
    WITH uncertain AS MATERIALIZED (
      SELECT t.id FROM public.telemetry_packet t WHERE t.unit_id=p_unit AND t.device_id=p_device AND t.clock_status='unsynced'
        AND t.measured_at BETWEEN greatest(p_since,now()-make_interval(days=>p_days)) AND now()
    ), samples AS MATERIALIZED (
      SELECT m.measured_at AS at, CASE WHEN count(*)=1 AND bool_and(m.packet_id NOT IN (SELECT id FROM uncertain))
        THEN min(m.value_nullable)::numeric END AS value
      FROM public.measurement m
      WHERE m.unit_id=p_unit AND m.device_id=p_device AND m.sensor_id='moisture' AND m.source='device' AND m.packet_id IS NOT NULL
        AND m.measured_at BETWEEN greatest(p_since,now()-make_interval(days=>p_days)) AND now()
        AND m.received_at BETWEEN p_since AND now()
      GROUP BY m.measured_at
    ), bounds AS MATERIALIZED (  -- inlined, the planner reran this aggregate once per sample (O(n²), 2 s per overview)
      SELECT min(at) FILTER(WHERE value IS NOT NULL) AS oldest,
        -- After a single jump of five points, earlier pairs cannot affect the drying rate.
        CASE WHEN (SELECT value FROM samples ORDER BY at DESC LIMIT 1)>p_band[1] THEN
          max(before_at) FILTER (WHERE value-before_value>=5 AND at-before_at<=interval '2 hours') END AS cutoff
      FROM (SELECT *,lag(at) OVER w AS before_at,lag(value) OVER w AS before_value FROM samples WINDOW w AS (ORDER BY at)) pairs
    )
    SELECT s.*,b.oldest FROM samples s CROSS JOIN bounds b WHERE b.cutoff IS NULL OR s.at>=b.cutoff ORDER BY s.at
  LOOP
    first_valid:=r.oldest;
    hours:=extract(epoch FROM r.at-prev_at)/3600;
    consecutive:=coalesce(prev IS NOT NULL AND r.value IS NOT NULL AND hours>0 AND hours<=2,false);
    rising:=consecutive AND r.value>prev;
    IF NOT rising AND rise_start IS NOT NULL THEN
      IF prev-rise_base>=5 THEN rises:=rises||jsonb_build_object('from',rise_start,'to',prev_at,'delta',prev-rise_base); END IF;
      rise_start:=NULL;
    END IF;
    IF rising AND rise_start IS NULL THEN rise_start:=prev_at; rise_base:=prev; END IF;
    IF NOT consecutive OR (rising AND r.value-rise_base>=5) OR (prev_at<watering AND r.at>=watering) THEN
      n:=0; falling:=0; loss:=0; elapsed_hours:=0; pairs:=0;
    END IF;
    IF r.value<=p_band[1] THEN
      IF NOT consecutive OR below_since IS NULL THEN below_since:=r.at; END IF;
    ELSE below_since:=NULL; END IF;
    IF n>0 THEN
      -- Falls since the series began. A noisy flat step must not switch the forecast off for half an hour.
      IF r.value<prev THEN falling:=falling+1; END IF;
      IF hours<=1.5 AND r.value<=prev+0.5 AND extract(hour FROM prev_at AT TIME ZONE p_zone) BETWEEN 8 AND 16
        AND extract(hour FROM r.at AT TIME ZONE p_zone) BETWEEN 8 AND 16 THEN
        loss:=loss+prev-r.value; elapsed_hours:=elapsed_hours+hours; pairs:=pairs+1;
      END IF;
    END IF;
    IF r.value IS NOT NULL AND NOT (rising AND r.value-rise_base>=5) THEN n:=n+1; END IF;
    prev:=r.value; prev_at:=r.at;
  END LOOP;
  IF rise_start IS NOT NULL AND prev-rise_base>=5 THEN
    rises:=rises||jsonb_build_object('from',rise_start,'to',prev_at,'delta',prev-rise_base);
  END IF;
  moisture:=CASE WHEN prev_at>=now()-interval '75 minutes' THEN prev END;
  measured_at:=prev_at;
  state:=CASE WHEN p_band IS NULL THEN 'learning' ELSE 'waiting' END;
  -- A fresh reading at or under the band is a fact; only the projection needs a long, unbroken series.
  IF moisture<=p_band[1] AND (watering IS NULL OR watering<=prev_at) THEN
    state:='below'; lo:=now(); hi:=lo;
  ELSIF p_band IS NOT NULL AND moisture IS NOT NULL AND n>=6 AND (watering IS NULL OR watering<=prev_at)
    AND prev_at-first_valid>=interval '24 hours' THEN
    IF pairs>=2 AND falling>=2 THEN rate:=round(loss/elapsed_hours,2); END IF;
    IF rate>0 THEN
      state:='window'; eta:=(moisture-p_band[1])/rate;
      lo:=greatest(now(),to_timestamp((round((extract(epoch FROM prev_at)/3600+eta*.75)*2)*1800)::double precision));
      hi:=greatest(now(),to_timestamp((round((extract(epoch FROM prev_at)/3600+eta*1.25)*2)*1800)::double precision));
    END IF;
  END IF;
  outlook:=jsonb_build_object('state',state,'since',CASE WHEN state='below' THEN coalesce(below_since,prev_at) END,
    'from',lo,'to',hi,'rate_per_hour',CASE WHEN rate>0 THEN rate END,'band',p_band);
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.care_alert_signals(p_unit uuid,p_device uuid,p_since timestamptz,p_low double precision)
RETURNS TABLE(kind text,bad_at timestamptz,good_at timestamptz) LANGUAGE sql STABLE SET search_path='' AS $$
  WITH calibration AS MATERIALIZED (SELECT public.care_moisture_since(p_unit,p_device,p_since) AS since_at),
  samples AS MATERIALIZED (SELECT * FROM public.care_samples(p_unit,p_device,greatest(p_since,now()-interval '48 hours'))),
  -- `good` is what counts toward recovery. A battery on a solar panel dips under 3.4 V at night and charges by day, so it
  -- recovers only at 3.6 V or more after 24 h without a low reading: one episode, one mail, until a healthy day.
  -- ponytail: 3.6 V and 24 h are engineering hysteresis for one Li-ion cell, not measured; revisit after the bench test.
  readings AS (SELECT at, v.kind, v.bad, v.good FROM samples CROSS JOIN calibration CROSS JOIN LATERAL (VALUES
    ('soil_dry',moisture<=p_low,moisture>p_low),('battery_low',volts<3.4,volts>=3.6),
    ('soil_hot',temperature>=35,temperature<35)) v(kind,bad,good) WHERE v.kind<>'soil_dry' OR at>=calibration.since_at),
  pairs AS (SELECT *, lag(bad) OVER w AS prev_bad, lag(good) OVER w AS prev_good, lag(at) OVER w AS prev_at FROM readings
    WINDOW w AS (PARTITION BY kind ORDER BY at)),
  runs AS (SELECT *, max(at) FILTER (WHERE bad IS DISTINCT FROM prev_bad OR prev_at IS NULL
      OR at-prev_at>interval '75 minutes' OR at=prev_at) OVER (PARTITION BY kind ORDER BY at) AS run_start,
    max(at) FILTER (WHERE bad) OVER (PARTITION BY kind ORDER BY at) AS last_bad FROM pairs),
  arrivals AS (SELECT DISTINCT t.received_at AS received FROM public.telemetry_packet t
    WHERE t.device_id=p_device AND t.unit_id=p_unit AND t.measured_at>=p_since
      AND t.received_at BETWEEN greatest(p_since,now()-interval '48 hours') AND now()),
  links AS (SELECT received,lag(received) OVER (ORDER BY received) AS prev FROM arrivals),
  last_upload AS (SELECT (SELECT max(t.received_at) FROM public.telemetry_packet t
    WHERE t.device_id=p_device AND t.unit_id=p_unit AND t.measured_at>=p_since AND t.received_at BETWEEN p_since AND now()) AS at)
  SELECT kind,
    max(at) FILTER (WHERE bad AND at >= now()-interval '75 minutes' AND
      (kind='battery_low' OR (kind='soil_dry' AND prev_bad AND at>prev_at AND at-prev_at<=interval '75 minutes')
       OR (kind='soil_hot' AND at-run_start>=interval '3 hours'))),
    max(at) FILTER (WHERE good AND prev_good AND at>prev_at AND at-prev_at<=interval '75 minutes'
      AND (kind<>'battery_low' OR last_bad IS NULL OR at-last_bad>=interval '24 hours'))
  FROM runs GROUP BY kind
  UNION ALL
  SELECT 'device_silent', CASE WHEN now()-at>interval '90 minutes' THEN at+interval '90 minutes' END,
    (SELECT max(received) FROM links WHERE received-prev<=interval '90 minutes') FROM last_upload
$$;

CREATE OR REPLACE FUNCTION public.my_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET jit=off AS $$
DECLARE denied jsonb:=public.care_session_error(); aid uuid; result jsonb;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid();
  WITH owned AS MATERIALIZED (
    SELECT o.id,o.product_id,o.start_at FROM public.ownership o JOIN public.product p ON p.id=o.product_id
    WHERE o.account_id=aid AND o.end_at IS NULL AND p.registry_status='active'
  ), units AS MATERIALIZED (
    SELECT u.id,u.profile_version_id,o.id AS ownership_id,o.product_id,o.start_at FROM owned o JOIN public.unit u
      ON u.product_id=o.product_id AND u.archived_at IS NULL
  ), deployed AS MATERIALIZED (
    SELECT u.*,d.device_id,d.since_at,d.priority FROM units u
    CROSS JOIN LATERAL public.care_unit_device(u.id,u.product_id,u.start_at) WITH ORDINALITY d(device_id,since_at,priority)
  ), plant_rows AS (
    SELECT c.nickname AS name,c.species_id,site.name AS place,s.id AS slot_id,u.id AS unit_id,c.created_at,
      (ARRAY['CB','BM','AB','PN'])[c.species_id] || '-' || c.plant_no AS tag,
      w.moisture,w.measured_at,b.band,b.source AS band_source,
      CASE WHEN d.device_id IS NULL THEN 'no_device'
        WHEN w.moisture IS NULL THEN 'no_reading' WHEN b.band IS NULL THEN 'learning'
        WHEN w.moisture<=b.band[1] THEN 'below' WHEN w.moisture>=b.band[2] THEN 'above' ELSE 'ok' END AS state,
      CASE WHEN d.device_id IS NOT NULL THEN w.outlook||jsonb_build_object('band_source',b.source) END AS outlook
    FROM public.plant_cycle c JOIN public.garden_slot s ON s.id=c.slot_id AND s.account_id=aid
    JOIN public.garden_site site ON site.id=s.site_id AND site.account_id=aid
    LEFT JOIN units u ON u.id=s.unit_id
    LEFT JOIN deployed d ON d.id=u.id AND d.priority=1
    LEFT JOIN LATERAL (SELECT x.band,CASE WHEN x.band IS NOT NULL THEN public.care_band_source(u.id,u.profile_version_id) END AS source
      FROM (SELECT public.care_band(u.id,u.profile_version_id,u.ownership_id,d.device_id,d.since_at) AS band OFFSET 0) x) b ON d.device_id IS NOT NULL
    LEFT JOIN LATERAL public.care_water_analysis(u.id,d.device_id,d.since_at,u.ownership_id,b.band,7) w ON d.device_id IS NOT NULL
    WHERE c.account_id=aid AND c.ended_on IS NULL
  ), issues AS (
    SELECT d.id AS unit_id,d.device_id,v.kind,v.since,v.detail FROM deployed d
    LEFT JOIN LATERAL (SELECT t.measured_at,s.volts FROM public.telemetry_packet t
      CROSS JOIN LATERAL (SELECT CASE WHEN t.clock_status='synced' AND t.payload::jsonb#>>'{battery,status}'='ok'
        AND jsonb_typeof(t.payload::jsonb#>'{battery,value}')='number' THEN (t.payload::jsonb#>>'{battery,value}')::numeric END AS volts) s
      WHERE t.unit_id=d.id AND t.device_id=d.device_id AND t.measured_at BETWEEN greatest(d.since_at,now()-interval '75 minutes') AND now()
        AND t.received_at>=d.since_at ORDER BY t.measured_at DESC,t.id DESC LIMIT 1) cell ON true
    LEFT JOIN LATERAL (SELECT max(t.received_at) AS at FROM public.telemetry_packet t
      WHERE t.device_id=d.device_id AND t.unit_id=d.id AND t.measured_at>=d.since_at AND t.received_at>=d.since_at) receipt ON true
    -- One recovered gap is history (my_unit_health.upload_gaps); queued readings arrive after it anyway.
    -- Three in seven days point at weak Wi-Fi where the pot stands, which the owner can act on.
    LEFT JOIN LATERAL (SELECT count(*) AS n,min(prev) AS prev,max(at) AS at FROM (
      SELECT received_at AS at,lag(received_at) OVER(ORDER BY received_at) AS prev FROM public.telemetry_packet t
      WHERE t.unit_id=d.id AND t.device_id=d.device_id AND t.measured_at>=d.since_at
        AND t.received_at>=greatest(d.since_at,now()-interval '7 days')) times
      WHERE at-prev>interval '90 minutes') gap ON true
    CROSS JOIN LATERAL (VALUES
      ('battery_low',cell.measured_at,jsonb_build_object('volts',cell.volts),cell.volts>=2.5 AND cell.volts<3.4),
      ('silent',receipt.at,jsonb_build_object('last_upload',receipt.at),
        receipt.at<now()-interval '90 minutes'),
      ('gap',gap.prev,jsonb_build_object('count',gap.n,'last_resumed_at',gap.at),gap.n>=3)
    ) v(kind,since,detail,active) WHERE v.active
  )
  SELECT jsonb_build_object('ok',true,'plants',coalesce((SELECT jsonb_agg(to_jsonb(r)-'created_at' ORDER BY r.created_at,r.slot_id) FROM plant_rows r),'[]'),
    'devices',jsonb_build_object('total',(SELECT count(*) FROM owned o JOIN public.device d ON d.product_id=o.product_id WHERE d.status<>'revoked'),
    'issues',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.unit_id,i.device_id,i.kind) FROM issues i),'[]'))) INTO result;
  RETURN result;
END $$;
