-- RW-04 (U04, A06): suspicious energy claims wait for review instead of being credited, and owners can appeal an
-- energy result or a redemption. An operator takes a case, then decides it with a reason. An upheld case credits
-- through its own reward event, so every ledger credit still has exactly one source (phase4_ledger_source).

ALTER TABLE public.energy_reward_result DROP CONSTRAINT energy_reward_result_reason_check;
ALTER TABLE public.energy_reward_result ADD CONSTRAINT energy_reward_result_reason_check
  CHECK (reason IN ('credited','policy_disabled','below_threshold','daily_cap','held_for_review'));

CREATE TABLE public.reward_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('anomaly','appeal')),
  energy_window_id uuid REFERENCES public.energy_window(id) ON DELETE RESTRICT,
  redemption_id uuid REFERENCES public.redemption(id) ON DELETE RESTRICT,
  request_id uuid,
  statement text CHECK (statement IS NULL OR length(btrim(statement)) BETWEEN 1 AND 2000),
  proposed_points integer CHECK (proposed_points IS NULL OR proposed_points BETWEEN 1 AND 100000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','upheld','rejected')),
  assignee_account_id uuid REFERENCES public.account(id) ON DELETE RESTRICT,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 1000),
  credited_points integer CHECK (credited_points IS NULL OR credited_points BETWEEN 1 AND 100000),
  reward_event_id uuid UNIQUE REFERENCES public.reward_event(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  CHECK ((energy_window_id IS NULL) <> (redemption_id IS NULL)),
  CHECK ((kind = 'appeal') = (request_id IS NOT NULL AND statement IS NOT NULL)),
  CHECK ((status IN ('upheld','rejected')) = (decided_at IS NOT NULL AND decision_reason IS NOT NULL)),
  CHECK ((status = 'open') = (assignee_account_id IS NULL)),
  CHECK ((reward_event_id IS NULL) = (credited_points IS NULL)),
  CHECK (reward_event_id IS NULL OR status = 'upheld')
);
CREATE UNIQUE INDEX reward_case_appeal_request ON public.reward_case(account_id, request_id) WHERE request_id IS NOT NULL;
-- One undecided case per subject: a second appeal waits for the first decision.
CREATE UNIQUE INDEX reward_case_open_window ON public.reward_case(energy_window_id) WHERE energy_window_id IS NOT NULL AND status IN ('open','in_review');
CREATE UNIQUE INDEX reward_case_open_redemption ON public.reward_case(redemption_id) WHERE redemption_id IS NOT NULL AND status IN ('open','in_review');
CREATE INDEX reward_case_queue ON public.reward_case(status, created_at, id);
CREATE INDEX reward_case_account ON public.reward_case(account_id, created_at DESC);

