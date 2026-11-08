-- Evidence snapshots are owner-scoped, server-produced and immutable.
ALTER TABLE public.ai_snapshot ADD COLUMN ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_snapshot ADD COLUMN device_id uuid REFERENCES public.device(id) ON DELETE RESTRICT;
ALTER TABLE public.ai_snapshot ADD COLUMN request_id uuid;
ALTER TABLE public.ai_snapshot ADD COLUMN source_mode text CHECK (source_mode='rule_fallback');
ALTER TABLE public.ai_snapshot ADD COLUMN decision_payload jsonb;
ALTER TABLE public.ai_snapshot ADD COLUMN context_sha256 text;
CREATE UNIQUE INDEX ai_snapshot_owner_request ON public.ai_snapshot(ownership_id,request_id);
CREATE TRIGGER ai_snapshot_immutable BEFORE UPDATE OR DELETE ON public.ai_snapshot FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
CREATE TRIGGER measurement_immutable BEFORE UPDATE OR DELETE ON public.measurement FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
GRANT SELECT ON public.ai_snapshot TO authenticated;
CREATE POLICY phase3_snapshot_read ON public.ai_snapshot FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND EXISTS (SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    WHERE o.id=ai_snapshot.ownership_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid())
);

CREATE FUNCTION public.unit_explanation_context(p_unit_id uuid,p_device_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE u public.unit; o public.ownership; dev public.device; prof jsonb; packets jsonb; checked_at timestamptz:=clock_timestamp();
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT * INTO u FROM public.unit WHERE id=p_unit_id;
  SELECT own.* INTO o FROM public.ownership own JOIN public.account a ON a.id=own.account_id
    WHERE own.product_id=u.product_id AND own.end_at IS NULL AND a.auth_user_id=auth.uid();
  SELECT * INTO dev FROM public.device WHERE id=p_device_id AND product_id=u.product_id;
  IF o.id IS NULL OR dev.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit and matching device required.'); END IF;
  SELECT jsonb_build_object('id',v.id,'version',v.version,'parameters',v.parameters_and_scope,'evidence_level',v.evidence_level,
    'species_variety',coalesce(v.provenance->>'species_variety',p.species_variety),'context_scope',coalesce(v.provenance->>'context_scope',p.context_scope),
    'source_method_license',coalesce(v.provenance->>'source_method_license',c.source_method_license),'evidence_ref',coalesce(v.provenance->>'evidence_ref',c.evidence_ref),
    'provenance_status',CASE WHEN v.provenance IS NULL THEN 'legacy_unpinned' ELSE 'pinned' END)
    INTO prof FROM public.profile_version v JOIN public.plant_profile p ON p.id=v.profile_id JOIN public.contribution c ON c.id=v.contribution_id
    WHERE v.id=u.profile_version_id AND v.published_at<=checked_at;
  -- ponytail: latest 120 packets within 24 hours; longer analysis requires measured retention/load and explicit pagination.
  SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.measured_at,rows.packet_id),'[]'::jsonb) INTO packets FROM (
    SELECT t.id AS packet_id,t.measured_at,t.received_at,t.clock_status,t.boot_id,t.sequence,
      (SELECT jsonb_object_agg(m.sensor_id,jsonb_build_object('status',m.quality_status,'value',m.value_nullable)||
        CASE WHEN m.error_message IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('error',m.error_message) END)
        FROM public.measurement m WHERE m.packet_id=t.id AND m.unit_id=u.id AND m.source='device') AS sensors
    FROM public.telemetry_packet t WHERE t.unit_id=u.id AND t.device_id=dev.id
      AND t.received_at<=checked_at AND t.measured_at>=o.start_at AND t.received_at>=o.start_at AND t.measured_at>=checked_at-interval '24 hours'
    ORDER BY t.measured_at DESC,t.id DESC LIMIT 120
  ) rows;
  RETURN jsonb_build_object('ok',true,'unit_id',u.id,'device_id',dev.id,'ownership_id',o.id,'profile_version_id',u.profile_version_id,
    'device_status',dev.status,'registry_status',(SELECT registry_status FROM public.product WHERE id=u.product_id),
    'evaluated_at',checked_at,'profile',prof,'packets',packets);
END $$;

CREATE FUNCTION public.save_unit_explanation(p_auth_user_id uuid,p_session_id uuid,p_context jsonb,p_result jsonb,p_request_id uuid,p_question text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE u public.unit; own public.ownership; old public.ai_snapshot; dev public.device; prod public.product; sid uuid; target_product uuid;
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
    OR p_result->>'source_mode' IS DISTINCT FROM 'rule_fallback' OR p_result->>'rule_version' IS DISTINCT FROM 'agronomy-v1.telemetry-v1'
    OR p_result->>'decision' IS NULL OR p_result->>'mascot_state' NOT IN ('bingung_menunggu','tenang_senang','sedih_perhatian','waspada_marah')
    OR p_result->>'mascot_state' IS NULL OR p_result->>'explanation' IS NULL OR length(p_result->>'explanation') NOT BETWEEN 1 AND 8000 THEN
    RETURN jsonb_build_object('ok',false,'code','context_changed','message','Profile changed or explanation invalid; reload unit.'); END IF;
  IF (SELECT count(*) FROM public.ai_snapshot WHERE ownership_id=own.id AND created_at>clock_timestamp()-interval '1 minute')>=20 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Explanation rate exceeded.'); END IF;
  INSERT INTO public.ai_snapshot(unit_id,profile_version_id,ownership_id,device_id,request_id,evidence_ref,decision_and_state,model_prompt_version,
    explanation,source_mode,decision_payload,context_sha256)
    VALUES(u.id,u.profile_version_id,own.id,(p_context->>'device_id')::uuid,p_request_id,
      p_context||jsonb_build_object('question',p_question),(p_result->>'decision')||':'||(p_result->>'mascot_state'),
      'agronomy-v1.telemetry-v1 / no-generative-model',p_result->>'explanation','rule_fallback',p_result,
      encode(digest(p_context::text,'sha256'),'hex')) RETURNING id INTO sid;
  RETURN (SELECT jsonb_build_object('ok',true,'snapshot',to_jsonb(s),'duplicate',false) FROM public.ai_snapshot s WHERE s.id=sid);
END $$;

CREATE FUNCTION public.unit_explanations(p_unit_id uuid,p_device_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE oid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT o.id INTO oid FROM public.unit u JOIN public.ownership o ON o.product_id=u.product_id JOIN public.account a ON a.id=o.account_id
    WHERE u.id=p_unit_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid();
  IF oid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit required.'); END IF;
  RETURN (SELECT jsonb_build_object('ok',true,'snapshots',coalesce(jsonb_agg(to_jsonb(rows) ORDER BY rows.created_at DESC,rows.id DESC),'[]'::jsonb)) FROM (
    SELECT * FROM public.ai_snapshot WHERE unit_id=p_unit_id AND device_id=p_device_id AND ownership_id=oid ORDER BY created_at DESC,id DESC LIMIT 10
  ) rows);
END $$;
REVOKE ALL ON FUNCTION public.unit_explanation_context(uuid,uuid),public.unit_explanations(uuid,uuid),public.save_unit_explanation(uuid,uuid,jsonb,jsonb,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unit_explanation_context(uuid,uuid),public.unit_explanations(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_unit_explanation(uuid,uuid,jsonb,jsonb,uuid,text) TO service_role;
