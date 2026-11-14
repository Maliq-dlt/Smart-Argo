-- APP-02 (U02 "Kelola pot atau zona kebun"): owners rename and archive units, and place each device in one unit of
-- their product. Placement is recorded with history, so a device's location is the server's record instead of a
-- choice inside each packet. Ingest rejects packets for archived units and for units other than a placed device's.
-- Devices never placed keep the earlier behaviour (any unit of their product), so existing kits keep reporting.

CREATE OR REPLACE FUNCTION public.reward_case_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

ALTER TABLE public.unit ADD COLUMN archived_at timestamptz;

CREATE TABLE public.device_placement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.unit(id) ON DELETE RESTRICT,
  placed_by uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  end_at timestamptz,
  CHECK (end_at IS NULL OR end_at >= start_at)
);
CREATE UNIQUE INDEX device_placement_active ON public.device_placement(device_id) WHERE end_at IS NULL;
CREATE INDEX device_placement_unit ON public.device_placement(unit_id, start_at DESC);

CREATE TABLE public.unit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.unit(id) ON DELETE RESTRICT,
  actor_account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('renamed','archived','restored','device_placed','device_removed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX unit_event_unit ON public.unit_event(unit_id, id DESC);
CREATE TRIGGER unit_event_immutable BEFORE UPDATE OR DELETE ON public.unit_event
  FOR EACH ROW EXECUTE FUNCTION public.reward_case_event_immutable();

ALTER TABLE public.device_placement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_placement, public.unit_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.device_placement, public.unit_event TO service_role;

-- The caller's account and the unit, locked product first (same order as ingest), or NULLs when not an active owner.
CREATE FUNCTION public.lock_my_unit(p_unit_id uuid, OUT account_id uuid, OUT unit public.unit, OUT product public.product)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  SELECT p.* INTO product FROM public.product p JOIN public.unit u ON u.product_id = p.id WHERE u.id = p_unit_id FOR UPDATE OF p;
  SELECT a.id INTO account_id FROM public.account a JOIN public.ownership o ON o.account_id = a.id
    WHERE a.auth_user_id = auth.uid() AND o.product_id = product.id AND o.end_at IS NULL;
  IF account_id IS NULL OR product.registry_status <> 'active' THEN account_id := NULL; product := NULL; RETURN; END IF;
  SELECT * INTO unit FROM public.unit WHERE id = p_unit_id FOR UPDATE;
END $$;

CREATE FUNCTION public.rename_my_unit(p_unit_id uuid, p_label text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l record; clean text := btrim(p_label);
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF clean IS NULL OR length(clean) NOT BETWEEN 1 AND 120 THEN RETURN jsonb_build_object('ok',false,'code','invalid_label','message','Unit label must contain 1–120 characters.'); END IF;
  SELECT * INTO l FROM public.lock_my_unit(p_unit_id);
  IF l.account_id IS NULL OR (l.unit).archived_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  IF (l.unit).location_label = clean THEN RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',false); END IF;
  UPDATE public.unit SET location_label = clean WHERE id = p_unit_id;
  INSERT INTO public.unit_event(unit_id, actor_account_id, action, detail) VALUES (p_unit_id, l.account_id, 'renamed', jsonb_build_object('from',(l.unit).location_label,'to',clean));
  RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',true);
END $$;

-- Archiving keeps every reading and journal entry; it stops new packets and frees the unit slot.
CREATE FUNCTION public.archive_my_unit(p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l record; removed integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT * INTO l FROM public.lock_my_unit(p_unit_id);
  IF l.account_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  IF (l.unit).archived_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',false); END IF;
  UPDATE public.device_placement SET end_at = clock_timestamp() WHERE unit_id = p_unit_id AND end_at IS NULL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  UPDATE public.unit SET archived_at = clock_timestamp() WHERE id = p_unit_id;
  INSERT INTO public.unit_event(unit_id, actor_account_id, action, detail) VALUES (p_unit_id, l.account_id, 'archived', jsonb_build_object('devices_removed',removed));
  RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',true);
END $$;

CREATE FUNCTION public.restore_my_unit(p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE l record; active integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT * INTO l FROM public.lock_my_unit(p_unit_id);
  IF l.account_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  IF (l.unit).archived_at IS NULL THEN RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',false); END IF;
  SELECT count(*) INTO active FROM public.unit WHERE product_id = (l.product).id AND archived_at IS NULL;
  IF active >= (CASE WHEN (l.product).variant = 'single_pot' THEN 1 ELSE 32 END) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_limit','message','Product unit limit reached.'); END IF;
  UPDATE public.unit SET archived_at = NULL WHERE id = p_unit_id;
  INSERT INTO public.unit_event(unit_id, actor_account_id, action) VALUES (p_unit_id, l.account_id, 'restored');
  RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'changed',true);
END $$;

-- Place a device of the same product in a unit, or remove its placement (p_unit_id NULL). Moving ends the old one.
CREATE FUNCTION public.place_my_device(p_device_id uuid, p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; p public.product; d public.device; u public.unit; cur public.device_placement;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT pr.* INTO p FROM public.product pr JOIN public.device dv ON dv.product_id = pr.id WHERE dv.id = p_device_id FOR UPDATE OF pr;
  SELECT a.id INTO aid FROM public.account a JOIN public.ownership o ON o.account_id = a.id
    WHERE a.auth_user_id = auth.uid() AND o.product_id = p.id AND o.end_at IS NULL;
  SELECT * INTO d FROM public.device WHERE id = p_device_id FOR UPDATE;
  IF aid IS NULL OR p.registry_status <> 'active' OR d.status <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active device of an owned product required.'); END IF;
  IF p_unit_id IS NOT NULL THEN
    SELECT * INTO u FROM public.unit WHERE id = p_unit_id FOR UPDATE;
    IF NOT FOUND OR u.product_id <> p.id OR u.archived_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active unit of the same product required.'); END IF;
  END IF;
  SELECT * INTO cur FROM public.device_placement WHERE device_id = d.id AND end_at IS NULL FOR UPDATE;
  IF cur.unit_id IS NOT DISTINCT FROM p_unit_id THEN RETURN jsonb_build_object('ok',true,'device_id',d.id,'unit_id',p_unit_id,'changed',false); END IF;
  IF cur.id IS NOT NULL THEN
    UPDATE public.device_placement SET end_at = clock_timestamp() WHERE id = cur.id;
    INSERT INTO public.unit_event(unit_id, actor_account_id, action, detail) VALUES (cur.unit_id, aid, 'device_removed', jsonb_build_object('device_id',d.id,'to_unit_id',p_unit_id));
  END IF;
  IF p_unit_id IS NOT NULL THEN
    INSERT INTO public.device_placement(device_id, unit_id, placed_by) VALUES (d.id, p_unit_id, aid);
    INSERT INTO public.unit_event(unit_id, actor_account_id, action, detail) VALUES (p_unit_id, aid, 'device_placed', jsonb_build_object('device_id',d.id,'from_unit_id',cur.unit_id));
  END IF;
  RETURN jsonb_build_object('ok',true,'device_id',d.id,'unit_id',p_unit_id,'changed',true);
END $$;

-- Owner's units (archived included) and the devices of those products with their current placement.
CREATE FUNCTION public.my_units() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE owned uuid[]; units jsonb; devices jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT coalesce(array_agg(o.product_id), '{}') INTO owned FROM public.ownership o JOIN public.account a ON a.id = o.account_id
    WHERE a.auth_user_id = auth.uid() AND o.end_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object('unit_id',u.id,'product_id',p.id,'serial_public',p.serial_public,'variant',p.variant,
      'location_label',u.location_label,'profile_version_id',u.profile_version_id,'species_variety',pp.species_variety,'profile_version',pv.version,
      'archived_at',u.archived_at,'created_at',u.created_at) ORDER BY u.archived_at NULLS FIRST, u.created_at, u.id), '[]'::jsonb)
    INTO units FROM public.unit u JOIN public.product p ON p.id = u.product_id
    JOIN public.profile_version pv ON pv.id = u.profile_version_id JOIN public.plant_profile pp ON pp.id = pv.profile_id
    WHERE u.product_id = ANY(owned);
  SELECT coalesce(jsonb_agg(jsonb_build_object('device_id',d.id,'product_id',d.product_id,'status',d.status,'unit_id',pl.unit_id,'placed_at',pl.start_at)
      ORDER BY d.created_at, d.id), '[]'::jsonb)
    INTO devices FROM public.device d LEFT JOIN public.device_placement pl ON pl.device_id = d.id AND pl.end_at IS NULL
    WHERE d.product_id = ANY(owned);
  RETURN jsonb_build_object('ok',true,'units',units,'devices',devices);
END $$;

-- A unit's history during the caller's ownership: renames, archive/restore and device moves.
CREATE FUNCTION public.my_unit_history(p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE since timestamptz; rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT o.start_at INTO since FROM public.unit u JOIN public.ownership o ON o.product_id = u.product_id AND o.end_at IS NULL
    JOIN public.account a ON a.id = o.account_id WHERE u.id = p_unit_id AND a.auth_user_id = auth.uid();
  IF since IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action',e.action,'detail',e.detail,'created_at',e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
    INTO rows FROM (SELECT * FROM public.unit_event WHERE unit_id = p_unit_id AND created_at >= since ORDER BY id DESC LIMIT 100) e;
  RETURN jsonb_build_object('ok',true,'events',rows);
END $$;

CREATE OR REPLACE FUNCTION public.my_device_units() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,public,extensions AS $$
  SELECT jsonb_build_object('ok',public.current_auth_session(),'units',coalesce(jsonb_agg(jsonb_build_object(
    'unit_id',u.id,'product_id',p.id,'serial_public',p.serial_public,'location_label',u.location_label,
    'device_id',d.id,'device_status',d.status,'profile_version_id',u.profile_version_id,'placed',pl.unit_id IS NOT NULL) ORDER BY u.id,d.id),'[]'::jsonb))
  FROM public.unit u JOIN public.product p ON p.id=u.product_id JOIN public.device d ON d.product_id=p.id
  LEFT JOIN public.device_placement pl ON pl.device_id=d.id AND pl.end_at IS NULL
  -- A placed device pairs only with its unit; unplaced devices keep pairing with every active unit of the product.
  WHERE public.current_auth_session() AND u.archived_at IS NULL AND (pl.unit_id IS NULL OR pl.unit_id=u.id)
    AND EXISTS (SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    WHERE o.product_id=p.id AND o.end_at IS NULL AND a.auth_user_id=auth.uid());
$$;

-- create_my_unit from 20261105020000_device_telemetry.sql, with the edits above it applied; otherwise unchanged.
CREATE OR REPLACE FUNCTION public.create_my_unit(p_product_id uuid,p_profile_version_id uuid,p_label text) RETURNS jsonb
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
  SELECT count(*) INTO unit_count FROM public.unit WHERE product_id=p.id AND archived_at IS NULL; -- APP-02: archived units free their slot
  -- ponytail: garden limit 32 is an operational ceiling, not hardware capacity; revise after measured load.
  IF unit_count >= (CASE WHEN p.variant='single_pot' THEN 1 ELSE 32 END) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_limit','message','Product unit limit reached.'); END IF;
  INSERT INTO public.unit(product_id,profile_version_id,location_label) VALUES(p.id,p_profile_version_id,btrim(p_label)) RETURNING id INTO uid;
  RETURN jsonb_build_object('ok',true,'unit_id',uid);
END $$;

-- ingest_verified_telemetry from 20261105020000_device_telemetry.sql, with the edits above it applied; otherwise unchanged.
CREATE OR REPLACE FUNCTION public.ingest_verified_telemetry(p_payload text,p_public_key text,p_signature text) RETURNS jsonb
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
  -- APP-02, after the duplicate check so an exact retry still succeeds: archived units take no new packets, and a
  -- placed device reports only to its unit.
  IF EXISTS (SELECT 1 FROM public.unit WHERE id=uid AND archived_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Unit is archived.'); END IF;
  IF EXISTS (SELECT 1 FROM public.device_placement WHERE device_id=did AND end_at IS NULL AND unit_id<>uid) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_mismatch','message','Device is placed in another unit.'); END IF;
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

REVOKE ALL ON FUNCTION public.lock_my_unit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_my_unit(uuid,text), public.archive_my_unit(uuid), public.restore_my_unit(uuid),
  public.place_my_device(uuid,uuid), public.my_units(), public.my_unit_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_my_unit(uuid,text), public.archive_my_unit(uuid), public.restore_my_unit(uuid),
  public.place_my_device(uuid,uuid), public.my_units(), public.my_unit_history(uuid) TO authenticated;
