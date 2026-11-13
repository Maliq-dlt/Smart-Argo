-- Optional AI wording on top of rule explanations. The rule decision stays authoritative; an `ai_explained`
-- snapshot must name its model and prompt version and carry bounded text, and a failed, refused or rejected
-- AI step is stored as `rule_fallback` with that status, never labelled AI.
ALTER TABLE public.ai_snapshot DROP CONSTRAINT ai_snapshot_source_mode_check;
ALTER TABLE public.ai_snapshot ADD CONSTRAINT ai_snapshot_source_mode_check CHECK (source_mode IN ('rule_fallback','ai_explained'));

CREATE OR REPLACE FUNCTION public.save_unit_explanation(p_auth_user_id uuid,p_session_id uuid,p_context jsonb,p_result jsonb,p_request_id uuid,p_question text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE u public.unit; own public.ownership; old public.ai_snapshot; dev public.device; prod public.product; sid uuid; target_product uuid; ai jsonb := p_result->'ai';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_auth_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR p_context IS NULL OR p_result IS NULL OR jsonb_typeof(p_context) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_context::text)>524288 OR octet_length(p_result::text)>16384
    OR p_question IS NULL OR length(p_question)>500 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_snapshot','message','Invalid explanation.'); END IF;
  SELECT product_id INTO target_product FROM public.unit WHERE id=(p_context->>'unit_id')::uuid;
  SELECT * INTO prod FROM public.product WHERE id=target_product FOR UPDATE;
  SELECT * INTO u FROM public.unit WHERE id=(p_context->>'unit_id')::uuid FOR UPDATE;
  SELECT o.* INTO own FROM public.ownership o JOIN public.account a ON a.id=o.account_id WHERE o.product_id=u.product_id
    AND o.end_at IS NULL AND a.auth_user_id=p_auth_user_id;
  IF own.id IS NULL OR own.id IS DISTINCT FROM (p_context->>'ownership_id')::uuid THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Ownership changed; reload unit.'); END IF;
  SELECT * INTO old FROM public.ai_snapshot WHERE ownership_id=own.id AND request_id=p_request_id;
  IF FOUND THEN
    IF old.evidence_ref->>'question' IS DISTINCT FROM p_question OR old.unit_id IS DISTINCT FROM u.id
      OR old.device_id IS DISTINCT FROM (p_context->>'device_id')::uuid THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request identity already used.'); END IF;
    RETURN jsonb_build_object('ok',true,'snapshot',to_jsonb(old),'duplicate',true);
  END IF;
  SELECT * INTO dev FROM public.device WHERE id=(p_context->>'device_id')::uuid AND product_id=u.product_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_auth_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF dev.id IS NULL OR dev.status IS DISTINCT FROM p_context->>'device_status' OR prod.registry_status IS DISTINCT FROM p_context->>'registry_status' THEN
    RETURN jsonb_build_object('ok',false,'code','context_changed','message','Device status changed; reload unit.'); END IF;
  IF u.profile_version_id IS DISTINCT FROM (p_context->>'profile_version_id')::uuid
    OR NOT EXISTS (SELECT 1 FROM public.device WHERE id=(p_context->>'device_id')::uuid AND product_id=u.product_id)
    OR p_result->>'rule_version' IS DISTINCT FROM 'agronomy-v1.telemetry-v1'
    OR p_result->>'decision' IS NULL OR p_result->>'mascot_state' NOT IN ('bingung_menunggu','tenang_senang','sedih_perhatian','waspada_marah')
    OR p_result->>'mascot_state' IS NULL OR p_result->>'explanation' IS NULL OR length(p_result->>'explanation') NOT BETWEEN 1 AND 8000
    -- coalesce: a missing field makes the check NULL, which must count as invalid, not as passing.
    OR NOT coalesce((
      (p_result->>'source_mode'='rule_fallback' AND p_result->>'ai_status' IN ('not_configured','failed','refused','rejected') AND ai IS NULL)
      OR (p_result->>'source_mode'='ai_explained' AND p_result->>'ai_status'='ok' AND jsonb_typeof(ai)='object'
        AND ai->>'model' ~ '^[A-Za-z0-9][A-Za-z0-9./:_-]{0,79}$' AND length(ai->>'prompt_version') BETWEEN 1 AND 64
        AND length(ai->>'explanation') BETWEEN 1 AND 2000 AND (jsonb_typeof(ai->'answer')='null' OR length(ai->>'answer') <= 1000))), false) THEN
    RETURN jsonb_build_object('ok',false,'code','context_changed','message','Profile changed or explanation invalid; reload unit.'); END IF;
  IF (SELECT count(*) FROM public.ai_snapshot WHERE ownership_id=own.id AND created_at>clock_timestamp()-interval '1 minute')>=20 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Explanation rate exceeded.'); END IF;
  INSERT INTO public.ai_snapshot(unit_id,profile_version_id,ownership_id,device_id,request_id,evidence_ref,decision_and_state,model_prompt_version,
    explanation,source_mode,decision_payload,context_sha256)
    VALUES(u.id,u.profile_version_id,own.id,(p_context->>'device_id')::uuid,p_request_id,
      p_context||jsonb_build_object('question',p_question),(p_result->>'decision')||':'||(p_result->>'mascot_state'),
      'agronomy-v1.telemetry-v1 / '||coalesce((ai->>'model')||' '||(ai->>'prompt_version'),'no-generative-model ('||(p_result->>'ai_status')||')'),
      coalesce(ai->>'explanation',p_result->>'explanation'),p_result->>'source_mode',p_result,
      encode(digest(p_context::text,'sha256'),'hex')) RETURNING id INTO sid;
  RETURN (SELECT jsonb_build_object('ok',true,'snapshot',to_jsonb(s),'duplicate',false) FROM public.ai_snapshot s WHERE s.id=sid);
END $$;
