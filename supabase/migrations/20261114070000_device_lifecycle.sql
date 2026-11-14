-- Operator-attested maintenance; private device keys never enter these RPCs.
CREATE TABLE public.device_key_history (
 public_key text PRIMARY KEY, device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
 introduced_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX device_key_history_device ON public.device_key_history(device_id);
-- Seed only the currently known legacy key. Earlier rotations cannot be reconstructed.
INSERT INTO public.device_key_history(public_key,device_id) SELECT public_key,id FROM public.device;
CREATE TABLE public.registry_event (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT, request_id uuid NOT NULL,
 product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE RESTRICT,
 device_id uuid REFERENCES public.device(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK(action IN ('rotate_device_key','revoke_device','revoke_product')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 old_public_key text, new_public_key text, previous_status text NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_account_id,request_id)
);
CREATE INDEX registry_event_product_page ON public.registry_event(product_id,id DESC);
ALTER TABLE public.device_key_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_key_history,public.registry_event FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.registry_event_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.device_key_history,public.registry_event TO service_role;

CREATE FUNCTION public.registry_record_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Registry records are immutable'; END $$;
CREATE TRIGGER device_key_history_immutable BEFORE UPDATE OR DELETE ON public.device_key_history
 FOR EACH ROW EXECUTE FUNCTION public.registry_record_immutable();
CREATE TRIGGER registry_event_immutable BEFORE UPDATE OR DELETE ON public.registry_event
 FOR EACH ROW EXECUTE FUNCTION public.registry_record_immutable();
CREATE FUNCTION public.remember_device_key() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.public_key=OLD.public_key THEN RETURN NEW; END IF;
 INSERT INTO public.device_key_history(public_key,device_id) VALUES(NEW.public_key,NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER remember_device_key AFTER INSERT OR UPDATE OF public_key ON public.device
 FOR EACH ROW EXECUTE FUNCTION public.remember_device_key();
REVOKE ALL ON FUNCTION public.registry_record_immutable(),public.remember_device_key() FROM PUBLIC,anon,authenticated,service_role;

-- Shared transaction for the three public operations, with one actor-scoped retry namespace.
CREATE FUNCTION public.apply_registry_action(p_action text,p_product_id uuid,p_device_id uuid,p_expected_public_key text,p_new_public_key text,p_request_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE aid uuid; pid uuid; p public.product; d public.device; prior public.registry_event;
 refusal jsonb; body jsonb; result jsonb; eid bigint; old_status text;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles);
 IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Operator role required.'); END IF;
 IF p_action IS NULL OR p_action NOT IN ('rotate_device_key','revoke_device','revoke_product') OR p_request_id IS NULL
  OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
  OR (p_action='revoke_product' AND p_product_id IS NULL) OR (p_action<>'revoke_product' AND p_device_id IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Target, request identity and reason required.'); END IF;
 IF p_action='rotate_device_key' THEN
  IF p_expected_public_key IS NULL OR length(p_expected_public_key) NOT BETWEEN 1 AND 1000 OR p_new_public_key IS NULL
   OR p_new_public_key !~ '^[A-Za-z0-9+/]{43}=$' THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_key','message','Expected key and canonical 32-byte public key required.'); END IF;
  IF encode(decode(p_new_public_key,'base64'),'base64')<>p_new_public_key THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_key','message','Canonical public key required.'); END IF;
 END IF;
 body:=jsonb_build_object('action',p_action,'product_id',p_product_id,'device_id',p_device_id,
  'expected_public_key',p_expected_public_key,'new_public_key',p_new_public_key,'reason',btrim(p_reason));
 -- Always first: duplicates across different targets cannot acquire business locks in opposite order.
 PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.registry.v1:'||aid::text||':'||p_request_id::text,0));
 -- A recorded retry never takes resource locks or applies its original mutation again.
 SELECT * INTO prior FROM public.registry_event WHERE actor_account_id=aid AND request_id=p_request_id;
 IF FOUND THEN
  refusal:=public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account WHERE id=aid AND auth_user_id=auth.uid()) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Current actor required.'); END IF;
  IF prior.payload IS DISTINCT FROM body THEN RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
  RETURN prior.result||jsonb_build_object('event_id',prior.id);
 END IF;
 IF p_action='revoke_product' THEN pid:=p_product_id;
 ELSE
  SELECT product_id INTO pid FROM public.device WHERE id=p_device_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Device unavailable.'); END IF;
 END IF;
 -- Key-share nonce FK checks must finish while this operation waits for the issuer account.
 SELECT * INTO p FROM public.product WHERE id=pid FOR NO KEY UPDATE;
 IF p.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Product unavailable.'); END IF;
 IF p_action<>'revoke_product' THEN
  SELECT * INTO d FROM public.device WHERE id=p_device_id AND product_id=p.id FOR NO KEY UPDATE;
  IF d.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Device unavailable.'); END IF;
 END IF;
 refusal:=public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account WHERE id=aid AND auth_user_id=auth.uid()) THEN
  RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Current actor required.'); END IF;
 IF p_action='rotate_device_key' THEN
  IF p.registry_status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Active product required.'); END IF;
  IF d.status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active device required.'); END IF;
  IF d.public_key IS DISTINCT FROM p_expected_public_key THEN RETURN jsonb_build_object('ok',false,'code','key_conflict','message','Device key changed. Read the current identity before retrying.'); END IF;
  IF EXISTS(SELECT 1 FROM public.device_key_history WHERE public_key=p_new_public_key) THEN
   RETURN jsonb_build_object('ok',false,'code','key_unavailable','message','Use a new device public key.'); END IF;
  -- The history PK also arbitrates two different devices concurrently choosing the same new key.
  BEGIN
   UPDATE public.device SET public_key=p_new_public_key WHERE id=d.id;
  EXCEPTION WHEN unique_violation THEN
   RETURN jsonb_build_object('ok',false,'code','key_unavailable','message','Use a new device public key.');
  END;
  old_status:=d.status;
 ELSIF p_action='revoke_device' THEN
  old_status:=d.status;
  UPDATE public.device SET status='revoked' WHERE id=d.id;
  d.status:='revoked';
 ELSE
  old_status:=p.registry_status;
  UPDATE public.product SET registry_status='revoked',revoked_reason=coalesce(revoked_reason,btrim(p_reason)) WHERE id=p.id;
  p.registry_status:='revoked';
 END IF;
 result:=jsonb_build_object('ok',true,'action',p_action,'product_id',p.id,'device_id',d.id,
  'registry_status',p.registry_status,'device_status',d.status,
  'public_key_fingerprint',CASE WHEN d.id IS NULL THEN NULL ELSE encode(digest(CASE WHEN p_action='rotate_device_key' THEN p_new_public_key ELSE d.public_key END,'sha256'),'hex') END);
 INSERT INTO public.registry_event(actor_account_id,request_id,product_id,device_id,action,reason,old_public_key,new_public_key,previous_status,payload,result)
 VALUES(aid,p_request_id,p.id,d.id,p_action,btrim(p_reason),d.public_key,p_new_public_key,old_status,body,result) RETURNING id INTO eid;
 RETURN result||jsonb_build_object('event_id',eid);
END $$;
REVOKE ALL ON FUNCTION public.apply_registry_action(text,uuid,uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.operator_rotate_device_key(p_device_id uuid,p_expected_public_key text,p_new_public_key text,p_request_id uuid,p_reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.apply_registry_action('rotate_device_key',NULL,p_device_id,p_expected_public_key,p_new_public_key,p_request_id,p_reason);
$$;
CREATE FUNCTION public.operator_revoke_device(p_device_id uuid,p_request_id uuid,p_reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.apply_registry_action('revoke_device',NULL,p_device_id,NULL,NULL,p_request_id,p_reason);
$$;
CREATE FUNCTION public.operator_revoke_product(p_product_id uuid,p_request_id uuid,p_reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.apply_registry_action('revoke_product',p_product_id,NULL,NULL,NULL,p_request_id,p_reason);
$$;
CREATE FUNCTION public.operator_registry_history(p_product_id uuid,p_before_id bigint DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE events jsonb; next_id bigint;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 IF NOT public.privileged_role_active('operator') THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Verified operator session required.'); END IF;
 IF p_product_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before_id IS NOT NULL AND p_before_id<=0) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Product and valid page bounds required.'); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id DESC),'[]') INTO events FROM (
  SELECT id,action,device_id,reason,created_at,encode(digest(old_public_key,'sha256'),'hex') AS old_key_fingerprint,
   encode(digest(new_public_key,'sha256'),'hex') AS new_key_fingerprint
  FROM public.registry_event WHERE product_id=p_product_id AND (p_before_id IS NULL OR id<p_before_id)
  ORDER BY id DESC LIMIT p_limit
 ) e;
 IF jsonb_array_length(events)>0 THEN
  next_id:=(events->(jsonb_array_length(events)-1)->>'id')::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.registry_event WHERE product_id=p_product_id AND id<next_id) THEN next_id:=NULL; END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'events',events,'next_cursor',next_id);
END $$;
REVOKE ALL ON FUNCTION public.operator_rotate_device_key(uuid,text,text,uuid,text),public.operator_revoke_device(uuid,uuid,text),public.operator_revoke_product(uuid,uuid,text),public.operator_registry_history(uuid,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_rotate_device_key(uuid,text,text,uuid,text),public.operator_revoke_device(uuid,uuid,text),public.operator_revoke_product(uuid,uuid,text),public.operator_registry_history(uuid,bigint,integer) TO authenticated;
