-- Energy program units stay off-chain. All balances remain in the existing immutable ledger.
ALTER TABLE public.reward_policy ADD COLUMN halving_days integer CHECK (halving_days BETWEEN 30 AND 3650);
ALTER TABLE public.energy_reward_result ADD COLUMN wh_per_point_applied numeric CHECK (wh_per_point_applied > 0);

-- Retain sub-token energy separately for each owner and immutable policy version.
CREATE TABLE public.reward_energy_carry (
  account_id uuid NOT NULL REFERENCES public.account(id),
  policy_id uuid NOT NULL REFERENCES public.reward_policy(id),
  era integer NOT NULL CHECK (era >= 0),
  remainder_wh numeric NOT NULL CHECK (remainder_wh >= 0),
  PRIMARY KEY(account_id,policy_id)
);
ALTER TABLE public.reward_energy_carry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reward_energy_carry FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.reward_era(p public.reward_policy, at_time timestamptz) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT greatest(0, floor(extract(epoch FROM (at_time - date_bin(interval '15 minutes', p.created_at, timestamptz '1970-01-01 00:00Z'))) / (86400::numeric * p.halving_days))::integer)
$$;
REVOKE ALL ON FUNCTION public.reward_era(public.reward_policy,timestamptz) FROM PUBLIC,anon,authenticated;

