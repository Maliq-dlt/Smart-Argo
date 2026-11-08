-- ponytail: fixed 15-minute UTC windows; version the signed domain and policy before supporting other periods.
-- Meter trust is operator-attested provisioning, never a client-provided quality flag.
CREATE TABLE public.energy_meter (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
 public_key text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 calibration_ref text NOT NULL,eligible_load_ref text NOT NULL,valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,
 max_power_w numeric NOT NULL CHECK(max_power_w>0 AND max_power_w<=100000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,revoked_reason text,revoked_at timestamptz,
 CHECK(valid_until>valid_from),CHECK((status='active' AND revoked_at IS NULL AND revoked_reason IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL AND length(btrim(revoked_reason)) BETWEEN 1 AND 1000))
);
CREATE UNIQUE INDEX one_active_energy_meter ON public.energy_meter(device_id) WHERE status='active';
ALTER TABLE public.energy_meter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_meter FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.energy_meter TO service_role;
CREATE FUNCTION public.energy_meter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='revoked' AND (to_jsonb(OLD)-ARRAY['status','revoked_reason','revoked_at'])=(to_jsonb(NEW)-ARRAY['status','revoked_reason','revoked_at']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Meter registration is immutable; revoke and register a new meter';
END $$;
CREATE TRIGGER energy_meter_guard BEFORE UPDATE OR DELETE ON public.energy_meter FOR EACH ROW EXECUTE FUNCTION public.energy_meter_guard();

ALTER TABLE public.energy_window ADD COLUMN meter_id uuid REFERENCES public.energy_meter(id) ON DELETE RESTRICT;
ALTER TABLE public.energy_window ADD COLUMN ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT;
ALTER TABLE public.energy_window ADD COLUMN received_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.energy_window ADD COLUMN sequence integer CHECK(sequence>=0);
ALTER TABLE public.energy_window ADD COLUMN payload text;
ALTER TABLE public.energy_window ADD COLUMN payload_sha256 text;
ALTER TABLE public.energy_window ADD COLUMN signature text;
ALTER TABLE public.energy_window ADD COLUMN solar_start_wh numeric;
ALTER TABLE public.energy_window ADD COLUMN solar_end_wh numeric;
ALTER TABLE public.energy_window ADD COLUMN load_start_wh numeric;
ALTER TABLE public.energy_window ADD COLUMN load_end_wh numeric;
ALTER TABLE public.energy_window ADD COLUMN battery_soc_pct numeric CHECK(battery_soc_pct BETWEEN 0 AND 100);
CREATE UNIQUE INDEX energy_packet_identity ON public.energy_window(device_id,boot_id,sequence) WHERE sequence IS NOT NULL;
CREATE INDEX energy_device_period ON public.energy_window(device_id,start_at,end_at);
CREATE TRIGGER energy_window_immutable BEFORE UPDATE OR DELETE ON public.energy_window FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();

CREATE FUNCTION public.operator_register_energy_meter(p_device_id uuid,p_public_key text,p_calibration_ref text,p_eligible_load_ref text,p_valid_from timestamptz,p_valid_until timestamptz,p_max_power_w numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE actor uuid; pid uuid; meter uuid;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 SELECT id INTO actor FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles);
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Operator role required.'); END IF;
 IF p_public_key IS NULL OR p_public_key !~ '^[A-Za-z0-9+/]{43}=$' OR p_calibration_ref IS NULL OR length(btrim(p_calibration_ref)) NOT BETWEEN 1 AND 1000
  OR p_eligible_load_ref IS NULL OR length(btrim(p_eligible_load_ref)) NOT BETWEEN 1 AND 1000 OR p_valid_from IS NULL OR p_valid_until IS NULL
  OR NOT isfinite(p_valid_from) OR NOT isfinite(p_valid_until) OR p_valid_until<=p_valid_from OR p_valid_until>p_valid_from+interval '1 year'
  OR p_valid_until<=clock_timestamp() OR p_max_power_w IS NULL OR p_max_power_w NOT BETWEEN 0.001 AND 100000 THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_meter','message','Meter key, calibration, eligible-load evidence, dates and rated limit required.'); END IF;
 IF encode(decode(p_public_key,'base64'),'base64')<>p_public_key THEN RETURN jsonb_build_object('ok',false,'code','invalid_meter','message','Canonical meter key required.'); END IF;
 SELECT product_id INTO pid FROM public.device WHERE id=p_device_id;
 PERFORM 1 FROM public.product WHERE id=pid AND registry_status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active product required.'); END IF;
 PERFORM 1 FROM public.device WHERE id=p_device_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active device required.'); END IF;
 IF EXISTS(SELECT 1 FROM public.energy_meter WHERE device_id=p_device_id AND status='active') THEN RETURN jsonb_build_object('ok',false,'code','meter_exists','message','Revoke the current meter before registering a replacement.'); END IF;
 INSERT INTO public.energy_meter(device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by)
 VALUES(p_device_id,p_public_key,btrim(p_calibration_ref),btrim(p_eligible_load_ref),p_valid_from,p_valid_until,p_max_power_w,actor) RETURNING id INTO meter;
 RETURN jsonb_build_object('ok',true,'meter_id',meter);
END $$;
CREATE FUNCTION public.operator_revoke_energy_meter(p_meter_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE pid uuid; did uuid; m public.energy_meter;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 IF NOT ('operator'=ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Operator role required.'); END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason','message','Reason required.'); END IF;
 SELECT device_id INTO did FROM public.energy_meter WHERE id=p_meter_id;
 SELECT product_id INTO pid FROM public.device WHERE id=did;
 PERFORM 1 FROM public.product WHERE id=pid FOR UPDATE; PERFORM 1 FROM public.device WHERE id=did FOR UPDATE;
 SELECT * INTO m FROM public.energy_meter WHERE id=p_meter_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','meter_unavailable','message','Meter unavailable.'); END IF;
 IF m.status='active' THEN UPDATE public.energy_meter SET status='revoked',revoked_reason=btrim(p_reason),revoked_at=clock_timestamp() WHERE id=m.id; END IF;
 RETURN jsonb_build_object('ok',true,'meter_id',m.id,'status','revoked');
END $$;
CREATE FUNCTION public.get_energy_meter(p_meter_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
 SELECT coalesce((SELECT jsonb_build_object('ok',true,'public_key',m.public_key,'device_id',m.device_id) FROM public.energy_meter m
 JOIN public.device d ON d.id=m.device_id JOIN public.product p ON p.id=d.product_id WHERE m.id=p_meter_id AND m.status='active' AND d.status='active' AND p.registry_status='active'),jsonb_build_object('ok',false,'code','meter_unavailable','message','Active meter required.'));
$$;
CREATE FUNCTION public.ingest_verified_energy(p_payload text,p_public_key text,p_signature text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE b jsonb; m public.energy_meter; d public.device; prod public.product; own public.ownership; prior public.energy_window; last_window public.energy_window;
 mid uuid; did uuid; boot uuid; seq integer; started timestamptz; ended timestamptz; ss numeric; se numeric; ls numeric; le numeric; soc numeric;
 pid uuid; wid uuid; digest_text text; credit jsonb; latest_sequence integer; now_at timestamptz:=clock_timestamp(); k text;
BEGIN
 IF p_payload IS NULL OR octet_length(p_payload) NOT BETWEEN 1 AND 4096 OR p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9+/]{86}==$' THEN RETURN jsonb_build_object('ok',false,'code','invalid_packet','message','Invalid energy envelope.'); END IF;
 BEGIN
  b:=p_payload::jsonb;
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(b))<>15 OR b->>'domain' IS DISTINCT FROM 'smart-agro.energy.v1' OR b->'schema_version' IS DISTINCT FROM '1'::jsonb OR b->>'source' IS DISTINCT FROM 'meter' OR b->>'clock_status' IS DISTINCT FROM 'synced' THEN RAISE EXCEPTION 'Invalid contract'; END IF;
  mid:=(b->>'meter_id')::uuid;did:=(b->>'device_id')::uuid;boot:=(b->>'boot_id')::uuid;seq:=(b->>'sequence')::integer;
  IF mid IS NULL OR did IS NULL OR boot IS NULL OR jsonb_typeof(b->'sequence') IS DISTINCT FROM 'number' OR (b->>'sequence') !~ '^[0-9]{1,10}$' OR seq<0 THEN RAISE EXCEPTION 'Invalid identity'; END IF;
  started:=(b->>'start_at')::timestamptz;ended:=(b->>'end_at')::timestamptz;
  IF jsonb_typeof(b->'start_at') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'end_at') IS DISTINCT FROM 'string' OR b->>'start_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' OR b->>'end_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' OR started IS NULL OR ended IS NULL OR NOT isfinite(started) OR NOT isfinite(ended) OR mod(extract(epoch FROM started),900)<>0 OR ended-started<>interval '15 minutes' THEN RAISE EXCEPTION 'Invalid period'; END IF;
  FOREACH k IN ARRAY ARRAY['solar_start_wh','solar_end_wh','load_start_wh','load_end_wh'] LOOP
   IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR (b->>k)::numeric NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Invalid counter'; END IF;
  END LOOP;
  ss:=(b->>'solar_start_wh')::numeric;se:=(b->>'solar_end_wh')::numeric;ls:=(b->>'load_start_wh')::numeric;le:=(b->>'load_end_wh')::numeric;
  IF se<ss OR le<ls OR NOT(b ? 'battery_soc_pct') THEN RAISE EXCEPTION 'Invalid counters'; END IF;
  IF b->'battery_soc_pct'<>'null'::jsonb THEN
   IF jsonb_typeof(b->'battery_soc_pct') IS DISTINCT FROM 'number' OR (b->>'battery_soc_pct')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid SOC'; END IF;
   soc:=(b->>'battery_soc_pct')::numeric;
  END IF;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','invalid_packet','message','Invalid energy fields.'); END;
 SELECT product_id INTO pid FROM public.device WHERE id=did;
 SELECT * INTO prod FROM public.product WHERE id=pid FOR UPDATE;
 SELECT * INTO d FROM public.device WHERE id=did FOR UPDATE;
 SELECT * INTO m FROM public.energy_meter WHERE id=mid FOR UPDATE;
 IF m.id IS NULL OR m.device_id IS DISTINCT FROM did OR m.public_key IS DISTINCT FROM p_public_key OR m.status<>'active' OR d.status<>'active' OR prod.registry_status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','meter_unavailable','message','Active registered meter required.'); END IF;
 SELECT * INTO own FROM public.ownership WHERE product_id=prod.id AND end_at IS NULL;
 digest_text:=encode(digest(p_payload,'sha256'),'hex');
 SELECT * INTO prior FROM public.energy_window WHERE device_id=did AND boot_id=boot::text AND sequence=seq;
 IF FOUND THEN
  IF prior.meter_id=mid AND prior.payload_sha256=digest_text AND prior.payload=p_payload THEN RETURN jsonb_build_object('ok',true,'window_id',prior.id,'duplicate',true,'credited',0); END IF;
  RETURN jsonb_build_object('ok',false,'code','sequence_conflict','message','Sequence already has different evidence.');
 END IF;
 IF own.id IS NULL OR started<own.start_at OR ended>now_at OR started<now_at-interval '7 days' OR started<m.valid_from OR ended>m.valid_until THEN RETURN jsonb_build_object('ok',false,'code','window_unavailable','message','Completed window must fall within current ownership, meter validity and seven-day backlog.'); END IF;
 -- Product/device row locks serialize the overlap check across boots and replacement meters.
 IF EXISTS(SELECT 1 FROM public.energy_window WHERE device_id=did AND started<end_at AND ended>start_at) THEN RETURN jsonb_build_object('ok',false,'code','window_overlap','message','Device energy period was already recorded.'); END IF;
 SELECT max(sequence) INTO latest_sequence FROM public.energy_window WHERE device_id=did AND boot_id=boot::text;
 SELECT * INTO last_window FROM public.energy_window WHERE meter_id=mid AND boot_id=boot::text ORDER BY end_at DESC LIMIT 1;
 IF seq<=latest_sequence OR (last_window.id IS NOT NULL AND (started<last_window.end_at OR ss<last_window.solar_end_wh OR ls<last_window.load_end_wh)) THEN RETURN jsonb_build_object('ok',false,'code','counter_out_of_order','message','Sequence, period or counters moved backward within the boot.'); END IF;
 IF se-ss>m.max_power_w*0.25 OR le-ls>m.max_power_w*0.25 THEN RETURN jsonb_build_object('ok',false,'code','power_limit','message','Measured energy exceeds the registered power bound.'); END IF;
 IF (SELECT count(*) FROM public.energy_window WHERE device_id=did AND received_at>now_at-interval '1 minute')>=120 THEN RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Meter rate exceeded.'); END IF;
 INSERT INTO public.energy_window(device_id,boot_id,start_at,end_at,solar_harvest_wh,load_wh,evidence_quality,meter_id,ownership_id,sequence,payload,payload_sha256,signature,solar_start_wh,solar_end_wh,load_start_wh,load_end_wh,battery_soc_pct)
 VALUES(did,boot::text,started,ended,(se-ss)::double precision,(le-ls)::double precision,'verified_meter',mid,own.id,seq,p_payload,digest_text,p_signature,ss,se,ls,le,soc) RETURNING id INTO wid;
 credit:=public.credit_energy_reward(wid,own.account_id);
 RETURN jsonb_build_object('ok',true,'window_id',wid,'duplicate',false,'credited',coalesce((credit->>'credited')::integer,0),'reward',credit);
END $$;
CREATE FUNCTION public.energy_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE meters jsonb; windows jsonb; operator boolean;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 operator:='operator'=ANY(public.my_curation_roles());
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]') INTO meters FROM (
  SELECT m.id,m.device_id,m.status,m.calibration_ref,m.eligible_load_ref,m.valid_from,m.valid_until,m.max_power_w,m.created_at,m.revoked_reason
  FROM public.energy_meter m JOIN public.device d ON d.id=m.device_id WHERE operator OR EXISTS(SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id WHERE o.product_id=d.product_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid()) ORDER BY m.created_at DESC LIMIT 100
 ) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.end_at DESC),'[]') INTO windows FROM (
  SELECT w.id,w.device_id,w.meter_id,w.start_at,w.end_at,w.received_at,w.solar_harvest_wh,w.load_wh,w.battery_soc_pct,w.evidence_quality,
   (SELECT reason FROM public.energy_reward_result WHERE energy_window_id=w.id) AS reward_reason,
   (SELECT coalesce(sum(l.signed_points),0) FROM public.ledger_entry l JOIN public.reward_event e ON e.id=l.reward_event_id WHERE e.energy_window_id=w.id) AS credited_points
  FROM public.energy_window w JOIN public.ownership o ON o.id=w.ownership_id JOIN public.account a ON a.id=o.account_id
  WHERE a.auth_user_id=auth.uid() ORDER BY w.end_at DESC LIMIT 100
 ) r;
 RETURN jsonb_build_object('ok',true,'roles',to_jsonb(public.my_curation_roles()),'meters',meters,'windows',windows);
END $$;
REVOKE ALL ON FUNCTION public.energy_meter_guard(),public.operator_register_energy_meter(uuid,text,text,text,timestamptz,timestamptz,numeric),public.operator_revoke_energy_meter(uuid,text),public.get_energy_meter(uuid),public.ingest_verified_energy(text,text,text),public.energy_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_register_energy_meter(uuid,text,text,text,timestamptz,timestamptz,numeric),public.operator_revoke_energy_meter(uuid,text),public.energy_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_energy_meter(uuid),public.ingest_verified_energy(text,text,text) TO service_role;
