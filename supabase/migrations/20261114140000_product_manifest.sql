-- ID-01 / ID-04 (U03, A04, A08): official products carry a manifest signed by the issuer. The manifest is the exact
-- signed bytes (canonical JSON chosen by the issuer, no personal data and no activation code). The issuer's public
-- keys are pinned in the edge function's environment, outside operator control; the product-provision function
-- verifies the Ed25519 signature and records the manifest hash here with the service role. The operator then
-- provisions with their own session (TOTP gate), and only an attested manifest is accepted, so calling this RPC
-- directly cannot register an unsigned product. Public status reports whether a product has an attested manifest.
-- Database-only products created before this migration keep working and report issuer_verified = false.

ALTER TABLE public.product ADD COLUMN manifest text CHECK (manifest IS NULL OR octet_length(manifest) BETWEEN 2 AND 8192);
ALTER TABLE public.product ADD COLUMN issuer_key_id text;
ALTER TABLE public.product ADD CONSTRAINT product_manifest_pair CHECK ((manifest IS NULL) = (issuer_key_id IS NULL));

ALTER TABLE public.registry_event DROP CONSTRAINT registry_event_action_check;
ALTER TABLE public.registry_event ADD CONSTRAINT registry_event_action_check CHECK (action IN ('rotate_device_key','revoke_device','revoke_product','provision_product'));

