-- SEC-01: activation uses the same live-session MFA gate as account reads.
-- Only the trusted signature-verifying edge may attest the exact Auth-validated JWT's assurance.
CREATE OR REPLACE FUNCTION public.issue_activation_nonce(p_serial text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  u uuid := auth.uid(); s uuid; a public.account; p public.product; d public.device;
  n uuid := gen_random_uuid(); expires timestamptz := clock_timestamp() + interval '5 minutes'; c text;
BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  BEGIN s := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN s := NULL; END;
  IF s IS NULL OR NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = s AND user_id = u) THEN RETURN jsonb_build_object('ok',false,'code','invalid_session','message','Authenticated session required.'); END IF;
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','mfa_required','message','Two-factor authentication required for this session.'); END IF;
  IF p_serial IS NULL OR length(btrim(p_serial)) NOT BETWEEN 1 AND 120 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_serial','message','Invalid product serial.');
  END IF;
  PERFORM public.ensure_my_account();
  -- Serialize issuance per account so concurrent requests cannot bypass the limit.
  SELECT * INTO a FROM public.account WHERE auth_user_id = u FOR UPDATE;
  SELECT * INTO p FROM public.product WHERE serial_public = upper(btrim(p_serial));
  IF NOT FOUND OR p.registry_status <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Product unavailable.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.ownership WHERE product_id = p.id AND end_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','already_owned','message','Product already claimed.');
  END IF;
  SELECT * INTO d FROM public.device WHERE product_id = p.id AND status = 'active' ORDER BY id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','device_unavailable','message','Active device required.'); END IF;
  IF (SELECT count(*) FROM public.activation_nonce WHERE account_id = a.id AND product_id = p.id AND created_at > clock_timestamp() - interval '5 minutes') >= 5 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Try again after five minutes.');
  END IF;
  c := jsonb_build_object('domain','smart-agro.activation.v1','account_id',a.id,'product_id',p.id,
    'device_id',d.id,'session_id',s,'nonce_id',n,'expires_at',expires,
    'random',encode(gen_random_bytes(32),'hex'))::text;
  INSERT INTO public.activation_nonce(id,account_id,auth_user_id,session_id,product_id,device_id,challenge,expires_at)
    VALUES(n,a.id,u,s,p.id,d.id,c,expires);
  RETURN jsonb_build_object('ok',true,'nonce_id',n,'challenge',c,'expires_at',expires);
END $$;

-- Replace the old overload: omitted assurance remains AAL1 for existing trusted callers.
-- An independently callable five-argument overload must not survive this migration.
REVOKE ALL ON FUNCTION public.claim_verified_product(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.claim_verified_product(uuid,uuid,uuid,text,text);
CREATE FUNCTION public.claim_verified_product(p_nonce_id uuid,p_auth_user_id uuid,p_session_id uuid,p_public_key text,p_sealed_code text, p_aal text DEFAULT 'aal1') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE n public.activation_nonce; p public.product; a public.activation; d public.device;
  oid uuid; artifact text; preimage text; ts timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO n FROM public.activation_nonce WHERE id = p_nonce_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','invalid_nonce','message','Challenge unavailable.'); END IF;
  -- Shared lock order for activation, revocation and future ownership operations.
  SELECT * INTO p FROM public.product WHERE id = n.product_id FOR UPDATE;
  SELECT * INTO a FROM public.activation WHERE product_id = p.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','activation_unavailable','message','Activation unavailable.'); END IF;
  SELECT * INTO n FROM public.activation_nonce WHERE id = p_nonce_id FOR UPDATE;
  SELECT * INTO d FROM public.device WHERE id = n.device_id FOR UPDATE;
  IF n.auth_user_id IS DISTINCT FROM p_auth_user_id OR n.session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('ok',false,'code','identity_mismatch','message','Challenge belongs to another session.');
  END IF;
  PERFORM 1 FROM auth.sessions WHERE id = p_session_id AND user_id = p_auth_user_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_session','message','Authenticated session required.');
  END IF;
  IF p_aal IS NULL OR p_aal NOT IN ('aal1','aal2') OR (p_aal <> 'aal2' AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id=p_auth_user_id AND status='verified')) THEN
    RETURN jsonb_build_object('ok',false,'code','mfa_required','message','Two-factor authentication required for this session.');
  END IF;
  IF d.product_id IS DISTINCT FROM p.id OR d.public_key IS DISTINCT FROM p_public_key OR d.status <> 'active' OR p.registry_status <> 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Product or device unavailable.');
  END IF;
  IF n.consumed_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ownership WHERE id = n.ownership_id AND account_id = n.account_id AND end_at IS NULL) THEN
      RETURN jsonb_build_object('ok',true,'ownership_id',n.ownership_id,'product_id',p.id,'idempotent',true);
    END IF;
    RETURN jsonb_build_object('ok',false,'code','claim_conflict','message','Ownership has changed.');
  END IF;
  IF n.expires_at <= clock_timestamp() OR n.attempts >= 5 THEN
    RETURN jsonb_build_object('ok',false,'code','nonce_exhausted','message','Challenge expired or exhausted.');
  END IF;
  IF a.consumed_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.ownership WHERE product_id = p.id AND end_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','already_owned','message','Product already claimed.');
  END IF;
  IF p_sealed_code IS NULL OR length(p_sealed_code) > 256 OR encode(digest(btrim(p_sealed_code),'sha256'),'hex') <> a.secret_hash THEN
    UPDATE public.activation_nonce SET attempts = attempts + 1 WHERE id = n.id;
    UPDATE public.activation SET failed_attempts = failed_attempts + 1 WHERE product_id = p.id;
    -- Return instead of raising: attempt counters must commit.
    RETURN jsonb_build_object('ok',false,'code','invalid_code','message','Activation code invalid.');
  END IF;
  INSERT INTO public.ownership(product_id,account_id,start_at) VALUES(p.id,n.account_id,ts) RETURNING id INTO oid;
  UPDATE public.activation SET consumed_by = n.account_id, consumed_at = ts WHERE product_id = p.id;
  UPDATE public.activation_nonce SET consumed_at = ts, ownership_id = oid WHERE id = n.id;
  preimage := jsonb_build_object('schema','smart-agro.claim-preimage.v1','product_id',p.id,
    'ownership_id',oid,'start_at',ts,'salt',encode(gen_random_bytes(32),'hex'))::text;
  artifact := jsonb_build_object('schema','smart-agro.claim-commitment.v1',
    'commitment',encode(digest(preimage,'sha256'),'hex'))::text;
  INSERT INTO public.outbox_job(event_key,kind,artifact_bytes,artifact_sha256,private_payload,chain_id,contract_address)
    VALUES('claim:' || oid::text,'ownership_claim',artifact,encode(digest(artifact,'sha256'),'hex'),preimage,'unconfigured','unconfigured');
  RETURN jsonb_build_object('ok',true,'ownership_id',oid,'product_id',p.id,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.claim_verified_product(uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verified_product(uuid,uuid,uuid,text,text,text) TO service_role;
