-- APP-01 (U02 "Masuk dan pulihkan akun"): one-time recovery codes for a lost authenticator. An owner with a fresh
-- authenticator code (≤5 minutes) creates ten codes, shown once and stored as salted SHA-256. After signing in with
-- the password (an aal1 session that cannot reach data while a factor is verified), the mfa-recovery function spends
-- one code through the service role, removes the authenticator through the Auth admin API and signs out other
-- sessions. Recovery starts the same 24-hour hold as other security changes. Failed attempts are rate limited.

ALTER TABLE public.security_event DROP CONSTRAINT security_event_kind_check;
ALTER TABLE public.security_event ADD CONSTRAINT security_event_kind_check CHECK (kind IN ('sign_in','mfa_enabled','mfa_removed',
  'password_changed','redemption_reserved','transfer_created','transfer_accepted','recovery_requested','recovery_decided',
  'recovery_codes_created','mfa_recovered'));

CREATE TABLE public.mfa_recovery_code (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE public.mfa_recovery_attempt (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mfa_recovery_attempt_recent ON public.mfa_recovery_attempt(user_id, created_at DESC);
ALTER TABLE public.mfa_recovery_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_recovery_code, public.mfa_recovery_attempt FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mfa_recovery_code, public.mfa_recovery_attempt TO service_role;

-- privileged_write_gate's freshness rule without a role: aal2 and a TOTP verification from the last five minutes.
CREATE FUNCTION public.fresh_second_factor() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE code_at numeric; checked_at numeric := extract(epoch FROM clock_timestamp());
BEGIN
  IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR jsonb_typeof(auth.jwt()->'amr') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT max((m->>'timestamp')::numeric) INTO code_at FROM jsonb_array_elements(auth.jwt()->'amr') m
    WHERE m->>'method' = 'totp' AND m->>'timestamp' ~ '^[0-9]{1,12}([.][0-9]{1,6})?$';
  RETURN code_at IS NOT NULL AND code_at >= checked_at - 300 AND code_at <= checked_at;
END $$;

-- Codes are 12 hexadecimal characters shown as XXXX-XXXX-XXXX (48 bits; five failures per hour).
CREATE FUNCTION public.recovery_code_hash(p_user_id uuid, p_code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, extensions AS $$
  SELECT encode(digest(p_user_id::text || ':' || upper(regexp_replace(coalesce(p_code,''), '[^0-9A-Fa-f]', '', 'g')), 'sha256'), 'hex')
$$;

CREATE FUNCTION public.create_my_recovery_codes() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE u uuid := auth.uid(); codes text[] := '{}'; c text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = u AND status = 'verified' AND factor_type = 'totp') THEN
    RETURN jsonb_build_object('ok',false,'code','mfa_required','message','Enable an authenticator first.'); END IF;
  IF NOT public.fresh_second_factor() THEN RETURN jsonb_build_object('ok',false,'code','step_up_required','message','Confirm with a fresh authenticator code.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.mfa-recovery.v1:' || u::text, 0));
  DELETE FROM public.mfa_recovery_code WHERE user_id = u;
  FOR i IN 1..10 LOOP
    c := upper(encode(gen_random_bytes(6), 'hex'));
    codes := codes || (substr(c,1,4) || '-' || substr(c,5,4) || '-' || substr(c,9,4));
    INSERT INTO public.mfa_recovery_code(user_id, code_hash) VALUES (u, public.recovery_code_hash(u, c));
  END LOOP;
  INSERT INTO public.security_event(user_id, kind) VALUES (u, 'recovery_codes_created');
  RETURN jsonb_build_object('ok',true,'codes',to_jsonb(codes));
END $$;

CREATE FUNCTION public.my_recovery_codes_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  RETURN (SELECT jsonb_build_object('ok',true,'total',count(*),'remaining',count(*) FILTER (WHERE used_at IS NULL),'created_at',max(created_at))
    FROM public.mfa_recovery_code WHERE user_id = auth.uid());
END $$;

-- Service role only (mfa-recovery). Returns the verified TOTP factors to remove. A code spent in the last ten minutes
-- by the same user is accepted again, so a failed factor removal can be retried with the same code.
CREATE FUNCTION public.consume_recovery_code(p_user_id uuid, p_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE h text; row public.mfa_recovery_code; factors jsonb;
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL OR length(p_code) > 32 OR length(regexp_replace(p_code, '[^0-9A-Fa-f]', '', 'g')) <> 12 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_code','message','Recovery code invalid.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.mfa-recovery.v1:' || p_user_id::text, 0));
  IF (SELECT count(*) FROM public.mfa_recovery_attempt WHERE user_id = p_user_id AND NOT succeeded AND created_at > clock_timestamp() - interval '1 hour') >= 5 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Too many attempts. Try again later.'); END IF;
  h := public.recovery_code_hash(p_user_id, p_code);
  SELECT * INTO row FROM public.mfa_recovery_code WHERE user_id = p_user_id AND code_hash = h FOR UPDATE;
  IF NOT FOUND OR (row.used_at IS NOT NULL AND row.used_at < clock_timestamp() - interval '10 minutes') THEN
    -- Return instead of raising: the failed attempt must commit.
    INSERT INTO public.mfa_recovery_attempt(user_id, succeeded) VALUES (p_user_id, false);
    RETURN jsonb_build_object('ok',false,'code','invalid_code','message','Recovery code invalid.'); END IF;
  IF row.used_at IS NULL THEN
    UPDATE public.mfa_recovery_code SET used_at = clock_timestamp() WHERE user_id = p_user_id AND code_hash = h;
    INSERT INTO public.mfa_recovery_attempt(user_id, succeeded) VALUES (p_user_id, true);
    INSERT INTO public.security_event(user_id, kind, detail) VALUES (p_user_id, 'mfa_recovered', 'Kode pemulihan dipakai');
  END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO factors FROM auth.mfa_factors WHERE user_id = p_user_id AND factor_type = 'totp';
  RETURN jsonb_build_object('ok',true,'factor_ids',factors);
END $$;

-- Codex's 24-hour hold (20261113005000) with recovery added: a stolen password plus a recovery code still waits a day
-- before points or ownership can move.
CREATE OR REPLACE FUNCTION public.security_hold_until() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT max(created_at) + interval '24 hours' FROM public.security_event
  WHERE user_id = auth.uid() AND kind IN ('mfa_enabled','password_changed','mfa_recovered') HAVING max(created_at) > now() - interval '24 hours'
$$;

REVOKE ALL ON FUNCTION public.fresh_second_factor(), public.recovery_code_hash(uuid,text), public.create_my_recovery_codes(),
  public.my_recovery_codes_status(), public.consume_recovery_code(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_my_recovery_codes(), public.my_recovery_codes_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_recovery_code(uuid,text) TO service_role;
