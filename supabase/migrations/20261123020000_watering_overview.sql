CREATE TABLE public.dismissed_rise (
  ownership_id uuid NOT NULL REFERENCES public.ownership(id),
  unit_id uuid NOT NULL REFERENCES public.unit(id),
  device_id uuid NOT NULL REFERENCES public.device(id),
  at timestamptz NOT NULL,
  PRIMARY KEY(ownership_id,unit_id,device_id,at)
);
ALTER TABLE public.dismissed_rise ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dismissed_rise FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.care_owned_unit(p_unit uuid) RETURNS TABLE(ownership_id uuid, product_id uuid, version_id uuid, start_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT o.id,u.product_id,u.profile_version_id,o.start_at FROM public.unit u
  JOIN public.ownership o ON o.product_id=u.product_id AND o.end_at IS NULL
  JOIN public.account a ON a.id=o.account_id AND a.auth_user_id=auth.uid()
  JOIN public.product p ON p.id=u.product_id AND p.registry_status='active'
  WHERE u.id=p_unit AND u.archived_at IS NULL
$$;

-- garden_slot.unit_id was reserved when the garden was introduced. Serialize assignment per owner.
CREATE UNIQUE INDEX garden_slot_assigned_unit ON public.garden_slot(account_id,unit_id) WHERE unit_id IS NOT NULL;
CREATE FUNCTION public.set_my_slot_unit(p_slot_id uuid,p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE denied jsonb:=public.care_session_error(); aid uuid; locked record;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO locked FROM public.lock_my_unit(p_unit_id);
    IF locked.account_id IS NULL OR (locked.unit).archived_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'code','unit_unavailable'); END IF;
  END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.garden_slot WHERE id=p_slot_id AND account_id=aid) THEN
    RETURN jsonb_build_object('ok',false,'code','slot_unavailable'); END IF;
  IF EXISTS(SELECT 1 FROM public.garden_slot WHERE account_id=aid AND unit_id=p_unit_id AND id<>p_slot_id) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_already_assigned'); END IF;
  UPDATE public.garden_slot SET unit_id=p_unit_id WHERE id=p_slot_id AND account_id=aid;
  RETURN jsonb_build_object('ok',true,'slot_id',p_slot_id,'unit_id',p_unit_id);
END $$;

-- Every accepted device packet writes one moisture measurement, including sensor errors.
CREATE INDEX care_moisture_history ON public.measurement(unit_id,device_id,measured_at)
  INCLUDE (packet_id,received_at,value_nullable) WHERE sensor_id='moisture' AND source='device' AND packet_id IS NOT NULL;
CREATE INDEX care_unsynced_packets ON public.telemetry_packet(unit_id,device_id,id) WHERE clock_status='unsynced';

-- One ordered pass over one deployment. Invalid readings and gaps cut both trends; a rise never writes a journal.
CREATE FUNCTION public.care_water_analysis(p_unit uuid,p_device uuid,p_since timestamptz,p_owner uuid,p_band numeric[],
  p_days integer,p_zone text DEFAULT 'Asia/Jakarta')
RETURNS TABLE(moisture numeric, measured_at timestamptz, outlook jsonb, rises jsonb)
LANGUAGE plpgsql STABLE ROWS 1 SET search_path='' AS $$
DECLARE r record; prev numeric; prev_at timestamptz; hours numeric; rise_start timestamptz; rise_base numeric;
  watering timestamptz; first_valid timestamptz; below_since timestamptz; n int:=0; falling int:=0; rate_sum numeric:=0; pairs int:=0;
  rate numeric; eta numeric; lo timestamptz; hi timestamptz; state text; consecutive boolean; rising boolean;
