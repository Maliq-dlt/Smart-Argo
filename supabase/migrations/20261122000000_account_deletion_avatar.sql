-- Account deletion with a 14-day grace period, and a private profile photo (plan 2026-11-22, phase 1).
--
-- Asking to delete ends the account's product ownerships (anyone may claim them again), cancels its open transfer offers
-- and signs it out everywhere. Until the purge the account can sign in, but every function except the three below
-- answers 'unauthorized', so the only thing it can do is cancel. The purge deletes what the person wrote or placed
-- (gardens, plant names, care notes, questions, photo, sign-in log, the sign-in itself) and keeps a tombstone row,
-- because ownership history, reward ledgers, cases and chain records point at account ids and must stay consistent.

ALTER TABLE public.security_event DROP CONSTRAINT security_event_kind_check;
ALTER TABLE public.security_event ADD CONSTRAINT security_event_kind_check CHECK (kind IN ('sign_in','mfa_enabled','mfa_removed',
  'password_changed','redemption_reserved','transfer_created','transfer_accepted','recovery_requested','recovery_decided',
  'recovery_codes_created','mfa_recovered','deletion_requested','deletion_cancelled'));

CREATE TABLE public.account_deletion (
  account_id uuid PRIMARY KEY REFERENCES public.account(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  -- Products released at the request; cancelling gives back the ones nobody has claimed since.
  released uuid[] NOT NULL DEFAULT '{}',
  cancelled_at timestamptz,
  purged_at timestamptz,
  CHECK (purge_after = requested_at + interval '14 days'),
  CHECK (cancelled_at IS NULL OR purged_at IS NULL)
);
CREATE INDEX account_deletion_due ON public.account_deletion(purge_after) WHERE cancelled_at IS NULL AND purged_at IS NULL;

-- ponytail: the photo lives in Postgres because the local stack has no Storage service and the client sends one cropped
-- 256 px image (a few kB). Move it to a private Storage bucket if photos ever need to be larger or more numerous.
CREATE TABLE public.account_avatar (
  account_id uuid PRIMARY KEY REFERENCES public.account(id) ON DELETE RESTRICT,
  mime text NOT NULL CHECK (mime IN ('image/webp','image/jpeg','image/png')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 64 AND 262144),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.account_deletion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_avatar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion, public.account_avatar FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_deletion, public.account_avatar TO service_role;

-- The session check as it was: a live GoTrue session, at AAL2 when the account has an authenticator.
CREATE FUNCTION public.signed_in_session() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
DECLARE u uuid := auth.uid(); s uuid;
BEGIN
  IF u IS NULL THEN RETURN false; END IF;
  BEGIN s := nullif(auth.jwt()->>'session_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  RETURN s IS NOT NULL AND EXISTS (SELECT 1 FROM auth.sessions WHERE id = s AND user_id = u)
    AND (auth.jwt()->>'aal' = 'aal2' OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = u AND status = 'verified'));
END $$;

-- Every policy and function asks this one, so an account waiting to be deleted is inactive everywhere at once.
CREATE OR REPLACE FUNCTION public.current_auth_session() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN public.signed_in_session() AND NOT EXISTS (SELECT 1 FROM public.account_deletion d JOIN public.account a ON a.id = d.account_id
    WHERE a.auth_user_id = auth.uid() AND d.cancelled_at IS NULL AND d.purged_at IS NULL);
END $$;

-- Same freshness rule as create_transfer_offer: a sign-in within ten minutes, or an authenticator code from the last five
-- (Google accounts have no password to re-enter).
CREATE FUNCTION public.recently_verified() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.sessions WHERE id = nullif(auth.jwt()->>'session_id','')::uuid AND user_id = auth.uid()
      AND created_at > clock_timestamp() - interval '10 minutes')
    -- CASE, not AND: SQL does not promise to test the type before expanding the array or casting the timestamp.
    OR CASE WHEN auth.jwt()->>'aal' = 'aal2' AND jsonb_typeof(auth.jwt()->'amr') = 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(auth.jwt()->'amr') m
      WHERE m->>'method' = 'totp' AND CASE WHEN m->>'timestamp' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$'
        THEN (m->>'timestamp')::numeric >= extract(epoch FROM now()) - 300 ELSE false END) ELSE false END
