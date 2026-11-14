-- Privileged roles require enrolled TOTP, even when ordinary sessions may use AAL1.
CREATE FUNCTION public.privileged_role_active(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_role IN ('operator','curator') AND public.current_auth_session()
  AND auth.jwt()->>'aal'='aal2'
  AND EXISTS(SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND p_role=ANY(access_roles))
  AND EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=auth.uid() AND status='verified' AND factor_type='totp');
$$;

-- NULL permits the write. VOLATILE queries see revocation committed while a resource lock was pending.
CREATE FUNCTION public.privileged_write_gate(p_role text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=auth.uid(); s uuid; roles text[]; code_at numeric; checked_at numeric;
BEGIN
 IF u IS NULL OR NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 BEGIN s:=nullif(auth.jwt()->>'session_id','')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END;
 SELECT access_roles INTO roles FROM public.account WHERE auth_user_id=u FOR SHARE;
 IF p_role IS NULL OR p_role NOT IN ('operator','curator') OR roles IS NULL OR NOT(p_role=ANY(roles)) THEN
  RETURN jsonb_build_object('ok',false,'code','forbidden','message','Current privileged role required.'); END IF;
 -- GoTrue unenrollment locks the factor before downgrading sessions; use the same order.
 PERFORM 1 FROM auth.mfa_factors WHERE user_id=u AND status='verified' AND factor_type='totp' ORDER BY id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','mfa_required','message','Verified authenticator required.'); END IF;
 PERFORM 1 FROM auth.sessions WHERE id=s AND user_id=u FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 IF jsonb_typeof(auth.jwt()->'amr')='array' THEN
  SELECT max((m->>'timestamp')::numeric) INTO code_at
   FROM jsonb_array_elements(auth.jwt()->'amr') m
   WHERE m->>'method'='totp' AND m->>'timestamp' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$';
 END IF;
 checked_at:=extract(epoch FROM clock_timestamp());
 IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR code_at IS NULL OR code_at<checked_at-300 OR code_at>checked_at THEN
  RETURN jsonb_build_object('ok',false,'code','step_up_required','message','Confirm with a fresh authenticator code.'); END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.privileged_role_active(text),public.privileged_write_gate(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.operator_register_energy_meter(p_device_id uuid,p_public_key text,p_calibration_ref text,p_eligible_load_ref text,p_valid_from timestamptz,p_valid_until timestamptz,p_max_power_w numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE actor uuid; pid uuid; meter uuid; refusal jsonb;
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
 refusal:=public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
 INSERT INTO public.energy_meter(device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by)
 VALUES(p_device_id,p_public_key,btrim(p_calibration_ref),btrim(p_eligible_load_ref),p_valid_from,p_valid_until,p_max_power_w,actor) RETURNING id INTO meter;
 RETURN jsonb_build_object('ok',true,'meter_id',meter);
END $$;
CREATE OR REPLACE FUNCTION public.operator_revoke_energy_meter(p_meter_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE pid uuid; did uuid; m public.energy_meter; refusal jsonb;
BEGIN
 IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Operator role required.'); END IF;
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason','message','Reason required.'); END IF;
 SELECT device_id INTO did FROM public.energy_meter WHERE id=p_meter_id;
 SELECT product_id INTO pid FROM public.device WHERE id=did;
 PERFORM 1 FROM public.product WHERE id=pid FOR UPDATE; PERFORM 1 FROM public.device WHERE id=did FOR UPDATE;
 SELECT * INTO m FROM public.energy_meter WHERE id=p_meter_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','meter_unavailable','message','Meter unavailable.'); END IF;
 refusal:=public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
 IF m.status='active' THEN UPDATE public.energy_meter SET status='revoked',revoked_reason=btrim(p_reason),revoked_at=clock_timestamp() WHERE id=m.id; END IF;
 RETURN jsonb_build_object('ok',true,'meter_id',m.id,'status','revoked');
END $$;
