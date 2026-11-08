-- Reviewed community profiles; published versions and their evidence remain immutable.
ALTER TABLE public.review ADD COLUMN revision integer CHECK (revision >= 1);
ALTER TABLE public.profile_version ADD COLUMN provenance jsonb;
-- Pin existing metadata before enabling immutability; later legacy INSERT fixtures remain explicitly unpinned.
UPDATE public.profile_version v SET provenance=jsonb_build_object(
  'species_variety',p.species_variety,'context_scope',p.context_scope,
  'source_method_license',c.source_method_license,'evidence_ref',c.evidence_ref,
  'review_reason',(SELECT r.decision_reason FROM public.review r WHERE r.contribution_id=c.id AND r.decision='approved' ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1),
  'revision',c.revision_count)
FROM public.plant_profile p,public.contribution c WHERE v.profile_id=p.id AND v.contribution_id=c.id AND v.provenance IS NULL;
CREATE TABLE public.contribution_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id uuid NOT NULL REFERENCES public.contribution(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 20),
  source_method_license text NOT NULL,
  evidence_ref text NOT NULL,
  proposed_parameters jsonb NOT NULL,
  permission_confirmed boolean NOT NULL CHECK (permission_confirmed),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(contribution_id,revision)
);
ALTER TABLE public.contribution_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contribution_revision FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.contribution_revision TO service_role;

CREATE FUNCTION public.profile_parameters_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,extensions AS $$
DECLARE k text; v jsonb; low_median numeric; high_median numeric;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>11
    OR NOT (p ?& ARRAY['pot_id','crop','media','phase','validated','ph_validated','needs_water','drained','next_visit_h','hot_c','ph_range']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['pot_id','crop','media','phase'] LOOP
    IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR length(btrim(p->>k))<1 OR length(p->>k)>120 THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(p->'validated') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'ph_validated') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['needs_water','drained'] LOOP
    IF jsonb_typeof(p->k) IS DISTINCT FROM 'array' OR jsonb_array_length(p->k) NOT BETWEEN 3 AND 100 THEN RETURN false; END IF;
    FOR v IN SELECT value FROM jsonb_array_elements(p->k) LOOP
      IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR (v::text)::numeric NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (value::text)::double precision) INTO low_median FROM jsonb_array_elements(p->'needs_water');
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (value::text)::double precision) INTO high_median FROM jsonb_array_elements(p->'drained');
  IF high_median-low_median<10 OR jsonb_typeof(p->'next_visit_h') IS DISTINCT FROM 'number'
    OR (p->>'next_visit_h')::numeric NOT BETWEEN 0.1 AND 24 OR jsonb_typeof(p->'hot_c') IS DISTINCT FROM 'number'
    OR (p->>'hot_c')::numeric NOT BETWEEN 20 AND 60 THEN RETURN false; END IF;
  IF jsonb_typeof(p->'ph_range') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'ph_range')<>2 THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p->'ph_range') LOOP
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR (v::text)::numeric NOT BETWEEN 0 AND 14 THEN RETURN false; END IF;
  END LOOP;
  RETURN (p->'ph_range'->>0)::numeric < (p->'ph_range'->>1)::numeric;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION public.profile_artifact_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,extensions AS $$
BEGIN RAISE EXCEPTION 'Published profiles, reviews and contribution revisions are immutable'; END $$;
CREATE TRIGGER profile_version_immutable BEFORE UPDATE OR DELETE ON public.profile_version FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
CREATE TRIGGER review_immutable BEFORE UPDATE OR DELETE ON public.review FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();
CREATE TRIGGER contribution_revision_immutable BEFORE UPDATE OR DELETE ON public.contribution_revision FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();

CREATE FUNCTION public.my_curation_roles() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
 SELECT coalesce((SELECT access_roles FROM public.account WHERE auth_user_id=auth.uid() AND public.current_auth_session()),ARRAY[]::text[]);