$$;

CREATE FUNCTION public.deletion_json(d public.account_deletion) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('pending', d.account_id IS NOT NULL AND d.cancelled_at IS NULL AND d.purged_at IS NULL,
    'requested_at', d.requested_at, 'purge_after', d.purge_after,
    'released', coalesce((SELECT jsonb_agg(p.serial_public ORDER BY p.serial_public) FROM public.product p WHERE p.id = ANY(d.released)), '[]'::jsonb),
    -- Released products still unclaimed: the ones cancelling would give back.
    'restorable', coalesce((SELECT jsonb_agg(p.serial_public ORDER BY p.serial_public) FROM public.product p WHERE p.id = ANY(d.released)
      AND p.registry_status = 'active' AND NOT EXISTS (SELECT 1 FROM public.ownership o WHERE o.product_id = p.id AND o.end_at IS NULL)), '[]'::jsonb))
$$;

-- What the account owns now, for the confirmation step ("these products will be released").
CREATE FUNCTION public.my_account_deletion() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc public.account; d public.account_deletion;
BEGIN
  IF NOT public.signed_in_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'deletion',jsonb_build_object('pending',false),'products','[]'::jsonb); END IF;
  SELECT * INTO d FROM public.account_deletion WHERE account_id = acc.id;
  RETURN jsonb_build_object('ok',true,'deletion',CASE WHEN d.account_id IS NULL THEN jsonb_build_object('pending',false) ELSE public.deletion_json(d) END,
    'products',coalesce((SELECT jsonb_agg(p.serial_public ORDER BY p.serial_public) FROM public.ownership o JOIN public.product p ON p.id = o.product_id
      WHERE o.account_id = acc.id AND o.end_at IS NULL), '[]'::jsonb));
END $$;

CREATE FUNCTION public.request_account_deletion() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc public.account; d public.account_deletion; ts timestamptz := clock_timestamp(); rel uuid[];
BEGIN
  IF NOT public.signed_in_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  IF NOT public.recently_verified() THEN
    RETURN jsonb_build_object('ok',false,'code','reauth_required','message','Sign in again to confirm deleting the account.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','account_required','message','Create the account first.'); END IF;
  SELECT * INTO d FROM public.account_deletion WHERE account_id = acc.id AND cancelled_at IS NULL AND purged_at IS NULL;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'deletion',public.deletion_json(d)); END IF;
  -- Lock order as elsewhere: products first, then what hangs off them.
  PERFORM 1 FROM public.product p JOIN public.ownership o ON o.product_id = p.id WHERE o.account_id = acc.id AND o.end_at IS NULL FOR UPDATE OF p;
  UPDATE public.ownership_transfer SET status = 'cancelled', closed_at = ts WHERE status = 'open'
    AND from_ownership_id IN (SELECT id FROM public.ownership WHERE account_id = acc.id AND end_at IS NULL);
  WITH ended AS (UPDATE public.ownership SET end_at = ts WHERE account_id = acc.id AND end_at IS NULL RETURNING product_id)
    SELECT coalesce(array_agg(product_id), '{}') INTO rel FROM ended;
  INSERT INTO public.account_deletion(account_id, requested_at, purge_after, released) VALUES (acc.id, ts, ts + interval '14 days', rel)
    ON CONFLICT (account_id) DO UPDATE SET requested_at = EXCLUDED.requested_at, purge_after = EXCLUDED.purge_after,
      released = EXCLUDED.released, cancelled_at = NULL
    RETURNING * INTO d;
  INSERT INTO public.security_event(user_id, kind, detail) VALUES (auth.uid(), 'deletion_requested',
    left(coalesce((SELECT string_agg(serial_public, ', ' ORDER BY serial_public) FROM public.product WHERE id = ANY(rel)), ''), 200));
  -- Signed out everywhere: refresh tokens go with their sessions, and current_auth_session() refuses the access tokens.
  DELETE FROM auth.sessions WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok',true,'idempotent',false,'deletion',public.deletion_json(d));
