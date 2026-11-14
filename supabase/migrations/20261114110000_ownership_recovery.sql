-- ID-03 (U03, A04 "konflik → pemulihan lewat proses dukungan"): someone who lost access to a product, or found it
-- already claimed, asks for it with a statement and evidence references. The current owner is told (without the
-- claimant's identity). An operator takes the case and decides with a reason; approval moves ownership in one
-- transaction exactly like an accepted transfer: old ownership ends, open transfer offers close, a commitment goes to
-- the outbox, and both accounts get a security event. Operators cannot decide cases they are a party to.

ALTER TABLE public.security_event DROP CONSTRAINT security_event_kind_check;
ALTER TABLE public.security_event ADD CONSTRAINT security_event_kind_check CHECK (kind IN ('sign_in','mfa_enabled','mfa_removed',
  'password_changed','redemption_reserved','transfer_created','transfer_accepted','recovery_requested','recovery_decided'));

CREATE TABLE public.ownership_recovery_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.product(id) ON DELETE RESTRICT,
  claimant_account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  statement text NOT NULL CHECK (length(btrim(statement)) BETWEEN 20 AND 2000),
  -- ponytail: references only ({kind, reference, sha256?}); file uploads need a private Storage bucket first.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 10),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','approved','rejected','withdrawn')),
  assignee_account_id uuid REFERENCES public.account(id) ON DELETE RESTRICT,
  decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 1 AND 1000),
  from_ownership_id uuid REFERENCES public.ownership(id) ON DELETE RESTRICT,
  to_ownership_id uuid UNIQUE REFERENCES public.ownership(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  UNIQUE (claimant_account_id, request_id),
  CHECK ((status IN ('approved','rejected')) = (decision_reason IS NOT NULL)),
  CHECK ((status IN ('approved','rejected','withdrawn')) = (closed_at IS NOT NULL)),
  CHECK ((status = 'approved') = (to_ownership_id IS NOT NULL)),
  CHECK (status IN ('open','withdrawn') OR assignee_account_id IS NOT NULL)
);
CREATE UNIQUE INDEX ownership_recovery_open ON public.ownership_recovery_case(product_id, claimant_account_id) WHERE status IN ('open','in_review');
CREATE INDEX ownership_recovery_queue ON public.ownership_recovery_case(status, created_at, id);

CREATE TABLE public.ownership_recovery_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.ownership_recovery_case(id) ON DELETE RESTRICT,
  actor_account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('opened','withdrawn','assigned','approved','rejected')),
  request_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX ownership_recovery_event_request ON public.ownership_recovery_event(actor_account_id, request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER ownership_recovery_event_immutable BEFORE UPDATE OR DELETE ON public.ownership_recovery_event
  FOR EACH ROW EXECUTE FUNCTION public.reward_case_event_immutable();

ALTER TABLE public.ownership_recovery_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_recovery_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_recovery_case, public.ownership_recovery_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ownership_recovery_case, public.ownership_recovery_event TO service_role;

-- Evidence references: at most ten {kind, reference, sha256?}; no free-form objects.
CREATE FUNCTION public.recovery_evidence_valid(p_evidence jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) = 'array' AND jsonb_array_length(p_evidence) <= 10
    -- CASE fixes the evaluation order: object functions never see a scalar element.
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE CASE WHEN jsonb_typeof(e) <> 'object' THEN true ELSE
      (SELECT count(*) FROM jsonb_object_keys(e) k WHERE k NOT IN ('kind','reference','sha256')) > 0
      OR e->>'kind' IS NULL OR e->>'kind' NOT IN ('receipt','photo','serial_label','activation_card','other')
      OR e->>'reference' IS NULL OR length(btrim(e->>'reference')) NOT BETWEEN 1 AND 240
      OR (e ? 'sha256' AND coalesce(e->>'sha256','') !~ '^[0-9a-f]{64}$') END)
$$;

