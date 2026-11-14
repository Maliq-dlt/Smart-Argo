-- Private append-only observations; no actuator, telemetry or reward side effects.
CREATE TABLE public.care_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  ownership_id uuid NOT NULL REFERENCES public.ownership(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES public.unit(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('watering','fertilizing','inspection','note')),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  amount_ml numeric CHECK (amount_ml > 0 AND amount_ml <= 100000),
  notes text NOT NULL CHECK (length(notes)<=2000 AND octet_length(notes)<=8000 AND notes=btrim(notes)),
  UNIQUE(account_id,request_id),
  CHECK ((kind='watering' AND amount_ml IS NOT NULL) OR (kind<>'watering' AND amount_ml IS NULL)),
  CHECK (kind<>'note' OR length(notes)>0)
);
CREATE INDEX care_journal_page ON public.care_journal(ownership_id,unit_id,observed_at DESC,id DESC);
CREATE INDEX care_journal_rate ON public.care_journal(account_id,created_at);
ALTER TABLE public.care_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_journal FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.append_my_care_journal(p_unit_id uuid,p_request_id uuid,p_kind text,p_observed_at timestamptz,p_amount_ml numeric DEFAULT NULL,p_notes text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prod public.product; acc public.account; own public.ownership; entry public.care_journal; sid uuid; clean text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  clean:=btrim(p_notes);
  IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('watering','fertilizing','inspection','note') OR p_observed_at IS NULL OR NOT isfinite(p_observed_at)
    OR p_observed_at>clock_timestamp()+interval '5 minutes' OR clean IS NULL OR length(clean)>2000 OR octet_length(clean)>8000
    OR (p_kind='note' AND clean='') OR (p_kind='watering' AND (p_amount_ml IS NULL OR NOT (p_amount_ml>0 AND p_amount_ml<=100000)))
    OR (p_kind<>'watering' AND p_amount_ml IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Invalid care observation.'); END IF;
  SELECT p.* INTO prod FROM public.product p JOIN public.unit u ON u.product_id=p.id WHERE u.id=p_unit_id FOR UPDATE OF p;
  IF NOT FOUND OR prod.registry_status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  SELECT * INTO own FROM public.ownership WHERE product_id=prod.id AND account_id=acc.id AND end_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  PERFORM 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid() FOR SHARE;
  IF NOT FOUND OR NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_observed_at<own.start_at THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Observation predates current ownership.'); END IF;
  SELECT * INTO entry FROM public.care_journal WHERE account_id=acc.id AND request_id=p_request_id;
  IF FOUND THEN
    IF entry.ownership_id<>own.id OR entry.unit_id<>p_unit_id OR entry.kind<>p_kind OR entry.observed_at<>p_observed_at OR entry.amount_ml IS DISTINCT FROM p_amount_ml OR entry.notes<>clean THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request identity already used for another observation.'); END IF;
    RETURN jsonb_build_object('ok',true,'entry',to_jsonb(entry)-ARRAY['account_id','ownership_id','request_id'],'idempotent',true);
  END IF;
  IF (SELECT count(*) FROM public.care_journal WHERE account_id=acc.id AND created_at>clock_timestamp()-interval '1 minute')>=20 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','Care journal write limit reached.'); END IF;
  INSERT INTO public.care_journal(account_id,ownership_id,unit_id,request_id,kind,observed_at,amount_ml,notes)
    VALUES(acc.id,own.id,p_unit_id,p_request_id,p_kind,p_observed_at,p_amount_ml,clean) RETURNING * INTO entry;
  RETURN jsonb_build_object('ok',true,'entry',to_jsonb(entry)-ARRAY['account_id','ownership_id','request_id'],'idempotent',false);
END $$;

CREATE FUNCTION public.read_my_care_journal(p_unit_id uuid,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_snapshot_as_of timestamptz DEFAULT NULL,p_before_observed_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prod public.product; acc public.account; own public.ownership; sid uuid; snap timestamptz; range_from timestamptz; range_to timestamptz; entries jsonb; cursor jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_from IS NOT NULL AND NOT isfinite(p_from)) OR (p_to IS NOT NULL AND NOT isfinite(p_to))
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) OR (p_snapshot_as_of IS NOT NULL AND (NOT isfinite(p_snapshot_as_of) OR p_snapshot_as_of>clock_timestamp()))
    OR ((p_before_id IS NULL)<>(p_before_observed_at IS NULL)) OR (p_before_observed_at IS NOT NULL AND (NOT isfinite(p_before_observed_at) OR p_snapshot_as_of IS NULL)) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Invalid journal range or cursor.'); END IF;
  SELECT p.* INTO prod FROM public.product p JOIN public.unit u ON u.product_id=p.id WHERE u.id=p_unit_id FOR SHARE OF p;
  IF NOT FOUND OR prod.registry_status<>'active' THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  SELECT * INTO own FROM public.ownership WHERE product_id=prod.id AND account_id=acc.id AND end_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  sid:=(auth.jwt()->>'session_id')::uuid;
  PERFORM 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid() FOR SHARE;
  IF NOT FOUND OR NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  snap:=coalesce(p_snapshot_as_of,clock_timestamp());
  range_to:=coalesce(p_to,snap); range_from:=coalesce(p_from,range_to-interval '31 days');
  IF range_from>range_to OR range_to-range_from>interval '31 days' THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Journal range must not exceed 31 days.'); END IF;
  WITH page AS (
    SELECT j.*,row_number() OVER (ORDER BY observed_at DESC,id DESC) AS position FROM public.care_journal j
    WHERE ownership_id=own.id AND account_id=acc.id AND unit_id=p_unit_id AND created_at<=snap
      AND observed_at>=range_from AND observed_at<range_to
      AND (p_before_id IS NULL OR (observed_at,id)<(p_before_observed_at,p_before_id))
    ORDER BY observed_at DESC,id DESC LIMIT p_limit+1
  ) SELECT coalesce(jsonb_agg(to_jsonb(page)-ARRAY['account_id','ownership_id','request_id','position'] ORDER BY observed_at DESC,id DESC) FILTER (WHERE position<=p_limit),'[]'),
    CASE WHEN count(*)>p_limit THEN (SELECT jsonb_build_object('observed_at',observed_at,'id',id) FROM page WHERE position=p_limit) ELSE NULL END
    INTO entries,cursor FROM page;
  RETURN jsonb_build_object('ok',true,'entries',entries,'snapshot_as_of',snap,'next_cursor',cursor);
END $$;
REVOKE ALL ON FUNCTION public.append_my_care_journal(uuid,uuid,text,timestamptz,numeric,text),public.read_my_care_journal(uuid,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_my_care_journal(uuid,uuid,text,timestamptz,numeric,text),public.read_my_care_journal(uuid,timestamptz,timestamptz,timestamptz,timestamptz,uuid,integer) TO authenticated;