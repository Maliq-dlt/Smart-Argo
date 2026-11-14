-- SEC-02: durable admission precedes inference across every edge/gateway instance.
-- ponytail: 20 attempts/minute and 2 live workers per account; tune after measuring provider capacity.
CREATE TABLE public.explanation_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  ownership_id uuid NOT NULL REFERENCES public.ownership(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.unit(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES public.device(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  question text NOT NULL CHECK (length(question)<=500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 minutes',
  finished_at timestamptz
);
CREATE INDEX explanation_attempt_quota ON public.explanation_attempt(account_id,created_at);
CREATE INDEX explanation_attempt_live ON public.explanation_attempt(account_id,lease_until) WHERE finished_at IS NULL;
CREATE INDEX explanation_attempt_request ON public.explanation_attempt(account_id,request_id,created_at DESC);
ALTER TABLE public.explanation_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explanation_attempt FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.reserve_unit_explanation(p_unit_id uuid,p_device_id uuid,p_request_id uuid,p_question text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE acc public.account; own public.ownership; attempt public.explanation_attempt; old public.ai_snapshot; token uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_unit_id IS NULL OR p_device_id IS NULL OR p_request_id IS NULL OR p_question IS NULL OR length(p_question)>500 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Invalid explanation request.'); END IF;
  -- Serialize account-wide admission, including requests for different products.
  SELECT * INTO acc FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  SELECT o.* INTO own FROM public.ownership o JOIN public.unit u ON u.product_id=o.product_id
    JOIN public.device d ON d.product_id=u.product_id WHERE u.id=p_unit_id AND d.id=p_device_id AND o.account_id=acc.id AND o.end_at IS NULL;
  IF own.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit and matching device required.'); END IF;
  SELECT * INTO attempt FROM public.explanation_attempt WHERE account_id=acc.id AND request_id=p_request_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF FOUND AND (attempt.ownership_id IS DISTINCT FROM own.id OR attempt.unit_id IS DISTINCT FROM p_unit_id OR attempt.device_id IS DISTINCT FROM p_device_id OR attempt.question IS DISTINCT FROM p_question) THEN
    RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request identity already used.'); END IF;
  SELECT * INTO old FROM public.ai_snapshot WHERE ownership_id=own.id AND request_id=p_request_id;
  IF FOUND THEN
    IF old.unit_id IS DISTINCT FROM p_unit_id OR old.device_id IS DISTINCT FROM p_device_id OR old.evidence_ref->>'question' IS DISTINCT FROM p_question THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request identity already used.'); END IF;
    RETURN jsonb_build_object('ok',true,'snapshot',to_jsonb(old),'duplicate',true);
  END IF;
  IF attempt.id IS NOT NULL AND attempt.finished_at IS NULL AND attempt.lease_until>clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','request_pending','message','This request is still being processed. Retry with the same identity.'); END IF;
  -- Failed and expired work still costs provider capacity; every retry is a new charged row.
  IF (SELECT count(*) FROM public.explanation_attempt WHERE account_id=acc.id AND created_at>clock_timestamp()-interval '1 minute')>=20 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Explanation rate exceeded.'); END IF;
  IF (SELECT count(*) FROM public.explanation_attempt WHERE account_id=acc.id AND finished_at IS NULL AND lease_until>clock_timestamp())>=2 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Too many explanations in progress.'); END IF;
  INSERT INTO public.explanation_attempt(account_id,ownership_id,unit_id,device_id,request_id,question)
    VALUES(acc.id,own.id,p_unit_id,p_device_id,p_request_id,p_question) RETURNING id INTO token;
  RETURN jsonb_build_object('ok',true,'attempt_id',token,'duplicate',false);
END $$;

CREATE FUNCTION public.finish_unit_explanation(p_attempt_id uuid,p_auth_user_id uuid,p_session_id uuid,p_aal text,p_context jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE attempt public.explanation_attempt; result jsonb; acc_id uuid; target_product uuid;
BEGIN
  SELECT a.account_id,u.product_id INTO acc_id,target_product FROM public.explanation_attempt a JOIN public.unit u ON u.id=a.unit_id WHERE a.id=p_attempt_id;
  -- Match energy/ownership writes: product before account, never account before product.
  PERFORM 1 FROM public.product WHERE id=target_product FOR UPDATE;
  PERFORM 1 FROM public.account WHERE id=acc_id AND auth_user_id=p_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active owner required.'); END IF;
  SELECT * INTO attempt FROM public.explanation_attempt WHERE id=p_attempt_id FOR UPDATE;
  IF attempt.finished_at IS NOT NULL OR attempt.lease_until<=clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','request_expired','message','Attempt expired; retry with the same identity.'); END IF;
  PERFORM 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_auth_user_id FOR SHARE;
  IF NOT FOUND OR p_aal IS NULL OR p_aal NOT IN ('aal1','aal2') OR (p_aal<>'aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors WHERE user_id=p_auth_user_id AND status='verified')) THEN
    RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active authenticated session required.'); END IF;
  IF p_context->>'unit_id' IS DISTINCT FROM attempt.unit_id::text OR p_context->>'device_id' IS DISTINCT FROM attempt.device_id::text
    OR p_context->>'ownership_id' IS DISTINCT FROM attempt.ownership_id::text THEN
    RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Attempt evidence does not match.'); END IF;
  IF attempt.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'code','request_expired','message','Attempt expired; retry with the same identity.'); END IF;
  result:=public.save_unit_explanation(p_auth_user_id,p_session_id,p_context,p_result,attempt.request_id,attempt.question);
  -- Roll back the snapshot too if a blocked inner save outlives its worker lease.
  IF attempt.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Explanation attempt expired during finalization'; END IF;
  UPDATE public.explanation_attempt SET finished_at=clock_timestamp() WHERE id=attempt.id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_unit_explanation(uuid,uuid,uuid,text),public.finish_unit_explanation(uuid,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_unit_explanation(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_unit_explanation(uuid,uuid,uuid,text,jsonb,jsonb) TO service_role;