BEGIN
  rises:='[]';
  SELECT max(j.observed_at) INTO watering FROM public.care_journal j WHERE j.ownership_id=p_owner
    AND j.unit_id=p_unit AND j.kind='watering' AND j.observed_at<=now();
  FOR r IN
    WITH samples AS MATERIALIZED (
      SELECT m.measured_at AS at, CASE WHEN count(*)=1 AND count(unsynced.id)=0 THEN min(m.value_nullable)::numeric END AS value
      FROM public.measurement m LEFT JOIN public.telemetry_packet unsynced ON unsynced.unit_id=p_unit
        AND unsynced.device_id=p_device AND unsynced.clock_status='unsynced' AND unsynced.id=m.packet_id
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
      n:=0; falling:=0; rate_sum:=0; pairs:=0;
    END IF;
    IF r.value<=p_band[1] THEN
      IF NOT consecutive OR below_since IS NULL THEN below_since:=r.at; END IF;
    ELSE below_since:=NULL; END IF;
    IF n>0 THEN
      -- Falls since the series began. A noisy flat step must not switch the forecast off for half an hour.
      IF r.value<prev THEN falling:=falling+1; END IF;
      IF hours<=1.5 AND r.value<=prev+0.5 AND extract(hour FROM prev_at AT TIME ZONE p_zone) BETWEEN 8 AND 16
        AND extract(hour FROM r.at AT TIME ZONE p_zone) BETWEEN 8 AND 16 THEN
        rate_sum:=rate_sum+(prev-r.value)/hours; pairs:=pairs+1;
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
    IF pairs>=2 AND falling>=2 THEN rate:=round(rate_sum/pairs,2); END IF;
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

CREATE FUNCTION public.my_watering_outlook(p_unit_id uuid,p_timezone text DEFAULT 'Asia/Jakarta') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE denied jsonb:=public.care_session_error(); owned record; probe record; band numeric[]; result jsonb;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  SELECT * INTO owned FROM public.care_owned_unit(p_unit_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable'); END IF;
  IF p_timezone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  SELECT * INTO probe FROM public.care_unit_device(p_unit_id,owned.product_id,owned.start_at) LIMIT 1;
  band:=public.care_band(p_unit_id,owned.version_id,owned.ownership_id,probe.device_id,probe.since_at);
  SELECT w.outlook INTO result FROM public.care_water_analysis(p_unit_id,probe.device_id,probe.since_at,owned.ownership_id,band,7,p_timezone) w;
  result:=result||jsonb_build_object('band_source',CASE WHEN band IS NOT NULL THEN public.care_band_source(p_unit_id,owned.version_id) END);
  RETURN jsonb_build_object('ok',true,'outlook',result);
END $$;

CREATE FUNCTION public.my_unlogged_rises(p_unit_id uuid,p_days int DEFAULT 3) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE denied jsonb:=public.care_session_error(); owned record; probe record; events jsonb;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 30 THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  SELECT * INTO owned FROM public.care_owned_unit(p_unit_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable'); END IF;
  SELECT * INTO probe FROM public.care_unit_device(p_unit_id,owned.product_id,owned.start_at) LIMIT 1;
  SELECT coalesce(jsonb_agg(e ORDER BY e->>'to'),'[]') INTO events
  FROM public.care_water_analysis(p_unit_id,probe.device_id,probe.since_at,owned.ownership_id,NULL,p_days) w,
    LATERAL jsonb_array_elements(w.rises) e
  WHERE NOT EXISTS (SELECT 1 FROM public.dismissed_rise d WHERE d.ownership_id=owned.ownership_id AND d.unit_id=p_unit_id
        AND d.device_id=probe.device_id AND d.at BETWEEN (e->>'from')::timestamptz AND (e->>'to')::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM public.care_journal j WHERE j.ownership_id=owned.ownership_id AND j.unit_id=p_unit_id AND j.kind='watering'
        AND j.observed_at BETWEEN (e->>'from')::timestamptz-interval '2 hours' AND (e->>'to')::timestamptz+interval '2 hours');
  RETURN jsonb_build_object('ok',true,'rises',events);
END $$;

CREATE FUNCTION public.dismiss_my_rise(p_unit_id uuid,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE denied jsonb:=public.care_session_error(); owned record; probe record;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  IF p_at IS NULL OR NOT isfinite(p_at) OR p_at>now() THEN RETURN jsonb_build_object('ok',false,'code','invalid_request'); END IF;
  PERFORM public.lock_my_unit(p_unit_id);
  SELECT * INTO owned FROM public.care_owned_unit(p_unit_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable'); END IF;
  SELECT * INTO probe FROM public.care_unit_device(p_unit_id,owned.product_id,owned.start_at) LIMIT 1;
  IF EXISTS(SELECT 1 FROM public.dismissed_rise WHERE ownership_id=owned.ownership_id AND unit_id=p_unit_id AND device_id=probe.device_id AND at=p_at)
    THEN RETURN jsonb_build_object('ok',true); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.care_water_analysis(p_unit_id,probe.device_id,probe.since_at,owned.ownership_id,NULL,30) w,
      LATERAL jsonb_array_elements(w.rises) e WHERE (e->>'to')::timestamptz=p_at OR (
        p_at BETWEEN (e->>'from')::timestamptz AND (e->>'to')::timestamptz AND EXISTS (
          SELECT 1 FROM public.measurement first_reading JOIN public.measurement chosen
            ON chosen.unit_id=first_reading.unit_id AND chosen.device_id=first_reading.device_id
          WHERE first_reading.unit_id=p_unit_id AND first_reading.device_id=probe.device_id
            AND first_reading.sensor_id='moisture' AND chosen.sensor_id='moisture'
            AND first_reading.source='device' AND chosen.source='device' AND first_reading.packet_id IS NOT NULL AND chosen.packet_id IS NOT NULL
            AND first_reading.measured_at=(e->>'from')::timestamptz AND chosen.measured_at=p_at
            AND chosen.value_nullable-first_reading.value_nullable>=5))) THEN
    RETURN jsonb_build_object('ok',false,'code','rise_unavailable'); END IF;
  INSERT INTO public.dismissed_rise VALUES(owned.ownership_id,p_unit_id,probe.device_id,p_at) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.purge_alert_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  DELETE FROM public.dismissed_rise d USING public.ownership o WHERE o.id=d.ownership_id AND o.account_id=NEW.account_id;
  DELETE FROM public.alert_preference WHERE account_id=NEW.account_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.care_owned_unit(uuid),public.set_my_slot_unit(uuid,uuid),
 public.care_water_analysis(uuid,uuid,timestamptz,uuid,numeric[],integer,text),public.my_watering_outlook(uuid,text),
 public.my_unlogged_rises(uuid,integer),public.dismiss_my_rise(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_slot_unit(uuid,uuid),public.my_watering_outlook(uuid,text),public.my_unlogged_rises(uuid,integer),
  public.dismiss_my_rise(uuid,timestamptz) TO authenticated;
