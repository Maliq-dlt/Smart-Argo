-- A unit can share a product with other pots. Only its current probe and deployment supply trends.
CREATE FUNCTION public.care_unit_device(p_unit uuid, p_product uuid, p_since timestamptz)
RETURNS TABLE(device_id uuid, since_at timestamptz) LANGUAGE plpgsql STABLE ROWS 2 SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT d.id, greatest(p_since, place.start_at, past.ended, moved.measured_at,
    CASE WHEN place.id IS NULL AND last_packet.unit_id IS NULL THEN greatest(d.created_at,u.created_at) END)
  FROM public.device d JOIN public.unit u ON u.id=p_unit AND u.product_id=d.product_id
  LEFT JOIN public.device_placement place ON place.device_id = d.id AND place.end_at IS NULL
  LEFT JOIN LATERAL (SELECT max(pl.end_at) AS ended FROM public.device_placement pl WHERE pl.device_id=d.id) past ON true
  LEFT JOIN LATERAL (
    SELECT t.unit_id, t.measured_at FROM public.telemetry_packet t
    WHERE t.device_id=d.id AND t.measured_at >= greatest(p_since, place.start_at, past.ended) AND t.received_at >= p_since
    ORDER BY t.measured_at DESC, t.id DESC LIMIT 1
  ) last_packet ON true
  LEFT JOIN LATERAL (SELECT max(t.measured_at) AS measured_at FROM public.telemetry_packet t
    WHERE place.id IS NULL AND t.device_id=d.id AND t.unit_id<>p_unit AND t.measured_at >= p_since) moved ON true
  WHERE d.product_id=p_product AND d.status='active'
    AND (place.unit_id=p_unit OR (place.id IS NULL AND (last_packet.unit_id=p_unit OR (last_packet.unit_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.unit other WHERE other.product_id=p_product AND other.id<>p_unit)))))
  ORDER BY (place.id IS NOT NULL) DESC, last_packet.measured_at DESC NULLS LAST, place.start_at DESC, d.id;
END $$;

CREATE FUNCTION public.care_session_error() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN NOT public.current_auth_session() THEN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.')
    WHEN NOT EXISTS(SELECT 1 FROM public.account WHERE auth_user_id=auth.uid()) THEN
      jsonb_build_object('ok',false,'code','account_required','message','Create the account first.') END
$$;

-- Published versions are immutable. Validate and derive the thresholds once when a version is written.
CREATE FUNCTION public.care_profile_limits(parameters jsonb) RETURNS numeric[]
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
  SELECT CASE WHEN parameters->'validated'='true'::jsonb AND public.profile_parameters_valid(parameters) THEN ARRAY[
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n::double precision) FROM jsonb_array_elements_text(parameters->'needs_water') n),
    least(100,10+(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n::double precision) FROM jsonb_array_elements_text(parameters->'drained') n))
  ]::numeric[] END
$$;
ALTER TABLE public.profile_version ADD COLUMN care_limits numeric[]
  GENERATED ALWAYS AS (public.care_profile_limits(parameters_and_scope)) STORED;