CREATE FUNCTION public.open_ownership_recovery(p_request_id uuid, p_serial text, p_statement text, p_evidence jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc public.account; p public.product; prior public.ownership_recovery_case; owner_user uuid; cid uuid; clean text := btrim(p_statement);
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR p_serial IS NULL OR length(p_serial) > 120 OR clean IS NULL OR length(clean) NOT BETWEEN 20 AND 2000
    OR NOT public.recovery_evidence_valid(p_evidence) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Serial, a 20–2000 character statement and valid evidence references required.'); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','account_required','message','Create the account first.'); END IF;
  SELECT * INTO prior FROM public.ownership_recovery_case WHERE claimant_account_id = acc.id AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.product_id IS DISTINCT FROM (SELECT id FROM public.product WHERE serial_public = upper(btrim(p_serial)))
      OR prior.statement <> clean OR prior.evidence <> p_evidence THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'case_id',prior.id,'status',prior.status,'idempotent',true);
  END IF;
  SELECT * INTO p FROM public.product WHERE serial_public = upper(btrim(p_serial)) FOR UPDATE;
  IF NOT FOUND OR p.registry_status <> 'active' THEN RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Active registered product required.'); END IF;
  IF EXISTS (SELECT 1 FROM public.ownership WHERE product_id = p.id AND account_id = acc.id AND end_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','already_owner','message','You already own this product.'); END IF;
  IF EXISTS (SELECT 1 FROM public.ownership_recovery_case WHERE product_id = p.id AND claimant_account_id = acc.id AND status IN ('open','in_review')) THEN
    RETURN jsonb_build_object('ok',false,'code','case_open','message','You already have an undecided case for this product.'); END IF;
  IF (SELECT count(*) FROM public.ownership_recovery_case WHERE claimant_account_id = acc.id AND status IN ('open','in_review')) >= 3 THEN
    RETURN jsonb_build_object('ok',false,'code','rate_limited','message','At most three undecided recovery cases.'); END IF;
  INSERT INTO public.ownership_recovery_case(product_id, claimant_account_id, request_id, statement, evidence)
    VALUES (p.id, acc.id, p_request_id, clean, p_evidence) RETURNING id INTO cid;
  INSERT INTO public.ownership_recovery_event(case_id, actor_account_id, action, request_id) VALUES (cid, acc.id, 'opened', p_request_id);
  -- The current owner learns that someone asked for their product, but not who.
  SELECT a.auth_user_id INTO owner_user FROM public.ownership o JOIN public.account a ON a.id = o.account_id WHERE o.product_id = p.id AND o.end_at IS NULL;
  IF owner_user IS NOT NULL THEN
    INSERT INTO public.security_event(user_id, kind, detail) VALUES (owner_user, 'recovery_requested', p.serial_public || ' · ditinjau operator'); END IF;
  RETURN jsonb_build_object('ok',true,'case_id',cid,'status','open','idempotent',false);
END $$;

CREATE FUNCTION public.withdraw_ownership_recovery(p_case_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; c public.ownership_recovery_case;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  SELECT * INTO c FROM public.ownership_recovery_case WHERE id = p_case_id AND claimant_account_id = aid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','case_unavailable','message','Case unavailable.'); END IF;
  IF c.status = 'withdrawn' THEN RETURN jsonb_build_object('ok',true,'case_id',c.id,'status','withdrawn','idempotent',true); END IF;
  IF c.status <> 'open' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only an open case can be withdrawn.'); END IF;
  UPDATE public.ownership_recovery_case SET status = 'withdrawn', closed_at = clock_timestamp() WHERE id = c.id;
  INSERT INTO public.ownership_recovery_event(case_id, actor_account_id, action) VALUES (c.id, aid, 'withdrawn');
  RETURN jsonb_build_object('ok',true,'case_id',c.id,'status','withdrawn','idempotent',false);
END $$;

CREATE FUNCTION public.my_ownership_recoveries() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'serial_public',p.serial_public,'statement',c.statement,'evidence',c.evidence,
      'status',c.status,'decision_reason',c.decision_reason,'created_at',c.created_at,'closed_at',c.closed_at) ORDER BY c.created_at DESC, c.id), '[]'::jsonb)
    INTO rows FROM (SELECT * FROM public.ownership_recovery_case WHERE claimant_account_id = aid ORDER BY created_at DESC, id LIMIT 20) c
    JOIN public.product p ON p.id = c.product_id;
  RETURN jsonb_build_object('ok',true,'cases',rows);
END $$;