-- Append-only trail: who did what to a case and why. A null actor is the system (anomaly flag).
CREATE TABLE public.reward_case_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.reward_case(id) ON DELETE RESTRICT,
  actor_account_id uuid REFERENCES public.account(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('flagged','opened','assigned','upheld','rejected')),
  request_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX reward_case_event_request ON public.reward_case_event(actor_account_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX reward_case_event_case ON public.reward_case_event(case_id, id);

CREATE FUNCTION public.reward_case_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'reward_case_event is append-only'; END $$;
CREATE TRIGGER reward_case_event_immutable BEFORE UPDATE OR DELETE ON public.reward_case_event
  FOR EACH ROW EXECUTE FUNCTION public.reward_case_event_immutable();

ALTER TABLE public.reward_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_case_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reward_case, public.reward_case_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reward_case, public.reward_case_event TO service_role;

-- Codex's credit_energy_reward (20261106010000) with the review hold added; otherwise unchanged.
CREATE OR REPLACE FUNCTION public.credit_energy_reward(p_window_id uuid,p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE w public.energy_window; meter public.energy_meter; dev public.device; prod public.product; own public.ownership;
  policy public.reward_policy; previous public.energy_reward_result; account_row public.account;
  confirmed integer:=0; why text; event_id uuid; used_points bigint; day_start timestamptz; eligible numeric; duration_h numeric; solar numeric; load numeric; held integer; held_case uuid;
BEGIN
  SELECT * INTO w FROM public.energy_window WHERE id=p_window_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('credited',0,'reason','untrusted_window'); END IF;
  SELECT p.* INTO prod FROM public.product p JOIN public.device d ON d.product_id=p.id WHERE d.id=w.device_id FOR UPDATE OF p;
  SELECT * INTO dev FROM public.device WHERE id=w.device_id FOR UPDATE;
  SELECT * INTO meter FROM public.energy_meter WHERE id=w.meter_id FOR UPDATE;
  SELECT * INTO own FROM public.ownership WHERE id=w.ownership_id;
  duration_h:=extract(epoch FROM (w.end_at-w.start_at))/3600;
  solar:=w.solar_end_wh-w.solar_start_wh; load:=w.load_end_wh-w.load_start_wh;
  IF prod.id IS NULL OR dev.id IS NULL OR meter.id IS NULL OR own.id IS NULL OR own.account_id IS DISTINCT FROM p_account_id
    OR own.product_id IS DISTINCT FROM prod.id OR own.end_at IS NOT NULL OR w.start_at<own.start_at
    OR w.end_at-w.start_at<>interval '15 minutes' OR mod(extract(epoch FROM w.start_at),900)<>0
    OR w.end_at>clock_timestamp() OR w.start_at<clock_timestamp()-interval '7 days' OR w.received_at IS NULL
    OR prod.registry_status<>'active' OR dev.status<>'active' OR meter.status<>'active' OR meter.device_id IS DISTINCT FROM dev.id
    OR meter.valid_from>w.start_at OR meter.valid_until<w.end_at OR w.evidence_quality<>'verified_meter'
    OR w.payload IS NULL OR w.signature IS NULL OR w.payload_sha256 IS DISTINCT FROM encode(digest(w.payload,'sha256'),'hex')
    OR w.solar_start_wh IS NULL OR w.solar_end_wh IS NULL OR w.load_start_wh IS NULL OR w.load_end_wh IS NULL
    OR w.solar_start_wh NOT BETWEEN 0 AND 1000000000 OR w.solar_end_wh NOT BETWEEN 0 AND 1000000000
    OR w.load_start_wh NOT BETWEEN 0 AND 1000000000 OR w.load_end_wh NOT BETWEEN 0 AND 1000000000
    OR solar NOT BETWEEN 0 AND meter.max_power_w*duration_h OR load NOT BETWEEN 0 AND meter.max_power_w*duration_h THEN
    RETURN jsonb_build_object('credited',0,'reason','untrusted_window'); END IF;
  -- Same lock order as ingestion: product, device, meter, policy configuration, account.
  SELECT p.* INTO policy FROM public.reward_program c LEFT JOIN public.reward_policy p ON p.id=c.active_policy_id WHERE c.singleton FOR SHARE OF c;
  SELECT * INTO account_row FROM public.account WHERE id=p_account_id FOR UPDATE;
  IF account_row.id IS NULL THEN RETURN jsonb_build_object('credited',0,'reason','untrusted_window'); END IF;
  SELECT * INTO previous FROM public.energy_reward_result WHERE energy_window_id=w.id;
  IF FOUND THEN RETURN jsonb_build_object('credited',previous.credited,'reason','already_credited','reward_event_id',previous.reward_event_id); END IF;
  IF policy.id IS NULL THEN why:='policy_disabled';
  ELSE
    eligible:=floor(least(solar,load)/policy.wh_per_point);
    day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT coalesce(sum(points),0) INTO used_points FROM public.reward_event WHERE account_id=p_account_id AND verification_status='verified' AND created_at>=day_start AND created_at<day_start+interval '1 day';
    IF eligible<1 THEN why:='below_threshold';
    ELSIF used_points>=policy.daily_point_cap THEN why:='daily_cap';
    -- RW-04: energy within 10% of the meter's registered bound waits for an operator instead of crediting.
    -- ponytail: one fixed ratio; replace with per-meter baselines once real field data exists.
    ELSIF greatest(solar,load)>=meter.max_power_w*duration_h*0.9 THEN
      held:=least(eligible,policy.daily_point_cap-used_points)::integer; why:='held_for_review';
    ELSE confirmed:=least(eligible,policy.daily_point_cap-used_points)::integer; why:='credited';
      INSERT INTO public.reward_event(account_id,energy_window_id,source_event_key,policy_version,verification_status,points,evidence_ownership_id)
        VALUES(p_account_id,w.id,'energy:'||w.id::text,policy.version,'verified',confirmed,own.id) RETURNING id INTO event_id;
      INSERT INTO public.ledger_entry(account_id,reward_event_id,signed_points,idempotency_key,note)
        VALUES(p_account_id,event_id,confirmed,'energy:'||w.id::text,'Verified signed energy evidence under policy '||policy.version);
    END IF;
  END IF;
  INSERT INTO public.energy_reward_result(energy_window_id,account_id,policy_id,credited,reason,reward_event_id)
    VALUES(w.id,p_account_id,policy.id,confirmed,why,event_id);
  IF why='held_for_review' THEN
    INSERT INTO public.reward_case(account_id,kind,energy_window_id,proposed_points) VALUES(p_account_id,'anomaly',w.id,held) RETURNING id INTO held_case;
    INSERT INTO public.reward_case_event(case_id,action,payload) VALUES(held_case,'flagged',jsonb_build_object('solar_wh',solar,'load_wh',load,'bound_wh',meter.max_power_w*duration_h));
  END IF;
  RETURN jsonb_build_object('credited',confirmed,'reason',why,'reward_event_id',event_id,'case_id',held_case);
END $$;

-- Owner: appeal one energy result or one redemption. A retry with the same request id returns the first case.
CREATE FUNCTION public.open_reward_appeal(p_request_id uuid, p_energy_window_id uuid, p_redemption_id uuid, p_statement text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; clean text := btrim(p_statement); prior public.reward_case; cid uuid; open_count integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR (p_energy_window_id IS NULL) = (p_redemption_id IS NULL) OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 2000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','One subject, a request id and a statement are required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO prior FROM public.reward_case WHERE account_id = aid AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.energy_window_id IS DISTINCT FROM p_energy_window_id OR prior.redemption_id IS DISTINCT FROM p_redemption_id OR prior.statement <> clean THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'case_id',prior.id,'status',prior.status,'idempotent',true);
  END IF;
  -- The subject must be the caller's, recent, and not already settled by its own process.
  IF p_energy_window_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.energy_reward_result
      WHERE energy_window_id = p_energy_window_id AND account_id = aid AND processed_at > clock_timestamp() - interval '30 days') THEN
    RETURN jsonb_build_object('ok',false,'code','subject_unavailable','message','Own energy result from the last 30 days required.'); END IF;
  IF p_redemption_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.redemption
      WHERE id = p_redemption_id AND account_id = aid AND status <> 'compensated' AND created_at > clock_timestamp() - interval '90 days') THEN
    RETURN jsonb_build_object('ok',false,'code','subject_unavailable','message','Own uncompensated redemption from the last 90 days required.'); END IF;
  IF EXISTS (SELECT 1 FROM public.reward_case WHERE status IN ('open','in_review')
      AND (energy_window_id = p_energy_window_id OR redemption_id = p_redemption_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','case_open','message','This subject already has an undecided case.'); END IF;
  SELECT count(*) INTO open_count FROM public.reward_case WHERE account_id = aid AND kind = 'appeal' AND status IN ('open','in_review');
  IF open_count >= 5 THEN RETURN jsonb_build_object('ok',false,'code','rate_limited','message','At most five undecided appeals.'); END IF;
  INSERT INTO public.reward_case(account_id, kind, energy_window_id, redemption_id, request_id, statement)
    VALUES (aid, 'appeal', p_energy_window_id, p_redemption_id, p_request_id, clean) RETURNING id INTO cid;
  INSERT INTO public.reward_case_event(case_id, actor_account_id, action, request_id) VALUES (cid, aid, 'opened', p_request_id);
  RETURN jsonb_build_object('ok',true,'case_id',cid,'status','open','idempotent',false);
END $$;

-- Owner: own cases, newest first. Operator identities stay hidden; the owner sees the decision and its reason.
CREATE FUNCTION public.my_reward_cases() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'energy_window_id',c.energy_window_id,'redemption_id',c.redemption_id,
      'statement',c.statement,'status',c.status,'decision_reason',c.decision_reason,'credited_points',c.credited_points,
      'created_at',c.created_at,'decided_at',c.decided_at) ORDER BY c.created_at DESC, c.id), '[]'::jsonb)
    INTO rows FROM (SELECT * FROM public.reward_case WHERE account_id = aid ORDER BY created_at DESC, id LIMIT 50) c;
  RETURN jsonb_build_object('ok',true,'cases',rows);
