-- Pindah pot tanpa flash ulang (2026-11-21). The owner's placement decides which unit a packet belongs to: the unit
-- placed at measured_at wins over the unit_id the device was flashed with, which now only applies while the device
-- is unplaced. Before this, moving a device returned unit_mismatch (HTTP 403, retried by firmware) and its queue
-- stalled until reflashed. Packets for an archived unit are a permanent unit_archived (HTTP 409) so a device does
-- not retry them for a week. ingest_verified_telemetry from 20261114120000_unit_lifecycle.sql, edits marked.

CREATE OR REPLACE FUNCTION public.ingest_verified_telemetry(p_payload text,p_public_key text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
DECLARE
  body jsonb; sensors jsonb; reading jsonb; field text; quality text; number_value double precision;
  did uuid; uid uuid; boot uuid; seq integer; observed timestamptz; target_product uuid;
  p public.product; d public.device; prior public.telemetry_packet; packet uuid; payload_hash text;
  latest_seq integer; latest_time timestamptz; stamped timestamptz; placed uuid;
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
  -- Edit: the placement covering the measurement time decides the unit; placements never overlap per device, and a
  -- closed interval never changes, so an exact retry resolves to the same unit as the original.
  SELECT pl.unit_id INTO placed FROM public.device_placement pl
    WHERE pl.device_id=did AND pl.start_at<=observed AND (pl.end_at IS NULL OR pl.end_at>observed)
    ORDER BY pl.start_at DESC LIMIT 1;
  uid := coalesce(placed, uid);
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
  -- APP-02, after the duplicate check so an exact retry still succeeds: archived units take no new packets.
  -- Edit: a permanent code (HTTP 409) instead of unit_unavailable, and no unit_mismatch now that placement decides.
  IF EXISTS (SELECT 1 FROM public.unit WHERE id=uid AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_archived','message','Unit is archived.'); END IF;
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
