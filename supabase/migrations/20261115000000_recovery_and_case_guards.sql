-- Two integrity fixes found by review of 20261114100000 and 20261114150000. Function bodies are replaced in place
-- (CREATE OR REPLACE keeps their grants); the only schema change is one nullable column.

-- 1. A spent recovery code may be replayed for ten minutes so a failed factor removal can be retried. The replay used
--    to return whatever TOTP factors existed at that moment, so an authenticator enrolled right after recovery (the
--    normal next step) could be removed by anyone holding the spent code and the password. The factors present at the
--    first use are now recorded with the code, and a replay returns only those that still exist. Codes spent before
--    this migration have no record and replay as a no-op, which is the safe direction.
ALTER TABLE public.mfa_recovery_code ADD COLUMN factor_ids jsonb CHECK (factor_ids IS NULL OR jsonb_typeof(factor_ids) = 'array');

CREATE OR REPLACE FUNCTION public.consume_recovery_code(p_user_id uuid, p_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE h text; row public.mfa_recovery_code; captured jsonb; factors jsonb;
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
    SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO captured FROM auth.mfa_factors WHERE user_id = p_user_id AND factor_type = 'totp';
    UPDATE public.mfa_recovery_code SET used_at = clock_timestamp(), factor_ids = captured WHERE user_id = p_user_id AND code_hash = h;
    INSERT INTO public.mfa_recovery_attempt(user_id, succeeded) VALUES (p_user_id, true);
    INSERT INTO public.security_event(user_id, kind, detail) VALUES (p_user_id, 'mfa_recovered', 'Kode pemulihan dipakai');
  ELSE
    captured := coalesce(row.factor_ids, '[]'::jsonb);
  END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY created_at), '[]'::jsonb) INTO factors FROM auth.mfa_factors
    WHERE user_id = p_user_id AND factor_type = 'totp' AND id::text IN (SELECT jsonb_array_elements_text(captured));
  RETURN jsonb_build_object('ok',true,'factor_ids',factors);
END $$;

-- 2. An upheld reward case credits points through its own reward event, and operator_compensate_redemption refunds the
--    original debit. Run for the same redemption they refunded it twice. Each now refuses once the other has happened.
--    Lock order is account then redemption in both, so concurrent runs serialize on the owner's account row.
CREATE OR REPLACE FUNCTION public.operator_decide_reward_case(p_case_id uuid, p_request_id uuid, p_decision text, p_points integer, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE refusal jsonb; actor uuid; c public.reward_case; prior public.reward_case_event; clean text := btrim(p_reason); body jsonb; event_id uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  refusal := public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF p_case_id IS NULL OR p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('upheld','rejected')
    OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 1000
    OR (p_decision = 'rejected' AND p_points IS NOT NULL) OR (p_points IS NOT NULL AND p_points NOT BETWEEN 1 AND 100000) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Decision, reason and valid points required.'); END IF;
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid();
  body := jsonb_build_object('decision',p_decision,'points',p_points,'reason',clean);
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.reward-case.v1:' || actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO prior FROM public.reward_case_event WHERE actor_account_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.case_id <> p_case_id OR prior.action <> p_decision OR prior.payload <> body THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    SELECT * INTO c FROM public.reward_case WHERE id = p_case_id;
    RETURN jsonb_build_object('ok',true,'case_id',c.id,'status',c.status,'credited_points',c.credited_points,'idempotent',true);
  END IF;
  SELECT * INTO c FROM public.reward_case WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','case_unavailable','message','Case unavailable.'); END IF;
  IF c.status <> 'in_review' OR c.assignee_account_id IS DISTINCT FROM actor THEN
    RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Take the case before deciding it.'); END IF;
  IF p_decision = 'upheld' AND coalesce(p_points, c.proposed_points) IS NOT NULL THEN
    PERFORM 1 FROM public.account WHERE id = c.account_id FOR UPDATE;
    IF c.redemption_id IS NOT NULL AND (SELECT status FROM public.redemption WHERE id = c.redemption_id FOR UPDATE) = 'compensated' THEN
      RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Redemption was already compensated; reject the case instead.'); END IF;
    INSERT INTO public.reward_event(account_id, energy_window_id, source_event_key, policy_version, verification_status, points)
      VALUES (c.account_id, NULL, 'case:' || c.id::text, 'case-review', 'verified', coalesce(p_points, c.proposed_points)) RETURNING id INTO event_id;
    INSERT INTO public.ledger_entry(account_id, reward_event_id, signed_points, idempotency_key, note)
      VALUES (c.account_id, event_id, coalesce(p_points, c.proposed_points), 'case:' || c.id::text, 'Reward case decision: ' || clean);
  END IF;
  UPDATE public.reward_case SET status = p_decision, decision_reason = clean, decided_at = clock_timestamp(),
    reward_event_id = event_id, credited_points = CASE WHEN event_id IS NULL THEN NULL ELSE coalesce(p_points, c.proposed_points) END
    WHERE id = c.id;
  INSERT INTO public.reward_case_event(case_id, actor_account_id, action, request_id, payload) VALUES (c.id, actor, p_decision, p_request_id, body);
  RETURN jsonb_build_object('ok',true,'case_id',c.id,'status',p_decision,
    'credited_points',CASE WHEN event_id IS NULL THEN NULL ELSE coalesce(p_points, c.proposed_points) END,'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.operator_compensate_redemption(p_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE gate jsonb; r public.redemption; debit public.ledger_entry;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason','message','Compensation reason required.'); END IF;
  SELECT * INTO r FROM public.redemption WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','redemption_unavailable','message','Redemption unavailable.'); END IF;
  PERFORM 1 FROM public.account WHERE id=r.account_id OR auth_user_id=auth.uid() ORDER BY id FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id FOR UPDATE;
  gate:=public.privileged_write_gate('operator'); IF gate IS NOT NULL THEN RETURN gate; END IF;
  IF r.status='compensated' THEN RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status',r.status); END IF;
  IF r.status<>'fulfilled' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only fulfilled redemption may be compensated.'); END IF;
  IF EXISTS (SELECT 1 FROM public.reward_case WHERE redemption_id=r.id AND status='upheld' AND reward_event_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Redemption was already refunded through an upheld reward case.'); END IF;
  SELECT * INTO debit FROM public.ledger_entry WHERE redemption_id=r.id AND signed_points<0 AND reversal_of IS NULL;
  IF debit.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ledger_unavailable','message','Original debit required.'); END IF;
  INSERT INTO public.ledger_entry(account_id,redemption_id,signed_points,reversal_of,idempotency_key,note)
    VALUES(r.account_id,r.id,-debit.signed_points,debit.id,'compensate:'||r.id::text,btrim(p_reason));
  UPDATE public.redemption SET status='compensated',compensation_reason=btrim(p_reason) WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','compensated');
END $$;
