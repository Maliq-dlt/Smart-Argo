-- knowledge_workspace listed the first 100 profiles by name while contributions (also up to 100) could point at
-- profiles outside that page, so a curator saw raw profile ids instead of names once the catalogue grew past 100.
-- Profiles referenced by the returned contributions now always come first; the rest fill the page as before. The
-- page stays at 100 (the client contract): at most 100 contributions reference at most 100 distinct profiles.
CREATE OR REPLACE FUNCTION public.knowledge_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE roles text[]; aid uuid; profiles jsonb; contributions jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  roles:=public.my_curation_roles(); SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid();
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO contributions FROM (
    SELECT c.id,c.profile_id,c.author_account_id,c.source_method_license,c.evidence_ref,c.proposed_parameters,c.status,c.revision_count,
      (SELECT jsonb_build_object('decision',r.decision,'decision_reason',r.decision_reason,'revision',r.revision) FROM public.review r WHERE r.contribution_id=c.id ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1) latest_review,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.revision),'[]') FROM (SELECT revision,source_method_license,evidence_ref,proposed_parameters,created_at FROM public.contribution_revision WHERE contribution_id=c.id ORDER BY revision DESC LIMIT 20) v) revisions,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.reviewed_at),'[]') FROM (SELECT decision,decision_reason,revision,reviewed_at FROM public.review WHERE contribution_id=c.id ORDER BY reviewed_at DESC LIMIT 20) v) reviews
    FROM public.contribution c WHERE c.author_account_id=aid OR 'curator'=ANY(roles)
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 100
  ) q;
  SELECT coalesce(jsonb_agg(to_jsonb(q) - 'referenced'),'[]') INTO profiles FROM (
    SELECT p.id,p.species_variety,p.context_scope,
      p.id IN (SELECT (e->>'profile_id')::uuid FROM jsonb_array_elements(contributions) e) referenced
    FROM public.plant_profile p
    WHERE 'curator'=ANY(roles) OR EXISTS (SELECT 1 FROM public.profile_version v WHERE v.profile_id=p.id AND v.published_at<=clock_timestamp())
      OR EXISTS (SELECT 1 FROM public.contribution c WHERE c.profile_id=p.id AND c.author_account_id=aid)
    ORDER BY referenced DESC,p.species_variety LIMIT 100
  ) q;
  RETURN jsonb_build_object('ok',true,'roles',roles,'profiles',profiles,'contributions',contributions);
END $$;
