-- Phase 4: explicit program policy and transactional catalogue; no active rewards or inventory seed.
CREATE TABLE public.reward_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (length(btrim(version)) BETWEEN 1 AND 120),
  wh_per_point numeric NOT NULL CHECK (wh_per_point BETWEEN 0.001 AND 1000000),
  daily_point_cap integer NOT NULL CHECK (daily_point_cap BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.reward_program (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_policy_id uuid REFERENCES public.reward_policy(id) ON DELETE RESTRICT
);
INSERT INTO public.reward_program(singleton,active_policy_id) VALUES(true,NULL);
ALTER TABLE public.reward_event ADD COLUMN points integer CHECK (points BETWEEN 1 AND 100000);
ALTER TABLE public.reward_event ADD COLUMN evidence_ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX reward_event_one_window ON public.reward_event(energy_window_id) WHERE energy_window_id IS NOT NULL AND verification_status='verified';
ALTER TABLE public.ledger_entry ADD COLUMN reversal_of uuid UNIQUE REFERENCES public.ledger_entry(id) ON DELETE RESTRICT;
ALTER TABLE public.ledger_entry ADD CONSTRAINT phase4_ledger_source CHECK (
  (reward_event_id IS NOT NULL AND redemption_id IS NULL AND reversal_of IS NULL AND signed_points>0)
  OR (reward_event_id IS NULL AND redemption_id IS NOT NULL AND ((reversal_of IS NULL AND signed_points<0) OR (reversal_of IS NOT NULL AND signed_points>0)))
) NOT VALID;
CREATE UNIQUE INDEX ledger_one_redemption_debit ON public.ledger_entry(redemption_id) WHERE redemption_id IS NOT NULL AND reversal_of IS NULL;
ALTER TABLE public.redemption ADD COLUMN fulfillment_reference text CHECK (length(btrim(fulfillment_reference)) BETWEEN 1 AND 240);
ALTER TABLE public.redemption ADD COLUMN compensation_reason text CHECK (length(btrim(compensation_reason)) BETWEEN 1 AND 1000);
ALTER TABLE public.reward_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_program ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reward_policy,public.reward_program,public.reward_event,public.ledger_entry,public.catalog_item,public.redemption FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.reward_policy,public.reward_program TO service_role;
GRANT SELECT ON public.reward_event,public.ledger_entry,public.catalog_item,public.redemption TO authenticated;
CREATE POLICY phase4_reward_read ON public.reward_event FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND account_id IN (SELECT id FROM public.account WHERE auth_user_id=auth.uid())
);
CREATE POLICY phase4_ledger_read ON public.ledger_entry FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND account_id IN (SELECT id FROM public.account WHERE auth_user_id=auth.uid())
);
CREATE POLICY phase4_redemption_read ON public.redemption FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND account_id IN (SELECT id FROM public.account WHERE auth_user_id=auth.uid())
);
-- Disabled inventory remains visible for transparent availability; mutations require operator RPC.
CREATE POLICY phase4_catalog_read ON public.catalog_item FOR SELECT TO authenticated USING ((SELECT public.current_auth_session()));
CREATE TRIGGER reward_policy_immutable BEFORE UPDATE OR DELETE ON public.reward_policy FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
CREATE TRIGGER reward_event_immutable BEFORE UPDATE OR DELETE ON public.reward_event FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE OR DELETE ON public.ledger_entry FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();