-- Operator queue with the facts that decide most cases: did the claimant activate or own this product before,
-- how long the current owner has held it, and whether the current owner protects the account with 2FA.
CREATE FUNCTION public.operator_recovery_cases(p_status text DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE rows jsonb; last jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT public.privileged_role_active('operator') THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Verified operator session required.'); END IF;
  IF (p_status IS NOT NULL AND p_status NOT IN ('open','in_review','approved','rejected','withdrawn')) OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Valid status and page bounds required.'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'created_at')::timestamptz, x->>'id'), '[]'::jsonb) INTO rows FROM (
    SELECT jsonb_build_object('id',c.id,'serial_public',p.serial_public,'registry_status',p.registry_status,'claimant_account_id',c.claimant_account_id,
      'statement',c.statement,'evidence',c.evidence,'status',c.status,'assignee_account_id',c.assignee_account_id,'decision_reason',c.decision_reason,
      'created_at',c.created_at,'closed_at',c.closed_at,
      'claimant_activated', EXISTS (SELECT 1 FROM public.activation WHERE product_id = p.id AND consumed_by = c.claimant_account_id),
      'claimant_past_owner', EXISTS (SELECT 1 FROM public.ownership WHERE product_id = p.id AND account_id = c.claimant_account_id AND end_at IS NOT NULL),
      'owner_account_id', o.account_id, 'owner_since', o.start_at,
      'owner_has_2fa', EXISTS (SELECT 1 FROM public.account a JOIN auth.mfa_factors f ON f.user_id = a.auth_user_id WHERE a.id = o.account_id AND f.status = 'verified'),
      'open_cases_for_product', (SELECT count(*) FROM public.ownership_recovery_case z WHERE z.product_id = p.id AND z.status IN ('open','in_review'))) AS x
    FROM public.ownership_recovery_case c JOIN public.product p ON p.id = c.product_id
    LEFT JOIN public.ownership o ON o.product_id = p.id AND o.end_at IS NULL
    WHERE (p_status IS NULL OR c.status = p_status) AND (p_before IS NULL OR (c.created_at, c.id) > (p_before, p_before_id))
    ORDER BY c.created_at, c.id LIMIT p_limit) q;
  last := rows -> (jsonb_array_length(rows) - 1);
  RETURN jsonb_build_object('ok',true,'cases',rows,'next_cursor',
    CASE WHEN jsonb_array_length(rows) = p_limit THEN jsonb_build_object('created_at',last->'created_at','id',last->'id') END);
END $$;

