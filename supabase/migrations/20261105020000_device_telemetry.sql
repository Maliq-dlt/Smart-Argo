-- Phase 2: signed device telemetry, separate from synthetic simulator samples.
CREATE TABLE public.telemetry_packet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.unit(id) ON DELETE RESTRICT,
  boot_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  clock_status text NOT NULL CHECK (clock_status IN ('synced','unsynced')),
  measured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload text NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 4096),
  payload_sha256 text NOT NULL,
  signature text NOT NULL,
  UNIQUE(device_id,boot_id,sequence)
);
CREATE INDEX telemetry_packet_rate ON public.telemetry_packet(device_id,received_at);
ALTER TABLE public.measurement ADD COLUMN packet_id uuid REFERENCES public.telemetry_packet(id) ON DELETE RESTRICT;
ALTER TABLE public.measurement ADD COLUMN sensor_id text CHECK (sensor_id IN ('moisture','soil_temperature','soil_ph'));
ALTER TABLE public.measurement ADD COLUMN error_message text CHECK (length(error_message) BETWEEN 1 AND 240);
CREATE UNIQUE INDEX measurement_packet_sensor ON public.measurement(packet_id,sensor_id);
ALTER TABLE public.telemetry_packet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telemetry_packet, public.unit, public.measurement FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.telemetry_packet TO service_role;
GRANT SELECT ON public.unit,public.measurement TO authenticated;
CREATE POLICY phase2_unit_read ON public.unit FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND product_id IN (SELECT product_id FROM public.ownership WHERE end_at IS NULL)
);
CREATE POLICY phase2_measurement_read ON public.measurement FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND EXISTS (
    SELECT 1 FROM public.unit u JOIN public.ownership o ON o.product_id=u.product_id
      JOIN public.account a ON a.id=o.account_id
    WHERE u.id=measurement.unit_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid()
      AND measurement.measured_at>=o.start_at AND measurement.received_at>=o.start_at
  )
);
-- Packet payload and signature have no browser SELECT grant; metadata is returned by RPC.
CREATE FUNCTION public.telemetry_packet_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,public,extensions AS $$
BEGIN RAISE EXCEPTION 'Telemetry packets are immutable'; END $$;
CREATE TRIGGER telemetry_packet_no_change BEFORE UPDATE OR DELETE ON public.telemetry_packet
  FOR EACH ROW EXECUTE FUNCTION public.telemetry_packet_immutable();
