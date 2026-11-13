-- ID-01 public registry status and ID-03 ownership transfer (docs/diagram/v2/SPESIFIKASI.md §2-3).

-- ID-01: whoever holds the public QR can see whether its serial is registered, revoked or already claimed.
-- No owner identity leaves the database. Registry status is not proof of physical authenticity.
CREATE FUNCTION public.product_public_status(p_serial text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
  SELECT coalesce((SELECT jsonb_build_object('ok',true,'serial_public',p.serial_public,'variant',p.variant,'registry_status',p.registry_status,
      'claimed',EXISTS (SELECT 1 FROM public.ownership o WHERE o.product_id = p.id AND o.end_at IS NULL))
    FROM public.product p WHERE length(p_serial) <= 120 AND p.serial_public = upper(btrim(p_serial))),
    jsonb_build_object('ok',false,'code','not_registered','message','Serial is not in the registry.'));
$$;

-- ID-03: the owner re-authenticates and gets a one-time code; the recipient enters serial and code. The code is
-- 128 random bits shown once, stored only as SHA-256, valid 24 hours and five wrong attempts.
CREATE TABLE public.ownership_transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE RESTRICT,
  from_ownership_id uuid NOT NULL REFERENCES public.ownership(id) ON DELETE RESTRICT,
  to_ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','cancelled')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX ownership_transfer_one_open ON public.ownership_transfer(product_id) WHERE status = 'open';
ALTER TABLE public.ownership_transfer ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_transfer FROM PUBLIC, anon, authenticated;

ALTER TABLE public.outbox_job DROP CONSTRAINT outbox_job_kind_check;
ALTER TABLE public.outbox_job ADD CONSTRAINT outbox_job_kind_check CHECK (kind IN ('product_manifest','ownership_claim','ownership_transfer','ledger_anchor'));

CREATE FUNCTION public.create_transfer_offer(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE p public.product; own public.ownership; code text := upper(encode(gen_random_bytes(16),'hex'));
  tid uuid; expires timestamptz := clock_timestamp() + interval '24 hours';
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  -- Re-authentication: a sign-in within the last ten minutes, or an authenticator code from the last five
  -- (Google accounts have no password to re-enter; same freshness rule as value_action_gate).
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = (auth.jwt()->>'session_id')::uuid AND created_at > clock_timestamp() - interval '10 minutes')
     AND NOT (auth.jwt()->>'aal' = 'aal2' AND EXISTS (SELECT 1 FROM jsonb_array_elements(auth.jwt()->'amr') m
       WHERE m->>'method' = 'totp' AND (m->>'timestamp')::numeric >= extract(epoch FROM now()) - 300)) THEN
    RETURN jsonb_build_object('ok',false,'code','reauth_required','message','Sign in again to confirm the transfer.'); END IF;
  SELECT * INTO p FROM public.product WHERE id = p_product_id FOR UPDATE;
  SELECT o.* INTO own FROM public.ownership o JOIN public.account a ON a.id = o.account_id
    WHERE o.product_id = p_product_id AND o.end_at IS NULL AND a.auth_user_id = auth.uid() FOR UPDATE OF o;
  IF own.id IS NULL OR p.registry_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','not_owner','message','Active ownership of an active product required.'); END IF;
  UPDATE public.ownership_transfer SET status = 'cancelled', closed_at = clock_timestamp() WHERE product_id = p.id AND status = 'open';
  INSERT INTO public.ownership_transfer(product_id,from_ownership_id,code_hash,expires_at)
    VALUES (p.id, own.id, encode(digest(code,'sha256'),'hex'), expires) RETURNING id INTO tid;
  INSERT INTO public.security_event(user_id,kind,detail) VALUES (auth.uid(),'transfer_created',p.serial_public);
  RETURN jsonb_build_object('ok',true,'transfer_id',tid,'code',code,'expires_at',expires);
END $$;

CREATE FUNCTION public.cancel_transfer_offer(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  UPDATE public.ownership_transfer t SET status = 'cancelled', closed_at = clock_timestamp()
    FROM public.ownership o JOIN public.account a ON a.id = o.account_id
    WHERE t.product_id = p_product_id AND t.status = 'open' AND o.id = t.from_ownership_id AND o.end_at IS NULL AND a.auth_user_id = auth.uid();
  RETURN jsonb_build_object('ok',true,'cancelled',FOUND);
END $$;

CREATE FUNCTION public.accept_transfer(p_serial text, p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE acc public.account; p public.product; t public.ownership_transfer; old public.ownership; nid uuid;
  ts timestamptz := clock_timestamp(); preimage text; artifact text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','account_required','message','Create the account first.'); END IF;
  -- Same lock order as activation: product, then the rows that hang off it.
  SELECT * INTO p FROM public.product WHERE length(p_serial) <= 120 AND serial_public = upper(btrim(p_serial)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','transfer_unavailable','message','No open transfer for this serial.'); END IF;
  SELECT * INTO t FROM public.ownership_transfer WHERE product_id = p.id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    -- A retry after success returns the same ownership.
    IF EXISTS (SELECT 1 FROM public.ownership_transfer x JOIN public.ownership o ON o.id = x.to_ownership_id
      WHERE x.product_id = p.id AND x.status = 'accepted' AND o.account_id = acc.id AND o.end_at IS NULL) THEN
      RETURN jsonb_build_object('ok',true,'product_id',p.id,'idempotent',true); END IF;
    RETURN jsonb_build_object('ok',false,'code','transfer_unavailable','message','No open transfer for this serial.');
  END IF;
  SELECT * INTO old FROM public.ownership WHERE id = t.from_ownership_id FOR UPDATE;
  IF t.expires_at <= ts OR t.attempts >= 5 OR old.end_at IS NOT NULL OR p.registry_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','transfer_unavailable','message','Transfer expired, exhausted or no longer valid.'); END IF;
  IF old.account_id = acc.id THEN RETURN jsonb_build_object('ok',false,'code','self_transfer','message','You already own this product.'); END IF;
  IF p_code IS NULL OR length(p_code) > 64 OR encode(digest(upper(regexp_replace(p_code,'[^0-9A-Fa-f]','','g')),'sha256'),'hex') <> t.code_hash THEN
    UPDATE public.ownership_transfer SET attempts = attempts + 1 WHERE id = t.id;
    -- Return instead of raising: the attempt counter must commit.
    RETURN jsonb_build_object('ok',false,'code','invalid_code','message','Transfer code invalid.');
  END IF;
  UPDATE public.ownership SET end_at = ts WHERE id = old.id;
  INSERT INTO public.ownership(product_id,account_id,start_at) VALUES (p.id, acc.id, ts) RETURNING id INTO nid;
  UPDATE public.ownership_transfer SET status = 'accepted', to_ownership_id = nid, closed_at = ts WHERE id = t.id;
  preimage := jsonb_build_object('schema','smart-agro.transfer-preimage.v1','product_id',p.id,'from_ownership_id',old.id,
    'to_ownership_id',nid,'at',ts,'salt',encode(gen_random_bytes(32),'hex'))::text;
  artifact := jsonb_build_object('schema','smart-agro.transfer-commitment.v1','commitment',encode(digest(preimage,'sha256'),'hex'))::text;
  INSERT INTO public.outbox_job(event_key,kind,artifact_bytes,artifact_sha256,private_payload,chain_id,contract_address)
    VALUES ('transfer:' || t.id::text,'ownership_transfer',artifact,encode(digest(artifact,'sha256'),'hex'),preimage,'unconfigured','unconfigured');
  INSERT INTO public.security_event(user_id,kind,detail)
    SELECT auth_user_id,'transfer_accepted',p.serial_public||CASE WHEN id = acc.id THEN ' · diterima' ELSE ' · dilepas' END FROM public.account WHERE id IN (acc.id, old.account_id);
  RETURN jsonb_build_object('ok',true,'ownership_id',nid,'product_id',p.id,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.product_public_status(text), public.create_transfer_offer(uuid), public.cancel_transfer_offer(uuid), public.accept_transfer(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_public_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_offer(uuid), public.cancel_transfer_offer(uuid), public.accept_transfer(text,text) TO authenticated;