END $$;

CREATE FUNCTION public.cancel_account_deletion() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc public.account; d public.account_deletion; ts timestamptz := clock_timestamp(); back text[];
BEGIN
  IF NOT public.signed_in_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid();
  SELECT * INTO d FROM public.account_deletion WHERE account_id = acc.id AND cancelled_at IS NULL AND purged_at IS NULL FOR UPDATE;
  IF d.account_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','no_pending_deletion','message','No deletion is waiting.'); END IF;
  PERFORM 1 FROM public.product WHERE id = ANY(d.released) ORDER BY id FOR UPDATE;
  WITH restored AS (
    INSERT INTO public.ownership(product_id, account_id, start_at)
      SELECT p.id, acc.id, ts FROM public.product p WHERE p.id = ANY(d.released) AND p.registry_status = 'active'
        AND NOT EXISTS (SELECT 1 FROM public.ownership o WHERE o.product_id = p.id AND o.end_at IS NULL)
      RETURNING product_id)
    SELECT coalesce(array_agg(p.serial_public ORDER BY p.serial_public), '{}') INTO back FROM restored r JOIN public.product p ON p.id = r.product_id;
  UPDATE public.account_deletion SET cancelled_at = ts WHERE account_id = acc.id;
  INSERT INTO public.security_event(user_id, kind, detail) VALUES (auth.uid(), 'deletion_cancelled', left(array_to_string(back, ', '), 200));
  RETURN jsonb_build_object('ok',true,'restored',to_jsonb(back),'lost',cardinality(d.released) - cardinality(back));
END $$;

