-- Phase 1: authenticated ownership; browser demo remains separate.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER TABLE public.account ADD COLUMN auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT;
-- Commitment preimages remain private under outbox RLS and table privileges.
ALTER TABLE public.outbox_job ADD COLUMN private_payload text;

CREATE TABLE public.activation_nonce (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
  challenge text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (ownership_id IS NULL))
);
CREATE INDEX activation_nonce_rate_limit ON public.activation_nonce(account_id, product_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account','product','activation','ownership','device','plant_profile','contribution','review','profile_version','unit','measurement','ai_snapshot','energy_window','reward_event','catalog_item','redemption','ledger_entry','outbox_job','activation_nonce'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;
CREATE FUNCTION public.current_auth_session() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE u uuid := auth.uid(); s uuid;
BEGIN
  IF u IS NULL THEN RETURN false; END IF;
  BEGIN s := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  RETURN s IS NOT NULL AND EXISTS (SELECT 1 FROM auth.sessions WHERE id = s AND user_id = u);
END $$;
REVOKE ALL ON FUNCTION public.current_auth_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_auth_session() TO authenticated;

GRANT SELECT ON public.account, public.ownership, public.product TO authenticated;
CREATE POLICY phase1_account_read ON public.account FOR SELECT TO authenticated
  USING ((SELECT public.current_auth_session()) AND auth_user_id = (SELECT auth.uid()));
CREATE POLICY phase1_ownership_read ON public.ownership FOR SELECT TO authenticated
  USING ((SELECT public.current_auth_session()) AND account_id IN (SELECT id FROM public.account WHERE auth_user_id = (SELECT auth.uid())));
CREATE POLICY phase1_product_read ON public.product FOR SELECT TO authenticated
  USING ((SELECT public.current_auth_session()) AND id IN (SELECT product_id FROM public.ownership WHERE end_at IS NULL));

CREATE FUNCTION public.ensure_my_account() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE a public.account; u uuid := auth.uid();
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  INSERT INTO public.account(auth_subject, auth_user_id, display_name, access_roles)
    VALUES ('supabase:' || u::text, u, 'Gardener', ARRAY['owner']::text[])
    ON CONFLICT (auth_user_id) DO NOTHING;
  SELECT * INTO a FROM public.account WHERE auth_user_id = u;
  RETURN jsonb_build_object('ok',true,'account',jsonb_build_object('id',a.id,'display_name',a.display_name,'access_roles',a.access_roles));
END $$;

CREATE FUNCTION public.issue_activation_nonce(p_serial text) RETURNS jsonb
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

CREATE FUNCTION public.get_activation_proof(p_nonce_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE n public.activation_nonce; d public.device;
BEGIN
  SELECT * INTO n FROM public.activation_nonce WHERE id = p_nonce_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','invalid_nonce','message','Challenge unavailable.'); END IF;
  SELECT * INTO d FROM public.device WHERE id = n.device_id;
  RETURN jsonb_build_object('ok',true,'auth_user_id',n.auth_user_id,'session_id',n.session_id,
    'challenge',n.challenge,'public_key',d.public_key,'device_id',n.device_id,'product_id',n.product_id);
END $$;

-- Only the trusted signature-verifying server may call this function.
CREATE FUNCTION public.claim_verified_product(p_nonce_id uuid,p_auth_user_id uuid,p_session_id uuid,p_public_key text,p_sealed_code text) RETURNS jsonb
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
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = p_session_id AND user_id = p_auth_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_session','message','Authenticated session required.');
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

CREATE FUNCTION public.my_products() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
  SELECT jsonb_build_object('ok',public.current_auth_session(),'products',coalesce(jsonb_agg(jsonb_build_object(
    'ownership_id',o.id,'product_id',p.id,'serial_public',p.serial_public,'variant',p.variant,'start_at',o.start_at
  ) ORDER BY o.start_at DESC),'[]'::jsonb))
  FROM public.ownership o JOIN public.account a ON a.id = o.account_id JOIN public.product p ON p.id = o.product_id
  WHERE public.current_auth_session() AND a.auth_user_id = auth.uid() AND o.end_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_account(), public.issue_activation_nonce(text), public.my_products(), public.get_activation_proof(uuid), public.claim_verified_product(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_account(), public.issue_activation_nonce(text), public.my_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_activation_proof(uuid), public.claim_verified_product(uuid,uuid,uuid,text,text) TO service_role;
