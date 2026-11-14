-- Privileged read scopes require enrolled MFA and AAL2; ordinary roles remain available.
CREATE OR REPLACE FUNCTION public.my_curation_roles() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce(array_agg(r.role ORDER BY r.position) FILTER (
    WHERE r.role NOT IN ('operator','curator') OR public.privileged_role_active(r.role)
  ),ARRAY[]::text[])
  FROM public.account a CROSS JOIN LATERAL unnest(a.access_roles) WITH ORDINALITY AS r(role,position)
  WHERE a.auth_user_id=auth.uid() AND public.current_auth_session();
$$;

CREATE OR REPLACE FUNCTION public.review_profile_contribution(p_id uuid,p_revision integer,p_decision text,p_reason text,p_evidence_level text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE c public.contribution; aid uuid; pid uuid; vid uuid; ver integer; denial jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() AND 'curator'=ANY(access_roles);
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Curator role required.'); END IF;
  SELECT profile_id INTO pid FROM public.contribution WHERE id=p_id;
  PERFORM 1 FROM public.plant_profile WHERE id=pid FOR NO KEY UPDATE;
  SELECT * INTO c FROM public.contribution WHERE id=p_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','contribution_unavailable','message','Contribution unavailable.'); END IF;
  IF c.author_account_id=aid THEN RETURN jsonb_build_object('ok',false,'code','self_review','message','Authors cannot review their own contribution.'); END IF;
  IF c.status<>'pending_review' OR c.revision_count IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('ok',false,'code','revision_conflict','message','Submission changed or already reviewed.'); END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','needs_revision','rejected') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_evidence_level IS NULL OR length(btrim(p_evidence_level)) NOT BETWEEN 1 AND 240 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_review','message','Review decision, reason and evidence level required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contribution_revision WHERE contribution_id=c.id AND revision=c.revision_count AND permission_confirmed)
    OR NOT public.profile_parameters_valid(c.proposed_parameters) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_contribution','message','Validated submission with permission required.'); END IF;
  -- Resource locks precede actor/session locks; key-preserving locks allow contribution FK checks.
  denial:=public.privileged_write_gate('curator');
  IF denial IS NOT NULL THEN RETURN denial; END IF;
  INSERT INTO public.review(contribution_id,reviewer_account_id,decision,decision_reason,revision)
    VALUES(c.id,aid,p_decision,btrim(p_reason),c.revision_count);
  IF p_decision='approved' THEN
    SELECT coalesce(max(version),0)+1 INTO ver FROM public.profile_version WHERE profile_id=c.profile_id;
    INSERT INTO public.profile_version(profile_id,contribution_id,version,parameters_and_scope,evidence_level,provenance)
      SELECT c.profile_id,c.id,ver,c.proposed_parameters,btrim(p_evidence_level),jsonb_build_object(
        'species_variety',p.species_variety,'context_scope',p.context_scope,
        'source_method_license',c.source_method_license,'evidence_ref',c.evidence_ref,
        'review_reason',btrim(p_reason),'revision',c.revision_count)
      FROM public.plant_profile p WHERE p.id=c.profile_id RETURNING id INTO vid;
  END IF;
  UPDATE public.contribution SET status=p_decision,updated_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'contribution_id',c.id,'profile_version_id',vid,'version',ver);
END $$;