REVOKE ALL ON FUNCTION public.telemetry_packet_immutable() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_telemetry_device(p_device_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
  SELECT coalesce((SELECT jsonb_build_object('ok',true,'public_key',d.public_key,'status',d.status)
    FROM public.device d JOIN public.product p ON p.id=d.product_id
    WHERE d.id=p_device_id AND d.status='active' AND p.registry_status='active'),
    jsonb_build_object('ok',false,'code','device_unavailable','message','Active device required.'));
$$;

CREATE FUNCTION public.ingest_verified_telemetry(p_payload text,p_public_key text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
DECLARE
  body jsonb; sensors jsonb; reading jsonb; field text; quality text; number_value double precision;
  did uuid; uid uuid; boot uuid; seq integer; observed timestamptz; target_product uuid;
  p public.product; d public.device; prior public.telemetry_packet; packet uuid; payload_hash text;
  latest_seq integer; latest_time timestamptz; stamped timestamptz;
BEGIN
  IF p_payload IS NULL OR octet_length(p_payload) NOT BETWEEN 1 AND 4096 OR p_signature IS NULL
    OR p_signature !~ '^[A-Za-z0-9+/]{86}==$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_payload','message','Invalid telemetry envelope.');
  END IF;
  BEGIN
    body := p_payload::jsonb;
    IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR body->>'domain' IS DISTINCT FROM 'smart-agro.telemetry.v2'
      OR body->'schema_version' IS DISTINCT FROM '2'::jsonb OR body->>'source' IS DISTINCT FROM 'device'
      OR jsonb_typeof(body->'device_id') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'unit_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(body->'boot_id') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'sequence') IS DISTINCT FROM 'number'
      OR (body->>'sequence') !~ '^[0-9]{1,10}$' OR body->>'clock_status' NOT IN ('synced','unsynced')
      OR body->>'clock_status' IS NULL OR jsonb_typeof(body->'measured_at') IS DISTINCT FROM 'string'
      OR body->>'measured_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
      OR body ? 'actuator' OR body ? 'drip' THEN RAISE EXCEPTION 'Invalid telemetry fields'; END IF;
    did := (body->>'device_id')::uuid; uid := (body->>'unit_id')::uuid; boot := (body->>'boot_id')::uuid;
    seq := (body->>'sequence')::integer; observed := (body->>'measured_at')::timestamptz;
    sensors := body->'sensors';
    IF seq < 0 OR NOT isfinite(observed) OR jsonb_typeof(sensors) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(sensors)) <> 3 THEN RAISE EXCEPTION 'Invalid sensor set'; END IF;
    FOREACH field IN ARRAY ARRAY['moisture','soil_temperature','soil_ph'] LOOP
      reading := sensors->field; quality := reading->>'status';
      IF jsonb_typeof(reading) IS DISTINCT FROM 'object' OR quality IS NULL OR quality NOT IN ('ok','error','not_measured')
        OR NOT (reading ? 'value') THEN RAISE EXCEPTION 'Invalid sensor status'; END IF;
      IF quality='ok' THEN
        IF jsonb_typeof(reading->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Numeric sensor required'; END IF;
        number_value := (reading->>'value')::double precision;
        IF number_value = 'NaN'::double precision OR number_value IN ('Infinity'::double precision,'-Infinity'::double precision)
          OR (field='moisture' AND number_value NOT BETWEEN 0 AND 100)
          OR (field='soil_temperature' AND number_value NOT BETWEEN -20 AND 60)
          OR (field='soil_ph' AND number_value NOT BETWEEN 0 AND 14) THEN RAISE EXCEPTION 'Sensor outside range'; END IF;
      ELSIF reading->'value' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Non-ok values must be null'; END IF;
      IF quality='error' AND (jsonb_typeof(reading->'error') IS DISTINCT FROM 'string' OR length(btrim(reading->>'error')) NOT BETWEEN 1 AND 240)
        THEN RAISE EXCEPTION 'Error detail required'; END IF;
      IF reading ? 'error' AND (jsonb_typeof(reading->'error') IS DISTINCT FROM 'string' OR length(reading->>'error') > 240)
        THEN RAISE EXCEPTION 'Invalid error detail'; END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_payload','message','Invalid telemetry fields or sensor values.');
  END;
  SELECT product_id INTO target_product FROM public.device WHERE id=did;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Device unavailable.'); END IF;
  SELECT * INTO p FROM public.product WHERE id=target_product FOR UPDATE;
  SELECT * INTO d FROM public.device WHERE id=did FOR UPDATE;
  IF d.product_id IS DISTINCT FROM p.id OR d.public_key IS DISTINCT FROM p_public_key OR d.status <> 'active' OR p.registry_status <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Product or device unavailable.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unit WHERE id=uid AND product_id=p.id)
    OR NOT EXISTS (SELECT 1 FROM public.ownership WHERE product_id=p.id AND end_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit required.'); END IF;
  payload_hash := encode(digest(p_payload,'sha256'),'hex');
  SELECT * INTO prior FROM public.telemetry_packet WHERE device_id=did AND boot_id=boot AND sequence=seq;
  IF FOUND THEN
    IF prior.unit_id=uid AND prior.payload_sha256=payload_hash AND prior.payload=p_payload THEN
      RETURN jsonb_build_object('ok',true,'packet_id',prior.id,'inserted',0,'duplicate',true);
    END IF;
    RETURN jsonb_build_object('ok',false,'code','sequence_conflict','message','Sequence already has different payload.');
  END IF;
  SELECT max(sequence),max(measured_at) INTO latest_seq,latest_time FROM public.telemetry_packet WHERE device_id=did AND boot_id=boot;
  IF seq <= latest_seq OR observed < latest_time THEN
    RETURN jsonb_build_object('ok',false,'code','sequence_out_of_order','message','New packets must advance sequence and measurement time.'); END IF;
  stamped := clock_timestamp();
  IF observed < stamped - interval '7 days' OR observed > stamped + interval '5 minutes' THEN
    RETURN jsonb_build_object('ok',false,'code','timestamp_out_of_range','message','Measurement time outside accepted window.'); END IF;
  IF (SELECT count(*) FROM public.telemetry_packet WHERE device_id=did AND received_at > stamped - interval '1 minute') >= 120 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Device packet rate exceeded.'); END IF;
  INSERT INTO public.telemetry_packet(device_id,unit_id,boot_id,sequence,clock_status,measured_at,received_at,payload,payload_sha256,signature)
    VALUES(did,uid,boot,seq,body->>'clock_status',observed,stamped,p_payload,payload_hash,p_signature) RETURNING id INTO packet;
  FOREACH field IN ARRAY ARRAY['moisture','soil_temperature','soil_ph'] LOOP
    reading := sensors->field;
    INSERT INTO public.measurement(device_id,unit_id,device_boot_seq_sensor,source,quality_status,value_nullable,measured_at,received_at,packet_id,sensor_id,error_message)
      VALUES(did,uid,did::text||':'||boot::text||':'||seq::text||':'||field,'device',reading->>'status',
        CASE WHEN reading->>'status'='ok' THEN (reading->>'value')::double precision ELSE NULL END,
        observed,stamped,packet,field,CASE WHEN reading->>'status'='error' THEN reading->>'error' ELSE NULL END);
  END LOOP;
  RETURN jsonb_build_object('ok',true,'packet_id',packet,'inserted',3,'duplicate',false);
END $$;

CREATE FUNCTION public.my_device_units() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
  SELECT jsonb_build_object('ok',public.current_auth_session(),'units',coalesce(jsonb_agg(jsonb_build_object(
    'unit_id',u.id,'product_id',p.id,'serial_public',p.serial_public,'location_label',u.location_label,
    'device_id',d.id,'device_status',d.status,'profile_version_id',u.profile_version_id) ORDER BY u.id,d.id),'[]'::jsonb))
  FROM public.unit u JOIN public.product p ON p.id=u.product_id JOIN public.device d ON d.product_id=p.id
  WHERE public.current_auth_session() AND EXISTS (SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    WHERE o.product_id=p.id AND o.end_at IS NULL AND a.auth_user_id=auth.uid());
$$;

CREATE FUNCTION public.unit_measurements(p_unit_id uuid,p_before timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unit u JOIN public.ownership o ON o.product_id=u.product_id JOIN public.account a ON a.id=o.account_id
    WHERE u.id=p_unit_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid()) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit required.'); END IF;
  RETURN (SELECT jsonb_build_object('ok',true,'readings',coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.measured_at DESC,rows.id DESC),'[]'::jsonb)) FROM (
    SELECT m.id,m.sensor_id,m.quality_status,m.value_nullable,m.error_message,m.measured_at,m.received_at,m.source,
      t.clock_status,t.sequence,t.boot_id
    FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.unit_id=p_unit_id AND m.source='device' AND (p_before IS NULL OR m.measured_at<p_before)
      AND EXISTS (SELECT 1 FROM public.unit u JOIN public.ownership o ON o.product_id=u.product_id
        JOIN public.account a ON a.id=o.account_id WHERE u.id=m.unit_id AND o.end_at IS NULL
          AND a.auth_user_id=auth.uid() AND m.measured_at>=o.start_at AND m.received_at>=o.start_at)
    ORDER BY m.measured_at DESC,m.id DESC LIMIT 120
  ) rows);