END $$;

-- Operator: the queue with the evidence needed to decide (energy against the meter bound, or the redemption).
CREATE FUNCTION public.operator_reward_cases(p_status text DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE rows jsonb; last jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT public.privileged_role_active('operator') THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Verified operator session required.'); END IF;
  IF (p_status IS NOT NULL AND p_status NOT IN ('open','in_review','upheld','rejected')) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Valid status and page bounds required.'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'created_at')::timestamptz, x->>'id'), '[]'::jsonb) INTO rows FROM (
    SELECT jsonb_build_object('id',c.id,'kind',c.kind,'account_id',c.account_id,'status',c.status,'statement',c.statement,
      'proposed_points',c.proposed_points,'assignee_account_id',c.assignee_account_id,'decision_reason',c.decision_reason,
      'credited_points',c.credited_points,'created_at',c.created_at,'decided_at',c.decided_at,
      'energy', CASE WHEN w.id IS NULL THEN NULL ELSE jsonb_build_object('window_id',w.id,'device_id',w.device_id,'start_at',w.start_at,
        'end_at',w.end_at,'solar_wh',w.solar_end_wh - w.solar_start_wh,'load_wh',w.load_end_wh - w.load_start_wh,
        'bound_wh',m.max_power_w * extract(epoch FROM (w.end_at - w.start_at)) / 3600,'result',r.reason,'credited',r.credited) END,
      'redemption', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('redemption_id',d.id,'item',ci.title,'points',d.reserved_points,
        'status',d.status,'created_at',d.created_at,'fulfillment_reference',d.fulfillment_reference) END) AS x
    FROM public.reward_case c
    LEFT JOIN public.energy_window w ON w.id = c.energy_window_id
    LEFT JOIN public.energy_meter m ON m.id = w.meter_id
    LEFT JOIN public.energy_reward_result r ON r.energy_window_id = w.id
    LEFT JOIN public.redemption d ON d.id = c.redemption_id
    LEFT JOIN public.catalog_item ci ON ci.id = d.catalog_item_id
    WHERE (p_status IS NULL OR c.status = p_status) AND (p_before IS NULL OR (c.created_at, c.id) > (p_before, p_before_id))
    ORDER BY c.created_at, c.id LIMIT p_limit) q;
  last := rows -> (jsonb_array_length(rows) - 1);
  RETURN jsonb_build_object('ok',true,'cases',rows,'next_cursor',
    CASE WHEN jsonb_array_length(rows) = p_limit THEN jsonb_build_object('created_at',last->'created_at','id',last->'id') END);