-- PostgREST callers that omit the optional interval keep their existing policy contract.
DROP FUNCTION public.operator_set_reward_policy(text,numeric,integer,boolean);
CREATE OR REPLACE FUNCTION public.operator_set_reward_policy(p_version text,p_wh_per_point numeric,p_daily_cap integer,p_enabled boolean,p_halving_days integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE gate jsonb; policy public.reward_policy;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  PERFORM 1 FROM public.reward_program WHERE singleton FOR UPDATE;
  PERFORM 1 FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  gate:=public.privileged_write_gate('operator'); IF gate IS NOT NULL THEN RETURN gate; END IF;
  IF p_enabled IS FALSE THEN
    UPDATE public.reward_program SET active_policy_id=NULL WHERE singleton;
    RETURN jsonb_build_object('ok',true,'policy',NULL,'enabled',false);
  END IF;
  IF p_enabled IS DISTINCT FROM true OR p_version IS NULL OR length(btrim(p_version)) NOT BETWEEN 1 AND 120
    OR p_wh_per_point IS NULL OR p_wh_per_point NOT BETWEEN 0.001 AND 1000000
    OR (p_halving_days IS NOT NULL AND p_halving_days NOT BETWEEN 30 AND 3650)
    OR p_daily_cap IS NULL OR p_daily_cap NOT BETWEEN 1 AND 100000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_policy','message','Explicit version, Wh per point and daily cap required.'); END IF;
  SELECT * INTO policy FROM public.reward_policy WHERE version=btrim(p_version);
  IF FOUND THEN
    IF policy.wh_per_point<>p_wh_per_point OR policy.daily_point_cap<>p_daily_cap OR (p_halving_days IS NOT NULL AND policy.halving_days IS DISTINCT FROM p_halving_days) THEN
      RETURN jsonb_build_object('ok',false,'code','policy_conflict','message','Policy versions are immutable; choose a new version.'); END IF;
  ELSE
    INSERT INTO public.reward_policy(version,wh_per_point,daily_point_cap,halving_days) VALUES(btrim(p_version),p_wh_per_point,p_daily_cap,p_halving_days) RETURNING * INTO policy;
  END IF;
  UPDATE public.reward_program SET active_policy_id=policy.id WHERE singleton;
  RETURN jsonb_build_object('ok',true,'enabled',true,'policy',jsonb_build_object('id',policy.id,'version',policy.version,'wh_per_point',policy.wh_per_point,'daily_point_cap',policy.daily_point_cap));
END $$;
REVOKE ALL ON FUNCTION public.operator_set_reward_policy(text,numeric,integer,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_set_reward_policy(text,numeric,integer,boolean,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.credit_energy_reward(p_window_id uuid,p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE w public.energy_window; meter public.energy_meter; dev public.device; prod public.product; own public.ownership;
  policy public.reward_policy; previous public.energy_reward_result; account_row public.account;
  confirmed integer:=0; why text; event_id uuid; used_points bigint; day_start timestamptz; eligible numeric; duration_h numeric; solar numeric; load numeric; held integer; held_case uuid;
  window_era integer; carry public.reward_energy_carry; scale_era integer; rate numeric; scaled_wh numeric; scale_rate numeric;
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
    window_era:=public.reward_era(policy,w.start_at);
    rate:=policy.wh_per_point*power(2::numeric,window_era);
    eligible:=div(least(solar,load),rate);
    day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    SELECT coalesce(sum(points),0) INTO used_points FROM public.reward_event WHERE account_id=p_account_id AND verification_status='verified' AND created_at>=day_start AND created_at<day_start+interval '1 day';
    IF used_points>=policy.daily_point_cap THEN why:='daily_cap';
    ELSIF greatest(solar,load)>=meter.max_power_w*duration_h*0.9 THEN
      -- Keep held evidence out of the spendable remainder.
      held:=least(eligible,policy.daily_point_cap-used_points)::integer;
      why:=CASE WHEN held>0 THEN 'held_for_review' ELSE 'below_threshold' END;
    ELSE
      SELECT * INTO carry FROM public.reward_energy_carry WHERE account_id=p_account_id AND policy_id=policy.id;
      -- Express both operands in the latest era's Wh. Multiplication stays exact even for late packets.
      scale_era:=greatest(window_era,carry.era);
      scale_rate:=policy.wh_per_point*power(2::numeric,scale_era);
      scaled_wh:=least(solar,load)*power(2::numeric,scale_era-window_era)
        +coalesce(carry.remainder_wh*power(2::numeric,scale_era-carry.era),0);
      confirmed:=least(div(scaled_wh,scale_rate),policy.daily_point_cap-used_points)::integer;
      INSERT INTO public.reward_energy_carry VALUES(p_account_id,policy.id,scale_era,mod(scaled_wh,scale_rate))
        ON CONFLICT(account_id,policy_id) DO UPDATE SET era=excluded.era,remainder_wh=excluded.remainder_wh;
      why:=CASE WHEN confirmed>0 THEN 'credited' ELSE 'below_threshold' END;
    END IF;
    IF confirmed>0 THEN
      INSERT INTO public.reward_event(account_id,energy_window_id,source_event_key,policy_version,verification_status,points,evidence_ownership_id)
        VALUES(p_account_id,w.id,'energy:'||w.id::text,policy.version,'verified',confirmed,own.id) RETURNING id INTO event_id;
      INSERT INTO public.ledger_entry(account_id,reward_event_id,signed_points,idempotency_key,note)
        VALUES(p_account_id,event_id,confirmed,'energy:'||w.id::text,'Verified signed energy evidence under policy '||policy.version);
    END IF;
  END IF;
  INSERT INTO public.energy_reward_result(energy_window_id,account_id,policy_id,credited,reason,reward_event_id,wh_per_point_applied)
    VALUES(w.id,p_account_id,policy.id,confirmed,why,event_id,rate);
  IF why='held_for_review' THEN
    INSERT INTO public.reward_case(account_id,kind,energy_window_id,proposed_points) VALUES(p_account_id,'anomaly',w.id,held) RETURNING id INTO held_case;
    INSERT INTO public.reward_case_event(case_id,action,payload) VALUES(held_case,'flagged',jsonb_build_object('solar_wh',solar,'load_wh',load,'bound_wh',meter.max_power_w*duration_h));
  END IF;
  RETURN jsonb_build_object('credited',confirmed,'reason',why,'reward_event_id',event_id,'case_id',held_case);
END $$;

CREATE OR REPLACE FUNCTION public.reward_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE aid uuid; roles text[]; policy jsonb; catalog jsonb; redemptions jsonb; ledger jsonb; queue jsonb:='[]'; balance bigint; reserved bigint;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','account_unavailable','message','Account required.'); END IF;
  roles:=public.my_curation_roles();
  SELECT jsonb_build_object('id',p.id,'version',p.version,'wh_per_point',p.wh_per_point,'daily_point_cap',p.daily_point_cap,
      'halving_days',p.halving_days,'effective_wh_per_point',p.wh_per_point*power(2::numeric,rate.era),
      'next_halving_at',date_bin(interval '15 minutes',p.created_at,timestamptz '1970-01-01 00:00Z')+(rate.era+1)*p.halving_days*interval '24 hours') INTO policy
    FROM public.reward_program c JOIN public.reward_policy p ON p.id=c.active_policy_id CROSS JOIN LATERAL (SELECT public.reward_era(p,statement_timestamp()) AS era) rate WHERE c.singleton;
  SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]') INTO catalog FROM (SELECT id,title,point_cost,stock_total,stock_reserved,availability FROM public.catalog_item ORDER BY title,id LIMIT 100) rows;
  SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]') INTO redemptions FROM (SELECT r.id,r.catalog_item_id,c.title,r.reserved_points,r.status,r.created_at,r.fulfillment_reference,r.compensation_reason
    FROM public.redemption r JOIN public.catalog_item c ON c.id=r.catalog_item_id WHERE r.account_id=aid ORDER BY r.created_at DESC,r.id DESC LIMIT 100) rows;
  SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]') INTO ledger FROM (SELECT id,signed_points,note,created_at,reversal_of,redemption_id,reward_event_id FROM public.ledger_entry WHERE account_id=aid ORDER BY created_at DESC,id DESC LIMIT 100) rows;
  IF 'operator'=ANY(roles) THEN
    SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]') INTO queue FROM (SELECT r.id,r.account_id,r.catalog_item_id,c.title,r.reserved_points,r.status,r.created_at,r.fulfillment_reference,r.compensation_reason
      FROM public.redemption r JOIN public.catalog_item c ON c.id=r.catalog_item_id ORDER BY r.created_at DESC,r.id DESC LIMIT 100) rows;
  END IF;
  SELECT coalesce(sum(signed_points),0) INTO balance FROM public.ledger_entry WHERE account_id=aid;
  SELECT coalesce(sum(reserved_points),0) INTO reserved FROM public.redemption WHERE account_id=aid AND status='reserved';
  RETURN jsonb_build_object('ok',true,'roles',roles,'policy',policy,'balance',jsonb_build_object('confirmed_points',balance,'reserved_points',reserved,'available_points',balance-reserved),
    'catalog',catalog,'redemptions',redemptions,'ledger',ledger,'fulfillment_queue',queue);