$$;
GRANT SELECT ON public.contribution,public.contribution_revision,public.review TO authenticated;
CREATE POLICY phase3_contribution_read ON public.contribution FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND (author_account_id IN (SELECT id FROM public.account WHERE auth_user_id=auth.uid()) OR 'curator'=ANY(public.my_curation_roles()))
);
CREATE POLICY phase3_revision_read ON public.contribution_revision FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND contribution_id IN (SELECT id FROM public.contribution)
);
CREATE POLICY phase3_review_read ON public.review FOR SELECT TO authenticated USING (
  (SELECT public.current_auth_session()) AND contribution_id IN (SELECT id FROM public.contribution)
);

CREATE FUNCTION public.submit_profile_contribution(p_profile_id uuid,p_species text,p_scope text,p_source_license text,p_evidence_ref text,p_parameters jsonb,p_permission boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE a public.account; pid uuid:=p_profile_id; cid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT * INTO a FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF a.id IS NULL OR NOT ('contributor'=ANY(a.access_roles)) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Contributor role required.'); END IF;
  IF p_permission IS DISTINCT FROM true OR p_source_license IS NULL OR length(btrim(p_source_license)) NOT BETWEEN 1 AND 1000
    OR p_evidence_ref IS NULL OR length(btrim(p_evidence_ref)) NOT BETWEEN 1 AND 1000 OR NOT public.profile_parameters_valid(p_parameters)
    OR p_species IS NULL OR length(btrim(p_species)) NOT BETWEEN 1 AND 120 OR p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 1000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_contribution','message','Permission, provenance, scope and valid profile parameters required.'); END IF;
  -- ponytail: ten new submissions per hour and twenty revisions bound moderation load; tune after observed usage.
  IF (SELECT count(*) FROM public.contribution WHERE author_account_id=a.id AND created_at>clock_timestamp()-interval '1 hour')>=10 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Submission rate exceeded.'); END IF;
  IF pid IS NULL THEN
    INSERT INTO public.plant_profile(species_variety,context_scope) VALUES(btrim(p_species),btrim(p_scope))
      ON CONFLICT (species_variety) DO NOTHING RETURNING id INTO pid;
    IF pid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','profile_exists','message','Choose the existing species profile.'); END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.plant_profile WHERE id=pid) THEN
    RETURN jsonb_build_object('ok',false,'code','profile_unavailable','message','Profile unavailable.');
  END IF;
  INSERT INTO public.contribution(profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters)
    VALUES(pid,a.id,btrim(p_source_license),btrim(p_evidence_ref),p_parameters) RETURNING id INTO cid;
  INSERT INTO public.contribution_revision(contribution_id,revision,source_method_license,evidence_ref,proposed_parameters,permission_confirmed)
    VALUES(cid,1,btrim(p_source_license),btrim(p_evidence_ref),p_parameters,true);
  RETURN jsonb_build_object('ok',true,'contribution_id',cid,'profile_id',pid,'revision',1);
END $$;

CREATE FUNCTION public.revise_profile_contribution(p_id uuid,p_revision integer,p_source_license text,p_evidence_ref text,p_parameters jsonb,p_permission boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE c public.contribution; aid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() AND 'contributor'=ANY(access_roles);
  SELECT * INTO c FROM public.contribution WHERE id=p_id FOR UPDATE;
  IF aid IS NULL OR c.author_account_id IS DISTINCT FROM aid THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Contribution author required.'); END IF;
  IF c.status<>'needs_revision' OR c.revision_count IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('ok',false,'code','revision_conflict','message','Submission changed or is not awaiting revision.'); END IF;
  IF c.revision_count>=20 THEN RETURN jsonb_build_object('ok',false,'code','revision_limit','message','Revision limit reached.'); END IF;
  IF p_permission IS DISTINCT FROM true OR p_source_license IS NULL OR length(btrim(p_source_license)) NOT BETWEEN 1 AND 1000
    OR p_evidence_ref IS NULL OR length(btrim(p_evidence_ref)) NOT BETWEEN 1 AND 1000 OR NOT public.profile_parameters_valid(p_parameters) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_contribution','message','Permission, provenance and valid parameters required.'); END IF;
  UPDATE public.contribution SET source_method_license=btrim(p_source_license),evidence_ref=btrim(p_evidence_ref),proposed_parameters=p_parameters,
    status='pending_review',revision_count=revision_count+1,updated_at=clock_timestamp() WHERE id=c.id;
  INSERT INTO public.contribution_revision(contribution_id,revision,source_method_license,evidence_ref,proposed_parameters,permission_confirmed)
    VALUES(c.id,c.revision_count+1,btrim(p_source_license),btrim(p_evidence_ref),p_parameters,true);
  RETURN jsonb_build_object('ok',true,'contribution_id',c.id,'revision',c.revision_count+1);
END $$;

CREATE FUNCTION public.review_profile_contribution(p_id uuid,p_revision integer,p_decision text,p_reason text,p_evidence_level text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE c public.contribution; aid uuid; pid uuid; vid uuid; ver integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() AND 'curator'=ANY(access_roles);
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Curator role required.'); END IF;
  SELECT profile_id INTO pid FROM public.contribution WHERE id=p_id;
  PERFORM 1 FROM public.plant_profile WHERE id=pid FOR UPDATE;
  SELECT * INTO c FROM public.contribution WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','contribution_unavailable','message','Contribution unavailable.'); END IF;
  IF c.author_account_id=aid THEN RETURN jsonb_build_object('ok',false,'code','self_review','message','Authors cannot review their own contribution.'); END IF;
  IF c.status<>'pending_review' OR c.revision_count IS DISTINCT FROM p_revision THEN RETURN jsonb_build_object('ok',false,'code','revision_conflict','message','Submission changed or already reviewed.'); END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','needs_revision','rejected') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_evidence_level IS NULL OR length(btrim(p_evidence_level)) NOT BETWEEN 1 AND 240 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_review','message','Review decision, reason and evidence level required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contribution_revision WHERE contribution_id=c.id AND revision=c.revision_count AND permission_confirmed)
    OR NOT public.profile_parameters_valid(c.proposed_parameters) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_contribution','message','Validated submission with permission required.'); END IF;
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

CREATE FUNCTION public.knowledge_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE roles text[]; aid uuid; profiles jsonb; contributions jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  roles:=public.my_curation_roles(); SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid();
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO profiles FROM (
    SELECT p.id,p.species_variety,p.context_scope FROM public.plant_profile p
    WHERE 'curator'=ANY(roles) OR EXISTS (SELECT 1 FROM public.profile_version v WHERE v.profile_id=p.id AND v.published_at<=clock_timestamp())
      OR EXISTS (SELECT 1 FROM public.contribution c WHERE c.profile_id=p.id AND c.author_account_id=aid)
    ORDER BY p.species_variety LIMIT 100
  ) q;
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO contributions FROM (
    SELECT c.id,c.profile_id,c.author_account_id,c.source_method_license,c.evidence_ref,c.proposed_parameters,c.status,c.revision_count,
      (SELECT jsonb_build_object('decision',r.decision,'decision_reason',r.decision_reason,'revision',r.revision) FROM public.review r WHERE r.contribution_id=c.id ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1) latest_review,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.revision),'[]') FROM (SELECT revision,source_method_license,evidence_ref,proposed_parameters,created_at FROM public.contribution_revision WHERE contribution_id=c.id ORDER BY revision DESC LIMIT 20) v) revisions,
      (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.reviewed_at),'[]') FROM (SELECT decision,decision_reason,revision,reviewed_at FROM public.review WHERE contribution_id=c.id ORDER BY reviewed_at DESC LIMIT 20) v) reviews
    FROM public.contribution c WHERE c.author_account_id=aid OR 'curator'=ANY(roles)
    ORDER BY c.updated_at DESC,c.id DESC LIMIT 100
  ) q;
  RETURN jsonb_build_object('ok',true,'roles',roles,'profiles',profiles,'contributions',contributions);