END $$;

-- Operator: take an open case. Retrying the same request returns the first answer; another operator's case is refused.
CREATE FUNCTION public.operator_take_reward_case(p_case_id uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE refusal jsonb; actor uuid; c public.reward_case; prior public.reward_case_event;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  refusal := public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF p_case_id IS NULL OR p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Case and request id required.'); END IF;
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid();
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.reward-case.v1:' || actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO prior FROM public.reward_case_event WHERE actor_account_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.case_id <> p_case_id OR prior.action <> 'assigned' THEN RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'status','in_review','idempotent',true);
  END IF;
  SELECT * INTO c FROM public.reward_case WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','case_unavailable','message','Case unavailable.'); END IF;
  IF c.account_id = actor THEN RETURN jsonb_build_object('ok',false,'code','self_review','message','Operators cannot review their own cases.'); END IF;
  IF c.status <> 'open' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only an open case can be taken.'); END IF;
  UPDATE public.reward_case SET status = 'in_review', assignee_account_id = actor WHERE id = c.id;
  INSERT INTO public.reward_case_event(case_id, actor_account_id, action, request_id) VALUES (c.id, actor, 'assigned', p_request_id);
  RETURN jsonb_build_object('ok',true,'case_id',c.id,'status','in_review','idempotent',false);
END $$;

-- Operator: decide a case they hold. Upheld cases may credit points through a reward event of their own.
CREATE FUNCTION public.operator_decide_reward_case(p_case_id uuid, p_request_id uuid, p_decision text, p_points integer, p_reason text) RETURNS jsonb
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

REVOKE ALL ON FUNCTION public.open_reward_appeal(uuid,uuid,uuid,text), public.my_reward_cases(),
  public.operator_reward_cases(text,timestamptz,uuid,integer), public.operator_take_reward_case(uuid,uuid),
  public.operator_decide_reward_case(uuid,uuid,text,integer,text), public.reward_case_event_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_reward_appeal(uuid,uuid,uuid,text), public.my_reward_cases(),
  public.operator_reward_cases(text,timestamptz,uuid,integer), public.operator_take_reward_case(uuid,uuid),
  public.operator_decide_reward_case(uuid,uuid,text,integer,text) TO authenticated;