END $$;

CREATE FUNCTION public.create_my_unit(p_product_id uuid,p_profile_version_id uuid,p_label text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
DECLARE p public.product; uid uuid; unit_count integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 120 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_label','message','Unit label must contain 1–120 characters.'); END IF;
  SELECT * INTO p FROM public.product WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND OR p.registry_status <> 'active' OR NOT EXISTS (SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    WHERE o.product_id=p.id AND o.end_at IS NULL AND a.auth_user_id=auth.uid()) THEN
    RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Active owned product required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_version WHERE id=p_profile_version_id AND published_at<=clock_timestamp()) THEN
    RETURN jsonb_build_object('ok',false,'code','profile_unavailable','message','Published profile required.'); END IF;
  SELECT count(*) INTO unit_count FROM public.unit WHERE product_id=p.id;
  -- ponytail: garden limit 32 is an operational ceiling, not hardware capacity; revise after measured load.
  IF unit_count >= (CASE WHEN p.variant='single_pot' THEN 1 ELSE 32 END) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_limit','message','Product unit limit reached.'); END IF;
  INSERT INTO public.unit(product_id,profile_version_id,location_label) VALUES(p.id,p_profile_version_id,btrim(p_label)) RETURNING id INTO uid;
  RETURN jsonb_build_object('ok',true,'unit_id',uid);
END $$;

CREATE FUNCTION public.published_profile_versions() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
  SELECT jsonb_build_object('ok',public.current_auth_session(),'profiles',coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,'species_variety',p.species_variety,'version',v.version,'evidence_level',v.evidence_level) ORDER BY p.species_variety,v.version DESC),'[]'::jsonb))
  FROM public.profile_version v JOIN public.plant_profile p ON p.id=v.profile_id
  WHERE public.current_auth_session() AND v.published_at<=clock_timestamp();
$$;

REVOKE ALL ON FUNCTION public.get_telemetry_device(uuid),public.ingest_verified_telemetry(text,text,text),public.my_device_units(),public.unit_measurements(uuid,timestamptz),public.create_my_unit(uuid,uuid,text),public.published_profile_versions() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_telemetry_device(uuid),public.ingest_verified_telemetry(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_device_units(),public.unit_measurements(uuid,timestamptz),public.create_my_unit(uuid,uuid,text),public.published_profile_versions() TO authenticated;
