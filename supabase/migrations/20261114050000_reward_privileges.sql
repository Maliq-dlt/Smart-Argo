-- Require fresh operator MFA after resource locks and before mutations or successful retries.
CREATE OR REPLACE FUNCTION public.operator_set_reward_policy(p_version text,p_wh_per_point numeric,p_daily_cap integer,p_enabled boolean) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION public.operator_upsert_catalog(p_id uuid,p_title text,p_point_cost integer,p_stock_total integer,p_availability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE gate jsonb; item public.catalog_item; iid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR p_point_cost IS NULL OR p_point_cost NOT BETWEEN 1 AND 100000
    OR p_stock_total IS NULL OR p_stock_total NOT BETWEEN 0 AND 1000000 OR p_availability IS NULL OR p_availability NOT IN ('available','out_of_stock','disabled') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_item','message','Valid title, cost, stock and availability required.'); END IF;
  PERFORM 1 FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  IF p_id IS NULL THEN
    gate:=public.privileged_write_gate('operator'); IF gate IS NOT NULL THEN RETURN gate; END IF;
    INSERT INTO public.catalog_item(title,point_cost,stock_total,availability) VALUES(btrim(p_title),p_point_cost,p_stock_total,p_availability) RETURNING id INTO iid;
  ELSE
    SELECT * INTO item FROM public.catalog_item WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','item_unavailable','message','Catalogue item unavailable.'); END IF;
    IF p_stock_total<item.stock_reserved THEN RETURN jsonb_build_object('ok',false,'code','stock_reserved','message','Stock cannot fall below existing reservations.'); END IF;
    gate:=public.privileged_write_gate('operator'); IF gate IS NOT NULL THEN RETURN gate; END IF;
    UPDATE public.catalog_item SET title=btrim(p_title),point_cost=p_point_cost,stock_total=p_stock_total,availability=p_availability WHERE id=p_id;
    iid:=p_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'item_id',iid);
END $$;

CREATE OR REPLACE FUNCTION public.operator_fulfill_redemption(p_id uuid,p_reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE gate jsonb; r public.redemption;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account WHERE auth_user_id=auth.uid() AND 'operator'=ANY(access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Program operator required.'); END IF;
  IF p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 1 AND 240 THEN RETURN jsonb_build_object('ok',false,'code','invalid_reference','message','Actual fulfillment reference required.'); END IF;
  SELECT * INTO r FROM public.redemption WHERE id=p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','redemption_unavailable','message','Reservation unavailable.'); END IF;
  PERFORM 1 FROM public.account WHERE id=r.account_id OR auth_user_id=auth.uid() ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.catalog_item WHERE id=r.catalog_item_id FOR UPDATE;
  SELECT * INTO r FROM public.redemption WHERE id=p_id FOR UPDATE;
  gate:=public.privileged_write_gate('operator'); IF gate IS NOT NULL THEN RETURN gate; END IF;

  IF r.status IN ('fulfilled','compensated') THEN RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status',r.status,'fulfillment_reference',r.fulfillment_reference); END IF;
  IF r.status<>'reserved' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Reservation is not pending.'); END IF;
  UPDATE public.redemption SET status='fulfilled',fulfillment_reference=btrim(p_reference) WHERE id=r.id;
  UPDATE public.catalog_item SET stock_total=stock_total-1,stock_reserved=stock_reserved-1 WHERE id=r.catalog_item_id;
  INSERT INTO public.ledger_entry(account_id,redemption_id,signed_points,idempotency_key,note)
    VALUES(r.account_id,r.id,-r.reserved_points,'fulfill:'||r.id::text,'Catalogue fulfillment: '||btrim(p_reference));
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','fulfilled','fulfillment_reference',btrim(p_reference));
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
  SELECT * INTO debit FROM public.ledger_entry WHERE redemption_id=r.id AND signed_points<0 AND reversal_of IS NULL;
  IF debit.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','ledger_unavailable','message','Original debit required.'); END IF;
  INSERT INTO public.ledger_entry(account_id,redemption_id,signed_points,reversal_of,idempotency_key,note)
    VALUES(r.account_id,r.id,-debit.signed_points,debit.id,'compensate:'||r.id::text,btrim(p_reason));
  UPDATE public.redemption SET status='compensated',compensation_reason=btrim(p_reason) WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'redemption_id',r.id,'status','compensated');
END $$;

CREATE OR REPLACE FUNCTION public.reward_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE aid uuid; roles text[]; policy jsonb; catalog jsonb; redemptions jsonb; ledger jsonb; queue jsonb:='[]'; balance bigint; reserved bigint;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','account_unavailable','message','Account required.'); END IF;
  roles:=public.my_curation_roles();
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
