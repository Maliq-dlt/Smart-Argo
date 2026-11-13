-- Account protection for value-moving actions, modelled on exchange withdrawals:
-- once TOTP is on, every session needs it; redemptions need TOTP, a fresh code, no
-- security change in the last 24 h, and stay under a daily count.

CREATE TABLE public.security_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- ponytail: no FK to auth.users, so auth cascades never block; purge with the account once deletion exists.
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sign_in','mfa_enabled','mfa_removed','password_changed','redemption_reserved','transfer_created','transfer_accepted')),
  detail text CHECK (length(detail) <= 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX security_event_user ON public.security_event(user_id, created_at DESC);
ALTER TABLE public.security_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_event FROM PUBLIC, anon, authenticated;

-- Auth writes these rows itself, so the log cannot be skipped by calling the Auth API directly.
CREATE FUNCTION public.log_auth_security_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    INSERT INTO public.security_event(user_id, kind, detail) VALUES (NEW.user_id, 'sign_in', left(NEW.user_agent, 200));
  ELSIF TG_TABLE_NAME = 'users' THEN
    INSERT INTO public.security_event(user_id, kind) VALUES (NEW.id, 'password_changed');
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'verified' THEN INSERT INTO public.security_event(user_id, kind, detail) VALUES (OLD.user_id, 'mfa_removed', left(OLD.friendly_name, 200)); END IF;
    RETURN OLD;
  ELSIF NEW.status = 'verified' AND OLD.status <> 'verified' THEN
    INSERT INTO public.security_event(user_id, kind, detail) VALUES (NEW.user_id, 'mfa_enabled', left(NEW.friendly_name, 200));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_auth_security_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER smart_agro_sign_in AFTER INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.log_auth_security_event();
CREATE TRIGGER smart_agro_password AFTER UPDATE OF encrypted_password ON auth.users FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password) EXECUTE FUNCTION public.log_auth_security_event();
CREATE TRIGGER smart_agro_mfa AFTER UPDATE OF status OR DELETE ON auth.mfa_factors FOR EACH ROW EXECUTE FUNCTION public.log_auth_security_event();

-- A session without its second factor (aal1) sees nothing once the account has a verified TOTP factor.
CREATE OR REPLACE FUNCTION public.current_auth_session() RETURNS boolean
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

CREATE FUNCTION public.security_hold_until() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT max(created_at) + interval '24 hours' FROM public.security_event
  WHERE user_id = auth.uid() AND kind IN ('mfa_enabled','password_changed') HAVING max(created_at) > now() - interval '24 hours'
$$;

-- NULL when a value-moving action may proceed; otherwise the refusal to return.
CREATE FUNCTION public.value_action_gate() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE hold timestamptz := public.security_hold_until(); code_at numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified') THEN
    RETURN jsonb_build_object('ok',false,'code','mfa_required','message','Two-factor authentication required.'); END IF;
  IF hold IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','security_hold','message','Paused for 24 hours after a security change.','until',hold); END IF;
  SELECT max((m->>'timestamp')::numeric) INTO code_at FROM jsonb_array_elements(auth.jwt()->'amr') m WHERE m->>'method' = 'totp';
  IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' OR coalesce(code_at, 0) < extract(epoch FROM now()) - 300 THEN
    RETURN jsonb_build_object('ok',false,'code','step_up_required','message','Confirm with a fresh authenticator code.'); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.security_hold_until(), public.value_action_gate() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.security_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE events jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC), '[]') INTO events
    FROM (SELECT kind, detail, created_at FROM public.security_event WHERE user_id = auth.uid() ORDER BY created_at DESC, id DESC LIMIT 20) e;
  RETURN jsonb_build_object('ok',true,
    'mfa_enabled', EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified'),
    'hold_until', public.security_hold_until(), 'events', events);
END $$;
REVOKE ALL ON FUNCTION public.security_workspace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_workspace() TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_my_reward(p_item_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE a public.account; item public.catalog_item; old public.redemption; rid uuid; balance bigint; reserved bigint; key text; refusal jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Request identity required.'); END IF;
  SELECT * INTO a FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','account_unavailable','message','Account required.'); END IF;
  key:=a.id::text||':'||p_request_id::text;
  SELECT * INTO old FROM public.redemption WHERE idempotency_key=key AND account_id=a.id;
  IF FOUND THEN
    IF old.catalog_item_id IS DISTINCT FROM p_item_id THEN RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already names another catalogue item.'); END IF;
    RETURN jsonb_build_object('ok',true,'redemption_id',old.id,'status',old.status,'reserved_points',old.reserved_points);
  END IF;
  -- Replays above return the original result; only new reservations pass the gate.
  refusal:=public.value_action_gate();
  IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF (SELECT count(*) FROM public.redemption WHERE account_id=a.id AND created_at>now()-interval '24 hours')>=10 THEN
    RETURN jsonb_build_object('ok',false,'code','limit_reached','message','Daily reservation limit reached.'); END IF;
  SELECT * INTO item FROM public.catalog_item WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND OR item.availability<>'available' OR item.stock_total-item.stock_reserved<1 THEN
    RETURN jsonb_build_object('ok',false,'code','item_unavailable','message','Catalogue stock unavailable.'); END IF;
  SELECT coalesce(sum(signed_points),0) INTO balance FROM public.ledger_entry WHERE account_id=a.id;
  SELECT coalesce(sum(reserved_points),0) INTO reserved FROM public.redemption WHERE account_id=a.id AND status='reserved';
  IF balance-reserved<item.point_cost THEN RETURN jsonb_build_object('ok',false,'code','insufficient_points','message','Available confirmed points insufficient.'); END IF;
  INSERT INTO public.redemption(account_id,catalog_item_id,reserved_points,idempotency_key) VALUES(a.id,item.id,item.point_cost,key) RETURNING id INTO rid;
  UPDATE public.catalog_item SET stock_reserved=stock_reserved+1 WHERE id=item.id;
  INSERT INTO public.security_event(user_id,kind,detail) VALUES(auth.uid(),'redemption_reserved',left(item.title,160)||' · '||item.point_cost||' poin');
  RETURN jsonb_build_object('ok',true,'redemption_id',rid,'status','reserved','reserved_points',item.point_cost);
END $$;