END $$;

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
    -- A review can release a measured, held award or return an actual debit, never create discretionary units.
    IF c.energy_window_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.energy_reward_result r JOIN public.reward_case h ON h.energy_window_id=r.energy_window_id AND h.kind='anomaly'
          JOIN public.reward_policy p ON p.id=r.policy_id
        WHERE r.energy_window_id=c.energy_window_id AND r.account_id=c.account_id AND r.reason='held_for_review'
          AND coalesce(p_points,c.proposed_points)<=h.proposed_points
          AND coalesce(p_points,c.proposed_points) + (SELECT coalesce(sum(e.points),0) FROM public.reward_event e
            WHERE e.account_id=c.account_id AND e.verification_status='verified' AND e.created_at >=
              (date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) <= p.daily_point_cap
      ) THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Insufficient eligible held energy or daily allowance.'); END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.ledger_entry d WHERE d.account_id=c.account_id AND d.redemption_id=c.redemption_id
      AND d.signed_points<0 AND coalesce(p_points,c.proposed_points)<=-d.signed_points) THEN
      RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Refund exceeds original debit.');
    END IF;
    INSERT INTO public.reward_event(account_id, energy_window_id, source_event_key, policy_version, verification_status, points)
      VALUES (c.account_id, c.energy_window_id, 'case:' || c.id::text, 'case-review', 'verified', coalesce(p_points, c.proposed_points)) RETURNING id INTO event_id;
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
