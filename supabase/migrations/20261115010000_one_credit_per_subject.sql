-- A redemption or an energy window may be refunded or credited once. 20261115000000 made compensation and an upheld case
-- exclude each other, but a second appeal can be opened on the same subject after the first case is decided, and upholding
-- both credited it twice. The database now allows one credited upheld case per subject (the unique indexes are the
-- guarantee) and the decision refuses early with a clear code instead of failing on the index.
CREATE UNIQUE INDEX reward_case_one_credit_per_redemption ON public.reward_case (redemption_id)
  WHERE status = 'upheld' AND reward_event_id IS NOT NULL;
CREATE UNIQUE INDEX reward_case_one_credit_per_window ON public.reward_case (energy_window_id)
  WHERE status = 'upheld' AND reward_event_id IS NOT NULL;

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
    -- Cases of one subject belong to one account, so this lock serializes their decisions; the indexes remain the backstop.
    PERFORM 1 FROM public.account WHERE id = c.account_id FOR UPDATE;
    IF c.redemption_id IS NOT NULL AND (SELECT status FROM public.redemption WHERE id = c.redemption_id FOR UPDATE) = 'compensated' THEN
      RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Redemption was already compensated; reject the case instead.'); END IF;
    IF EXISTS (SELECT 1 FROM public.reward_case o WHERE o.id <> c.id AND o.status = 'upheld' AND o.reward_event_id IS NOT NULL
        AND ((c.redemption_id IS NOT NULL AND o.redemption_id = c.redemption_id) OR (c.energy_window_id IS NOT NULL AND o.energy_window_id = c.energy_window_id))) THEN
      RETURN jsonb_build_object('ok',false,'code','state_conflict','message','This subject was already credited through another upheld case; reject this case instead.'); END IF;
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