-- A first processing result also pins zero-credit outcomes; enabling a later policy cannot retroactively credit them.
CREATE TABLE public.energy_reward_result (
  energy_window_id uuid PRIMARY KEY REFERENCES public.energy_window(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  policy_id uuid REFERENCES public.reward_policy(id) ON DELETE RESTRICT,
  credited integer NOT NULL CHECK (credited BETWEEN 0 AND 100000),
  reason text NOT NULL CHECK (reason IN ('credited','policy_disabled','below_threshold','daily_cap')),
  reward_event_id uuid UNIQUE REFERENCES public.reward_event(id) ON DELETE RESTRICT,
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((credited>0)=(reward_event_id IS NOT NULL))
);
ALTER TABLE public.energy_reward_result ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.energy_reward_result FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.energy_reward_result TO service_role;
CREATE TRIGGER energy_reward_result_immutable BEFORE UPDATE OR DELETE ON public.energy_reward_result FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();

CREATE FUNCTION public.credit_energy_reward(p_window_id uuid,p_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE w public.energy_window; meter public.energy_meter; dev public.device; prod public.product; own public.ownership;
  policy public.reward_policy; previous public.energy_reward_result; account_row public.account;
  confirmed integer:=0; why text; event_id uuid; used_points bigint; day_start timestamptz; eligible numeric; duration_h numeric; solar numeric; load numeric;
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
    ELSE confirmed:=least(eligible,policy.daily_point_cap-used_points)::integer; why:='credited';
      INSERT INTO public.reward_event(account_id,energy_window_id,source_event_key,policy_version,verification_status,points,evidence_ownership_id)
        VALUES(p_account_id,w.id,'energy:'||w.id::text,policy.version,'verified',confirmed,own.id) RETURNING id INTO event_id;
      INSERT INTO public.ledger_entry(account_id,reward_event_id,signed_points,idempotency_key,note)
        VALUES(p_account_id,event_id,confirmed,'energy:'||w.id::text,'Verified signed energy evidence under policy '||policy.version);
    END IF;
  END IF;
  INSERT INTO public.energy_reward_result(energy_window_id,account_id,policy_id,credited,reason,reward_event_id)
    VALUES(w.id,p_account_id,policy.id,confirmed,why,event_id);
  RETURN jsonb_build_object('credited',confirmed,'reason',why,'reward_event_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.credit_energy_reward(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.credit_energy_reward(uuid,uuid) TO service_role;

CREATE FUNCTION public.operator_set_reward_policy(p_version text,p_wh_per_point numeric,p_daily_cap integer,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE policy public.reward_policy;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT ('operator'=ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  PERFORM 1 FROM public.reward_program WHERE singleton FOR UPDATE;
  IF p_enabled IS FALSE THEN
    UPDATE public.reward_program SET active_policy_id=NULL WHERE singleton;
    RETURN jsonb_build_object('ok',true,'policy',NULL,'enabled',false);
  END IF;
  IF p_enabled IS DISTINCT FROM true OR p_version IS NULL OR length(btrim(p_version)) NOT BETWEEN 1 AND 120
    OR p_wh_per_point IS NULL OR p_wh_per_point NOT BETWEEN 0.001 AND 1000000
    OR p_daily_cap IS NULL OR p_daily_cap NOT BETWEEN 1 AND 100000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_policy','message','Explicit version, Wh per point and daily cap required.'); END IF;
  SELECT * INTO policy FROM public.reward_policy WHERE version=btrim(p_version);
  IF FOUND THEN
    IF policy.wh_per_point<>p_wh_per_point OR policy.daily_point_cap<>p_daily_cap THEN
      RETURN jsonb_build_object('ok',false,'code','policy_conflict','message','Policy versions are immutable; choose a new version.'); END IF;
  ELSE
    INSERT INTO public.reward_policy(version,wh_per_point,daily_point_cap) VALUES(btrim(p_version),p_wh_per_point,p_daily_cap) RETURNING * INTO policy;
  END IF;
  UPDATE public.reward_program SET active_policy_id=policy.id WHERE singleton;
  RETURN jsonb_build_object('ok',true,'enabled',true,'policy',jsonb_build_object('id',policy.id,'version',policy.version,'wh_per_point',policy.wh_per_point,'daily_point_cap',policy.daily_point_cap));
END $$;

CREATE FUNCTION public.operator_upsert_catalog(p_id uuid,p_title text,p_point_cost integer,p_stock_total integer,p_availability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE item public.catalog_item; iid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT ('operator'=ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR p_point_cost IS NULL OR p_point_cost NOT BETWEEN 1 AND 100000
    OR p_stock_total IS NULL OR p_stock_total NOT BETWEEN 0 AND 1000000 OR p_availability IS NULL OR p_availability NOT IN ('available','out_of_stock','disabled') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_item','message','Valid title, cost, stock and availability required.'); END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.catalog_item(title,point_cost,stock_total,availability) VALUES(btrim(p_title),p_point_cost,p_stock_total,p_availability) RETURNING id INTO iid;
  ELSE
    SELECT * INTO item FROM public.catalog_item WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','item_unavailable','message','Catalogue item unavailable.'); END IF;
    IF p_stock_total<item.stock_reserved THEN RETURN jsonb_build_object('ok',false,'code','stock_reserved','message','Stock cannot fall below existing reservations.'); END IF;
    UPDATE public.catalog_item SET title=btrim(p_title),point_cost=p_point_cost,stock_total=p_stock_total,availability=p_availability WHERE id=p_id;
    iid:=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'item_id',iid);
END $$;

CREATE FUNCTION public.reserve_my_reward(p_item_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE a public.account; item public.catalog_item; old public.redemption; rid uuid; balance bigint; reserved bigint; key text;
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
  SELECT * INTO item FROM public.catalog_item WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND OR item.availability<>'available' OR item.stock_total-item.stock_reserved<1 THEN
    RETURN jsonb_build_object('ok',false,'code','item_unavailable','message','Catalogue stock unavailable.'); END IF;
  SELECT coalesce(sum(signed_points),0) INTO balance FROM public.ledger_entry WHERE account_id=a.id;
  SELECT coalesce(sum(reserved_points),0) INTO reserved FROM public.redemption WHERE account_id=a.id AND status='reserved';
  IF balance-reserved<item.point_cost THEN RETURN jsonb_build_object('ok',false,'code','insufficient_points','message','Available confirmed points insufficient.'); END IF;
  INSERT INTO public.redemption(account_id,catalog_item_id,reserved_points,idempotency_key) VALUES(a.id,item.id,item.point_cost,key) RETURNING id INTO rid;
  UPDATE public.catalog_item SET stock_reserved=stock_reserved+1 WHERE id=item.id;
  RETURN jsonb_build_object('ok',true,'redemption_id',rid,'status','reserved','reserved_points',item.point_cost);
END $$;

CREATE FUNCTION public.cancel_my_redemption(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE a public.account; r public.redemption;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT * INTO a FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id AND account_id=a.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','redemption_unavailable','message','Own reservation required.'); END IF;
  PERFORM 1 FROM public.catalog_item WHERE id=r.catalog_item_id FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id FOR UPDATE;
  IF r.status='cancelled' THEN RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status',r.status); END IF;
  IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only pending reservations may be cancelled.'); END IF;
  UPDATE public.redemption SET status='cancelled' WHERE id=r.id;
  UPDATE public.catalog_item SET stock_reserved=stock_reserved-1 WHERE id=r.catalog_item_id;
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','cancelled');
END $$;

CREATE FUNCTION public.operator_fulfill_redemption(p_id uuid,p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE r public.redemption;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT ('operator'=ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 240 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reference','message','Actual fulfillment reference required.'); END IF;
  SELECT * INTO r FROM public.redemption WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','redemption_unavailable','message','Reservation unavailable.'); END IF;
  PERFORM 1 FROM public.account WHERE id=r.account_id FOR UPDATE;
  PERFORM 1 FROM public.catalog_item WHERE id=r.catalog_item_id FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id FOR UPDATE;
  IF r.status IN ('fulfilled','compensated') THEN RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status',r.status,'fulfillment_reference',r.fulfillment_reference); END IF;
  IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Reservation is not pending.'); END IF;
  UPDATE public.redemption SET status='fulfilled',fulfillment_reference=btrim(p_reference) WHERE id=r.id;
  UPDATE public.catalog_item SET stock_total=stock_total-1,stock_reserved=stock_reserved-1 WHERE id=r.catalog_item_id;
  INSERT INTO public.ledger_entry(account_id,redemption_id,signed_points,idempotency_key,note)
    VALUES(r.account_id,r.id,-r.reserved_points,'fulfill:'||r.id::text,'Catalogue fulfillment: '||btrim(p_reference));
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','fulfilled','fulfillment_reference',btrim(p_reference));
END $$;

CREATE FUNCTION public.operator_compensate_redemption(p_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE r public.redemption; debit public.ledger_entry;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT ('operator'=ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reason','message','Compensation reason required.'); END IF;
  SELECT * INTO r FROM public.redemption WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','redemption_unavailable','message','Redemption unavailable.'); END IF;
  PERFORM 1 FROM public.account WHERE id=r.account_id FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id FOR UPDATE;
  IF r.status='compensated' THEN RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status',r.status); END IF;
  IF r.status<>'fulfilled' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only fulfilled redemption may be compensated.'); END IF;
  SELECT * INTO debit FROM public.ledger_entry WHERE redemption_id=r.id AND signed_points<0 AND reversal_of IS NULL;
  IF debit.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ledger_unavailable','message','Original debit required.'); END IF;
  INSERT INTO public.ledger_entry(account_id,redemption_id,signed_points,reversal_of,idempotency_key,note)
    VALUES(r.account_id,r.id,-debit.signed_points,debit.id,'compensate:'||r.id::text,btrim(p_reason));
  UPDATE public.redemption SET status='compensated',compensation_reason=btrim(p_reason) WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','compensated');
END $$;

CREATE FUNCTION public.reward_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE aid uuid; roles text[]; policy jsonb; catalog jsonb; redemptions jsonb; ledger jsonb; queue jsonb:='[]'; balance bigint; reserved bigint;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id,access_roles INTO aid,roles FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','account_unavailable','message','Account required.'); END IF;
  SELECT jsonb_build_object('id',p.id,'version',p.version,'wh_per_point',p.wh_per_point,'daily_point_cap',p.daily_point_cap) INTO policy
    FROM public.reward_program c JOIN public.reward_policy p ON p.id=c.active_policy_id WHERE c.singleton;
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

REVOKE ALL ON FUNCTION public.operator_set_reward_policy(text,numeric,integer,boolean),public.operator_upsert_catalog(uuid,text,integer,integer,text),public.reserve_my_reward(uuid,uuid),public.cancel_my_redemption(uuid),public.operator_fulfill_redemption(uuid,text),public.operator_compensate_redemption(uuid,text),public.reward_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operator_set_reward_policy(text,numeric,integer,boolean),public.operator_upsert_catalog(uuid,text,integer,integer,text),public.reserve_my_reward(uuid,uuid),public.cancel_my_redemption(uuid),public.operator_fulfill_redemption(uuid,text),public.operator_compensate_redemption(uuid,text),public.reward_workspace() TO authenticated;