END $$;

CREATE FUNCTION public.published_profile_details(p_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT jsonb_build_object('id',v.id,'profile_id',p.id,'species_variety',CASE WHEN v.provenance IS NULL THEN p.species_variety ELSE v.provenance->>'species_variety' END,
    'context_scope',CASE WHEN v.provenance IS NULL THEN p.context_scope ELSE v.provenance->>'context_scope' END,
    'version',v.version,'parameters_and_scope',v.parameters_and_scope,'evidence_level',v.evidence_level,
    'source_method_license',CASE WHEN v.provenance IS NULL THEN c.source_method_license ELSE v.provenance->>'source_method_license' END,
    'evidence_ref',CASE WHEN v.provenance IS NULL THEN c.evidence_ref ELSE v.provenance->>'evidence_ref' END,
    'provenance_status',CASE WHEN v.provenance IS NULL THEN 'legacy_unpinned' ELSE 'pinned' END,
    'review_reason',v.provenance->>'review_reason','revision',v.provenance->'revision','published_at',v.published_at) INTO result
    FROM public.profile_version v JOIN public.plant_profile p ON p.id=v.profile_id JOIN public.contribution c ON c.id=v.contribution_id
    WHERE v.id=p_version_id AND v.published_at<=clock_timestamp();
  IF result IS NULL THEN RETURN jsonb_build_object('ok',false,'code','profile_unavailable','message','Published profile unavailable.'); END IF;
  RETURN jsonb_build_object('ok',true,'profile',result);
END $$;

CREATE FUNCTION public.assign_unit_profile(p_unit_id uuid,p_profile_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE pid uuid; p public.product; u public.unit; parameters jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT product_id INTO pid FROM public.unit WHERE id=p_unit_id;
  SELECT * INTO p FROM public.product WHERE id=pid FOR UPDATE;
  SELECT * INTO u FROM public.unit WHERE id=p_unit_id FOR UPDATE;
  IF u.id IS NULL OR u.product_id IS DISTINCT FROM p.id OR p.registry_status<>'active' OR NOT EXISTS (
    SELECT 1 FROM public.ownership o JOIN public.account a ON a.id=o.account_id WHERE o.product_id=p.id AND o.end_at IS NULL AND a.auth_user_id=auth.uid()) THEN
    RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  SELECT parameters_and_scope INTO parameters FROM public.profile_version WHERE id=p_profile_version_id AND published_at<=clock_timestamp();
  IF NOT FOUND OR NOT public.profile_parameters_valid(parameters) THEN RETURN jsonb_build_object('ok',false,'code','profile_unavailable','message','Published valid profile required.'); END IF;
  IF (parameters->>'validated')::boolean AND parameters->>'pot_id'<>u.id::text THEN
    RETURN jsonb_build_object('ok',false,'code','calibration_mismatch','message','Validated profile belongs to another calibration target.'); END IF;
  UPDATE public.unit SET profile_version_id=p_profile_version_id WHERE id=u.id;
  RETURN jsonb_build_object('ok',true,'unit_id',u.id,'profile_version_id',p_profile_version_id);
END $$;

REVOKE ALL ON FUNCTION public.profile_parameters_valid(jsonb),public.profile_artifact_immutable(),public.my_curation_roles(),public.knowledge_workspace(),public.submit_profile_contribution(uuid,text,text,text,text,jsonb,boolean),public.revise_profile_contribution(uuid,integer,text,text,jsonb,boolean),public.review_profile_contribution(uuid,integer,text,text,text),public.published_profile_details(uuid),public.assign_unit_profile(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_curation_roles(),public.knowledge_workspace(),public.submit_profile_contribution(uuid,text,text,text,text,jsonb,boolean),public.revise_profile_contribution(uuid,integer,text,text,jsonb,boolean),public.review_profile_contribution(uuid,integer,text,text,text),public.published_profile_details(uuid),public.assign_unit_profile(uuid,uuid) TO authenticated;