CREATE TABLE public.issuer_attestation (
  manifest_sha256 text PRIMARY KEY CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  issuer_key_id text NOT NULL CHECK (issuer_key_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  signature text NOT NULL CHECK (signature ~ '^[A-Za-z0-9+/]{86}==$'),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.issuer_attestation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issuer_attestation FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.issuer_attestation TO service_role;

-- Service role only: called by product-provision after the signature verified against a pinned issuer key.
CREATE FUNCTION public.attest_issuer_manifest(p_manifest text, p_key_id text, p_signature text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE h text;
BEGIN
  IF p_manifest IS NULL OR octet_length(p_manifest) NOT BETWEEN 2 AND 8192 OR p_key_id IS NULL OR p_key_id !~ '^[a-z0-9][a-z0-9-]{2,63}$'
    OR p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9+/]{86}==$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Manifest, key id and signature required.'); END IF;
  h := encode(digest(p_manifest,'sha256'),'hex');
  INSERT INTO public.issuer_attestation(manifest_sha256, issuer_key_id, signature) VALUES (h, p_key_id, p_signature) ON CONFLICT (manifest_sha256) DO NOTHING;
  RETURN jsonb_build_object('ok',true,'manifest_sha256',h);
END $$;

CREATE FUNCTION public.operator_provision_product(p_request_id uuid, p_manifest text, p_signature text, p_activation_secret_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE refusal jsonb; actor uuid; m jsonb; h text; serial text; variant text; keys text[]; k text; pid uuid; prior public.registry_event;
  body jsonb; result jsonb; att public.issuer_attestation; artifact text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  refusal := public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF p_request_id IS NULL OR p_manifest IS NULL OR octet_length(p_manifest) NOT BETWEEN 2 AND 8192 OR p_signature IS NULL
    OR p_activation_secret_hash IS NULL OR p_activation_secret_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Request id, manifest, signature and activation hash required.'); END IF;
  BEGIN m := p_manifest::jsonb; EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'code','invalid_manifest','message','Manifest is not JSON.'); END;
  -- Separate IFs on purpose: SQL may evaluate OR operands in any order, and the object/array functions below must
  -- only see values whose type was already checked.
  IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR jsonb_typeof(m->'serial_public') IS DISTINCT FROM 'string'
    OR jsonb_typeof(m->'device_public_keys') IS DISTINCT FROM 'array' OR jsonb_typeof(m->'issued_at') IS DISTINCT FROM 'string'
    OR jsonb_typeof(m->'issuer_key_id') IS DISTINCT FROM 'string' OR jsonb_typeof(m->'variant') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_manifest','message','Manifest fields are missing or have the wrong type.'); END IF;
  IF m->>'schema' IS DISTINCT FROM 'smart-agro.product-manifest.v1'
    OR (SELECT count(*) FROM jsonb_object_keys(m) x WHERE x NOT IN ('schema','serial_public','variant','device_public_keys','issued_at','issuer_key_id')) > 0
    OR (m->>'serial_public') !~ '^[A-Z0-9][A-Z0-9._-]{2,119}$' OR m->>'variant' NOT IN ('single_pot','garden')
    OR jsonb_array_length(m->'device_public_keys') NOT BETWEEN 1 AND 32
    OR (m->>'variant' = 'single_pot' AND jsonb_array_length(m->'device_public_keys') <> 1)
    OR (m->>'issued_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$'
    OR (m->>'issuer_key_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(m->'device_public_keys') e WHERE jsonb_typeof(e) <> 'string') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_manifest','message','Manifest fields are invalid.'); END IF;
  serial := m->>'serial_public'; variant := m->>'variant';
  SELECT array_agg(value ORDER BY ord) INTO keys FROM jsonb_array_elements_text(m->'device_public_keys') WITH ORDINALITY AS e(value, ord);
  IF EXISTS (SELECT 1 FROM unnest(keys) k2 WHERE CASE WHEN k2 !~ '^[A-Za-z0-9+/]{43}=$' THEN true ELSE encode(decode(k2,'base64'),'base64') <> k2 END)
    OR (SELECT count(DISTINCT k3) FROM unnest(keys) k3) <> cardinality(keys) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_manifest','message','Device keys must be distinct canonical 32-byte keys.'); END IF;
  h := encode(digest(p_manifest,'sha256'),'hex');
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid();
  body := jsonb_build_object('action','provision_product','manifest_sha256',h,'activation_secret_hash',p_activation_secret_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.registry.v1:' || actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO prior FROM public.registry_event WHERE actor_account_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.payload IS DISTINCT FROM body THEN RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN prior.result || jsonb_build_object('idempotent',true);
  END IF;
  SELECT * INTO att FROM public.issuer_attestation WHERE manifest_sha256 = h;
  IF NOT FOUND OR att.signature <> p_signature OR att.issuer_key_id <> m->>'issuer_key_id' THEN
    RETURN jsonb_build_object('ok',false,'code','manifest_unverified','message','Submit the manifest through product-provision.'); END IF;
  IF EXISTS (SELECT 1 FROM public.product WHERE serial_public = serial) THEN
    RETURN jsonb_build_object('ok',false,'code','serial_taken','message','Serial already registered.'); END IF;
  IF EXISTS (SELECT 1 FROM public.device_key_history WHERE public_key = ANY(keys)) OR EXISTS (SELECT 1 FROM public.device WHERE public_key = ANY(keys)) THEN
    RETURN jsonb_build_object('ok',false,'code','key_in_use','message','A device key is already registered.'); END IF;
  INSERT INTO public.product(serial_public, variant, registry_status, issuer_signature, manifest, issuer_key_id)
    VALUES (serial, variant, 'active', p_signature, p_manifest, m->>'issuer_key_id') RETURNING id INTO pid;
  INSERT INTO public.activation(product_id, secret_hash) VALUES (pid, p_activation_secret_hash);
  FOREACH k IN ARRAY keys LOOP INSERT INTO public.device(product_id, public_key) VALUES (pid, k); END LOOP;
  -- A08: the signed manifest is already public and carries no personal data, so it is the artifact itself.
  artifact := p_manifest;
  INSERT INTO public.outbox_job(event_key, kind, artifact_bytes, artifact_sha256, chain_id, contract_address)
    VALUES ('manifest:' || pid::text, 'product_manifest', artifact, h, 'unconfigured', 'unconfigured');
  result := jsonb_build_object('ok',true,'product_id',pid,'serial_public',serial,'devices',cardinality(keys),'manifest_sha256',h);
  INSERT INTO public.registry_event(actor_account_id, request_id, product_id, action, reason, previous_status, payload, result)
    VALUES (actor, p_request_id, pid, 'provision_product', 'Provisioned from an issuer-signed manifest', 'unregistered', body, result);
  RETURN result || jsonb_build_object('idempotent',false);
END $$;

-- Public check (ID-01): the manifest and signature let anyone re-verify against the published issuer key; the
-- attestation flag says the server verified it at provisioning. A registered serial still does not prove the physical
-- item in hand is genuine (a QR can be copied).
CREATE OR REPLACE FUNCTION public.product_public_status(p_serial text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
  SELECT coalesce((SELECT jsonb_build_object('ok',true,'serial_public',p.serial_public,'variant',p.variant,'registry_status',p.registry_status,
      'claimed',EXISTS (SELECT 1 FROM public.ownership o WHERE o.product_id = p.id AND o.end_at IS NULL),
      'manifest',p.manifest,'issuer_key_id',p.issuer_key_id,'issuer_signature',CASE WHEN p.manifest IS NULL THEN NULL ELSE p.issuer_signature END,
      'issuer_verified',p.manifest IS NOT NULL AND EXISTS (SELECT 1 FROM public.issuer_attestation a
        WHERE a.manifest_sha256 = encode(digest(p.manifest,'sha256'),'hex') AND a.signature = p.issuer_signature AND a.issuer_key_id = p.issuer_key_id))
    FROM public.product p WHERE length(p_serial) <= 120 AND p.serial_public = upper(btrim(p_serial))),
    jsonb_build_object('ok',false,'code','not_registered','message','Serial is not in the registry.'));
$$;

REVOKE ALL ON FUNCTION public.attest_issuer_manifest(text,text,text), public.operator_provision_product(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attest_issuer_manifest(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.operator_provision_product(uuid,text,text,text) TO authenticated;