CREATE FUNCTION public.operator_take_recovery_case(p_case_id uuid, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE refusal jsonb; actor uuid; c public.ownership_recovery_case; prior public.ownership_recovery_event;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  refusal := public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF p_case_id IS NULL OR p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Case and request id required.'); END IF;
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid();
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.recovery.v1:' || actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO prior FROM public.ownership_recovery_event WHERE actor_account_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.case_id <> p_case_id OR prior.action <> 'assigned' THEN RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'case_id',p_case_id,'status','in_review','idempotent',true);
  END IF;
  SELECT * INTO c FROM public.ownership_recovery_case WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','case_unavailable','message','Case unavailable.'); END IF;
  IF c.claimant_account_id = actor OR EXISTS (SELECT 1 FROM public.ownership WHERE product_id = c.product_id AND account_id = actor AND end_at IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','self_review','message','Operators cannot review cases they are a party to.'); END IF;
  IF c.status <> 'open' THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only an open case can be taken.'); END IF;
  UPDATE public.ownership_recovery_case SET status = 'in_review', assignee_account_id = actor WHERE id = c.id;
  INSERT INTO public.ownership_recovery_event(case_id, actor_account_id, action, request_id) VALUES (c.id, actor, 'assigned', p_request_id);
  RETURN jsonb_build_object('ok',true,'case_id',c.id,'status','in_review','idempotent',false);
END $$;

CREATE FUNCTION public.operator_decide_recovery_case(p_case_id uuid, p_request_id uuid, p_decision text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE refusal jsonb; actor uuid; c public.ownership_recovery_case; prior public.ownership_recovery_event; p public.product;
  old public.ownership; nid uuid; ts timestamptz := clock_timestamp(); clean text := btrim(p_reason); body jsonb; preimage text; artifact text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  refusal := public.privileged_write_gate('operator'); IF refusal IS NOT NULL THEN RETURN refusal; END IF;
  IF p_case_id IS NULL OR p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR clean IS NULL OR length(clean) NOT BETWEEN 1 AND 1000 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Decision and reason required.'); END IF;
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid();
  body := jsonb_build_object('decision',p_decision,'reason',clean);
  PERFORM pg_advisory_xact_lock(hashtextextended('smart-agro.recovery.v1:' || actor::text || ':' || p_request_id::text, 0));
  SELECT * INTO prior FROM public.ownership_recovery_event WHERE actor_account_id = actor AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.case_id <> p_case_id OR prior.action <> p_decision OR prior.payload <> body THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    SELECT * INTO c FROM public.ownership_recovery_case WHERE id = p_case_id;
    RETURN jsonb_build_object('ok',true,'case_id',c.id,'status',c.status,'ownership_id',c.to_ownership_id,'idempotent',true);
  END IF;
  -- Lock order as activation and transfer: product first, then rows hanging off it.
  SELECT pr.* INTO p FROM public.product pr JOIN public.ownership_recovery_case z ON z.product_id = pr.id WHERE z.id = p_case_id FOR UPDATE OF pr;
  SELECT * INTO c FROM public.ownership_recovery_case WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','case_unavailable','message','Case unavailable.'); END IF;
  IF c.status <> 'in_review' OR c.assignee_account_id IS DISTINCT FROM actor THEN
    RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Take the case before deciding it.'); END IF;
  IF p_decision = 'approved' THEN
    IF p.registry_status <> 'active' THEN RETURN jsonb_build_object('ok',false,'code','product_unavailable','message','Product is no longer active.'); END IF;
    SELECT * INTO old FROM public.ownership WHERE product_id = p.id AND end_at IS NULL FOR UPDATE;
    IF old.account_id = c.claimant_account_id THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Claimant already owns the product.'); END IF;
    IF old.account_id = actor THEN RETURN jsonb_build_object('ok',false,'code','self_review','message','Operators cannot review cases they are a party to.'); END IF;
    IF old.id IS NOT NULL THEN UPDATE public.ownership SET end_at = ts WHERE id = old.id; END IF;
    UPDATE public.ownership_transfer SET status = 'cancelled', closed_at = ts WHERE product_id = p.id AND status = 'open';
    INSERT INTO public.ownership(product_id, account_id, start_at) VALUES (p.id, c.claimant_account_id, ts) RETURNING id INTO nid;
    preimage := jsonb_build_object('schema','smart-agro.recovery-preimage.v1','product_id',p.id,'from_ownership_id',old.id,
      'to_ownership_id',nid,'at',ts,'salt',encode(gen_random_bytes(32),'hex'))::text;
    artifact := jsonb_build_object('schema','smart-agro.transfer-commitment.v1','commitment',encode(digest(preimage,'sha256'),'hex'))::text;
    INSERT INTO public.outbox_job(event_key, kind, artifact_bytes, artifact_sha256, private_payload, chain_id, contract_address)
      VALUES ('recovery:' || c.id::text, 'ownership_transfer', artifact, encode(digest(artifact,'sha256'),'hex'), preimage, 'unconfigured', 'unconfigured');
  END IF;
  UPDATE public.ownership_recovery_case SET status = p_decision, decision_reason = clean, closed_at = ts,
    from_ownership_id = old.id, to_ownership_id = nid WHERE id = c.id;
  INSERT INTO public.ownership_recovery_event(case_id, actor_account_id, action, request_id, payload) VALUES (c.id, actor, p_decision, p_request_id, body);
  INSERT INTO public.security_event(user_id, kind, detail)
    SELECT a.auth_user_id, 'recovery_decided', p.serial_public || CASE
      WHEN a.id = c.claimant_account_id THEN CASE WHEN p_decision = 'approved' THEN ' · pemulihan disetujui' ELSE ' · pemulihan ditolak' END
      ELSE ' · kepemilikan dipindahkan oleh operator' END
    FROM public.account a WHERE a.id = c.claimant_account_id OR (p_decision = 'approved' AND a.id = old.account_id);
  RETURN jsonb_build_object('ok',true,'case_id',c.id,'status',p_decision,'ownership_id',nid,'idempotent',false);
END $$;

REVOKE ALL ON FUNCTION public.recovery_evidence_valid(jsonb), public.open_ownership_recovery(uuid,text,text,jsonb),
  public.withdraw_ownership_recovery(uuid), public.my_ownership_recoveries(),
  public.operator_recovery_cases(text,timestamptz,uuid,integer), public.operator_take_recovery_case(uuid,uuid),
  public.operator_decide_recovery_case(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_ownership_recovery(uuid,text,text,jsonb), public.withdraw_ownership_recovery(uuid),
  public.my_ownership_recoveries(), public.operator_recovery_cases(text,timestamptz,uuid,integer),
  public.operator_take_recovery_case(uuid,uuid), public.operator_decide_recovery_case(uuid,uuid,text,text) TO authenticated;