-- A deleted account's plant history goes too; only a purge may delete a plant cycle.
CREATE OR REPLACE FUNCTION public.plant_cycle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('smart_agro.purging', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'plant_cycle is never deleted';
  END IF;
  IF OLD.ended_on IS NOT NULL THEN RAISE EXCEPTION 'a closed plant cycle cannot change'; END IF;
  IF (NEW.id, NEW.slot_id, NEW.account_id, NEW.request_id, NEW.species_id, NEW.plant_no, NEW.nickname, NEW.planted_on, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.slot_id, OLD.account_id, OLD.request_id, OLD.species_id, OLD.plant_no, OLD.nickname, OLD.planted_on, OLD.created_at) THEN
    RAISE EXCEPTION 'a plant cycle can only be closed'; END IF;
  RETURN NEW;
END $$;

-- Run daily by the service (scheduler outside the database). Kept: the account row as a tombstone, ownership history,
-- ledgers, reward and recovery cases, device and unit events, chain outbox rows: they hold ids, not what the person wrote.
CREATE FUNCTION public.purge_due_account_deletions(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d public.account_deletion; u uuid; n integer := 0;
BEGIN
  PERFORM set_config('smart_agro.purging', 'on', true);
  FOR d IN SELECT * FROM public.account_deletion WHERE cancelled_at IS NULL AND purged_at IS NULL AND purge_after <= clock_timestamp()
    ORDER BY purge_after LIMIT least(greatest(coalesce(p_limit, 20), 1), 200) FOR UPDATE SKIP LOCKED LOOP
    SELECT auth_user_id INTO u FROM public.account WHERE id = d.account_id FOR UPDATE;
    DELETE FROM public.community_contribution WHERE account_id = d.account_id;
    DELETE FROM public.care_journal WHERE account_id = d.account_id;
    DELETE FROM public.explanation_attempt WHERE account_id = d.account_id;
    DELETE FROM public.plant_cycle WHERE account_id = d.account_id;
    DELETE FROM public.garden_slot WHERE account_id = d.account_id;
    DELETE FROM public.garden_site WHERE account_id = d.account_id;
    DELETE FROM public.account_avatar WHERE account_id = d.account_id;
    DELETE FROM public.activation_nonce WHERE account_id = d.account_id;
    UPDATE public.account SET display_name = 'Akun dihapus', auth_subject = 'deleted:' || id::text, auth_user_id = NULL WHERE id = d.account_id;
    IF u IS NOT NULL THEN
      DELETE FROM public.security_event WHERE user_id = u;
      -- Email, identities, sessions, authenticators and recovery codes go with the GoTrue user.
      DELETE FROM auth.users WHERE id = u;
    END IF;
    UPDATE public.account_deletion SET purged_at = clock_timestamp(), released = '{}' WHERE account_id = d.account_id;
    n := n + 1;
  END LOOP;
  PERFORM set_config('smart_agro.purging', 'off', true);
  RETURN jsonb_build_object('ok',true,'purged',n);
END $$;

-- Profile photo: one small image per account, readable only by its owner.
CREATE FUNCTION public.set_my_avatar(p_mime text, p_data text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc uuid; b bytea; typed boolean; ts timestamptz := clock_timestamp();
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  SELECT id INTO acc FROM public.account WHERE auth_user_id = auth.uid();
  IF acc IS NULL THEN RETURN jsonb_build_object('ok',false,'code','account_required','message','Create the account first.'); END IF;
  IF p_mime IS NULL OR p_mime NOT IN ('image/webp','image/jpeg','image/png') OR p_data IS NULL OR length(p_data) > 350000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_image','message','A WebP, JPEG or PNG image up to 256 kB is required.'); END IF;
  BEGIN b := decode(p_data, 'base64');
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','invalid_image','message','The image is not valid base64.'); END;
  IF octet_length(b) > 262144 THEN RETURN jsonb_build_object('ok',false,'code','avatar_too_large','message','The image is larger than 256 kB.'); END IF;
  -- The bytes must be what the type says (magic numbers), so the stored mime is never a lie told to the next reader.
  -- An assignment, because plpgsql ends an IF condition at the first THEN, including one inside a CASE.
  typed := CASE p_mime
      WHEN 'image/png' THEN substring(b FROM 1 FOR 8) = '\x89504e470d0a1a0a'::bytea
      WHEN 'image/jpeg' THEN substring(b FROM 1 FOR 3) = '\xffd8ff'::bytea
      ELSE substring(b FROM 1 FOR 4) = '\x52494646'::bytea AND substring(b FROM 9 FOR 4) = '\x57454250'::bytea END;
  IF octet_length(b) < 64 OR NOT typed THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_image','message','The file is not the image type it claims to be.'); END IF;
  INSERT INTO public.account_avatar(account_id, mime, bytes, updated_at) VALUES (acc, p_mime, b, ts)
    ON CONFLICT (account_id) DO UPDATE SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, updated_at = EXCLUDED.updated_at;
  RETURN jsonb_build_object('ok',true,'updated_at',ts);
END $$;

CREATE FUNCTION public.clear_my_avatar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  DELETE FROM public.account_avatar WHERE account_id = (SELECT id FROM public.account WHERE auth_user_id = auth.uid());
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.my_avatar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a public.account_avatar;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  SELECT v.* INTO a FROM public.account_avatar v JOIN public.account c ON c.id = v.account_id WHERE c.auth_user_id = auth.uid();
  RETURN jsonb_build_object('ok',true,'avatar',CASE WHEN a.account_id IS NULL THEN NULL
    ELSE jsonb_build_object('mime',a.mime,'data',replace(encode(a.bytes,'base64'), E'\n', ''),'updated_at',a.updated_at) END);
END $$;

REVOKE ALL ON FUNCTION public.signed_in_session(), public.recently_verified(), public.deletion_json(public.account_deletion),
  public.my_account_deletion(), public.request_account_deletion(), public.cancel_account_deletion(), public.purge_due_account_deletions(integer),
  public.set_my_avatar(text,text), public.clear_my_avatar(), public.my_avatar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_account_deletion(), public.request_account_deletion(), public.cancel_account_deletion(),
  public.set_my_avatar(text,text), public.clear_my_avatar(), public.my_avatar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_due_account_deletions(integer) TO service_role;