-- A pot without a profile validated for it (any species: a curated profile is tied to one pot's sensor calibration)
-- earns its own range only after the Fase 5 thresholds (src/lib/observation.ts THRESHOLDS): 7 days of readings,
-- 3 inspections and 2 measured waterings in the current cycle. Before that, no band, so no forecast, no "below" and
-- no soil_dry mail. The range is then the readings within 6 h after an exact "sehat" visit.
CREATE FUNCTION public.care_band(p_unit uuid,p_version uuid,p_owner uuid,p_device uuid,p_since timestamptz) RETURNS numeric[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE limits numeric[]; cycle_start timestamptz;
BEGIN
  SELECT v.care_limits INTO limits FROM public.profile_version v WHERE v.id=p_version AND v.published_at<=now()
    AND v.provenance IS NOT NULL AND v.parameters_and_scope->>'pot_id'=p_unit::text;
  IF limits IS NOT NULL OR p_device IS NULL THEN RETURN limits; END IF;
  SELECT greatest(p_since,c.created_at) INTO cycle_start FROM public.garden_slot s
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

-- Where a band came from, for the label beside it: 'profile' when care_band used the profile validated for this pot
-- (the same test as its first query), otherwise the pot's own learned pattern. Callers ask only when a band exists.
CREATE FUNCTION public.care_band_source(p_unit uuid,p_version uuid) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.profile_version v WHERE v.id=p_version AND v.published_at<=now()
    AND v.provenance IS NOT NULL AND v.parameters_and_scope->>'pot_id'=p_unit::text AND v.care_limits IS NOT NULL)
    THEN 'profile' ELSE 'own_pattern' END
$$;

-- Optional/legacy fields in the signed JSON must never invalidate an otherwise good soil sample.
CREATE FUNCTION public.care_samples(p_unit uuid, p_device uuid, p_since timestamptz)
RETURNS TABLE(at timestamptz, received timestamptz, moisture numeric, temperature numeric, volts numeric, calibration jsonb)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT t.measured_at, t.received_at,
    CASE WHEN t.clock_status='synced' AND b#>>'{sensors,moisture,status}'='ok' THEN (b#>>'{sensors,moisture,value}')::numeric END,
    CASE WHEN t.clock_status='synced' AND b#>>'{sensors,soil_temperature,status}'='ok' THEN (b#>>'{sensors,soil_temperature,value}')::numeric END,
    CASE WHEN t.clock_status='synced' AND b#>>'{battery,status}'='ok' AND jsonb_typeof(b#>'{battery,value}')='number' THEN
      CASE WHEN (b#>>'{battery,value}')::numeric BETWEEN 2.5 AND 4.5 THEN (b#>>'{battery,value}')::numeric END END,
    CASE WHEN jsonb_typeof(b->'calibration')='object' THEN b->'calibration' END
  FROM public.telemetry_packet t CROSS JOIN LATERAL (SELECT t.payload::jsonb AS b) j
  WHERE t.unit_id=p_unit AND t.device_id=p_device AND t.received_at>=p_since AND t.measured_at>=p_since
    AND t.received_at<=now() AND t.measured_at<=now()
$$;

CREATE FUNCTION public.care_calibration_at(p_value text,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN p_value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
    AND pg_input_is_valid(p_value,'timestamptz') THEN CASE WHEN p_value::timestamptz<=p_at THEN p_value END END
$$;

CREATE FUNCTION public.my_unit_health(p_unit_id uuid, p_days integer DEFAULT 7, p_timezone text DEFAULT 'Asia/Jakarta', p_device_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u public.unit; own public.ownership; probe record; start_day date; since_time timestamptz; facts jsonb;
BEGIN
  facts:=public.care_session_error();
  IF facts IS NOT NULL THEN RETURN facts; END IF;
  SELECT * INTO u FROM public.unit WHERE id=p_unit_id AND archived_at IS NULL;
  SELECT o.* INTO own FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    JOIN public.product p ON p.id=o.product_id AND p.registry_status='active'
    WHERE o.product_id=u.product_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid();
  IF own.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active unit ownership required.');
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 30 OR p_timezone IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Use 1-30 days and an IANA time zone.');
  END IF;
  SELECT * INTO probe FROM public.care_unit_device(u.id,u.product_id,own.start_at) current_probe
    WHERE p_device_id IS NULL OR current_probe.device_id=p_device_id LIMIT 1;
  IF p_device_id IS NOT NULL AND probe.device_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active device deployment required.');
  END IF;
  since_time := greatest(probe.since_at, now()-make_interval(days=>p_days));
  start_day := (now() AT TIME ZONE p_timezone)::date - (p_days-1);
  WITH samples AS MATERIALIZED (SELECT * FROM public.care_samples(u.id,probe.device_id,since_time)),
  arrivals AS (SELECT DISTINCT t.received_at FROM public.telemetry_packet t WHERE t.unit_id=u.id AND t.device_id=probe.device_id
    AND t.received_at BETWEEN since_time AND now() AND t.measured_at>=probe.since_at),
  cells AS (SELECT at,volts,lag(at) OVER w AS prev_at,lag(volts) OVER w AS prev_volts FROM samples WINDOW w AS (ORDER BY at)),
  -- ESP32 ADC noise moves a resting cell by tens of mV, so only a rise above 0.05 V counts as charging.
  -- ponytail: endpoint slope; a slow solar trickle under 0.05 V a step reads as a gentler discharge.
  discharge AS (SELECT * FROM cells WHERE at >= (
    SELECT max(at) FROM cells WHERE volts IS NULL OR prev_volts IS NULL OR volts>prev_volts+0.05 OR at-prev_at>interval '2 hours' OR at=prev_at)),
  battery_trend AS (SELECT count(volts) AS n,min(at) AS first,max(at) AS last,
    (array_agg(volts ORDER BY at))[1] AS initial,(array_agg(volts ORDER BY at DESC))[1] AS latest FROM discharge),
  boundaries AS (SELECT since_time AS at UNION SELECT received_at FROM arrivals UNION SELECT now()),
  gaps AS (SELECT at AS finish,lag(at) OVER (ORDER BY at) AS start FROM boundaries),
  days AS (
    SELECT (e.start_at AT TIME ZONE p_timezone)::date AS day, sum(e.solar_end_wh-e.solar_start_wh) AS solar_wh,
      sum(e.load_end_wh-e.load_start_wh) AS load_wh, count(*) AS windows
    FROM public.energy_window e
    WHERE e.ownership_id=own.id AND e.device_id=probe.device_id AND e.evidence_quality='verified_meter'
      AND e.start_at>=greatest(probe.since_at,start_day::timestamp AT TIME ZONE p_timezone) AND e.end_at<=now()
      AND (EXISTS (SELECT 1 FROM public.device_placement pl WHERE pl.device_id=e.device_id AND pl.unit_id=u.id
        AND pl.start_at<=e.start_at AND (pl.end_at IS NULL OR pl.end_at>=e.end_at))
        OR NOT EXISTS (SELECT 1 FROM public.unit sibling WHERE sibling.product_id=u.product_id AND sibling.id<>u.id))
    GROUP BY 1
  )
  SELECT jsonb_build_object('ok',true,'unit_id',u.id,'device_id',probe.device_id,'checked_at',now(),'timezone',p_timezone,
    'battery',coalesce((SELECT jsonb_agg(jsonb_build_object('at',at,'volts',volts) ORDER BY at) FROM samples WHERE volts IS NOT NULL),'[]'),
    'packets',coalesce((SELECT jsonb_agg(received_at ORDER BY received_at) FROM arrivals),'[]'),
    'battery_days_left',(SELECT CASE WHEN n>=12 AND last-first>=interval '24 hours' AND last>=now()-interval '75 minutes'
      AND initial>latest THEN round(greatest(0,latest-3.4)*extract(epoch FROM last-first)/86400/(initial-latest),1) END FROM battery_trend),
    'upload_gaps',coalesce((SELECT jsonb_agg(jsonb_build_object('from',start,'to',finish,'ongoing',finish=now()) ORDER BY start)
      FROM gaps WHERE probe.device_id IS NOT NULL AND finish-start>interval '90 minutes'),'[]'),
    'energy_days',coalesce((SELECT jsonb_agg(to_jsonb(days) ORDER BY day) FROM days),'[]'),
    'calibration',(SELECT jsonb_build_object('moisture_at',public.care_calibration_at(c->>'moisture_at',at),'ph_at',public.care_calibration_at(c->>'ph_at',at)) FROM (
      SELECT t.payload::jsonb->'calibration' AS c,t.measured_at AS at FROM public.telemetry_packet t
      WHERE t.unit_id=u.id AND t.device_id=probe.device_id AND t.received_at>=own.start_at
        AND t.measured_at>=probe.since_at AND t.measured_at<=now() AND t.payload::jsonb ? 'calibration'
      ORDER BY t.measured_at DESC,t.id DESC LIMIT 1) latest)
  ) INTO facts;
  RETURN facts;
END $$;
REVOKE ALL ON FUNCTION public.care_unit_device(uuid,uuid,timestamptz), public.care_profile_limits(jsonb), public.care_session_error(),
  public.care_band(uuid,uuid,uuid,uuid,timestamptz),public.care_band_source(uuid,uuid),public.care_samples(uuid,uuid,timestamptz), public.care_calibration_at(text,timestamptz), public.my_unit_health(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_unit_health(uuid,integer,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.care_profile_limits(jsonb) TO service_role;
