-- A08 (bukti blockchain): outbox jobs written in the same transaction as activation, transfer, recovery and
-- provisioning now move through a worker. A worker leases jobs (two minutes, SKIP LOCKED), binds an unconfigured job to
-- its network and contract on first claim, records the sent transaction, then records the receipt. A successful receipt
-- is confirmed only when chain, destination and the artifact hash in the calldata all match; otherwise the job is held
-- as a mismatch and never reported as verified. A job that already has a transaction is checked before any resend.
-- All worker functions are service-role only; owners and operators get read views.

ALTER TABLE public.outbox_job DROP CONSTRAINT outbox_job_status_check;
ALTER TABLE public.outbox_job ADD CONSTRAINT outbox_job_status_check CHECK (status IN ('pending','sent','confirmed','failed','mismatch'));
ALTER TABLE public.outbox_job ADD COLUMN lease_until timestamptz;
ALTER TABLE public.outbox_job ADD COLUMN worker text CHECK (worker IS NULL OR worker ~ '^[A-Za-z0-9._-]{1,64}$');
ALTER TABLE public.outbox_job ADD COLUMN sent_at timestamptz;
ALTER TABLE public.outbox_job ADD COLUMN confirmed_at timestamptz;
ALTER TABLE public.outbox_job ADD COLUMN receipt jsonb;
-- The authorised signer (A08 "penerbit"): bound with chain and contract on first claim, checked against tx.from.
ALTER TABLE public.outbox_job ADD COLUMN signer text CHECK (signer IS NULL OR signer ~ '^0x[0-9a-f]{40}$');
ALTER TABLE public.outbox_job ADD CONSTRAINT outbox_job_sent_has_tx CHECK (status NOT IN ('sent','confirmed','mismatch') OR tx_hash IS NOT NULL);
ALTER TABLE public.outbox_job ADD CONSTRAINT outbox_job_tx_format CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$');
CREATE INDEX outbox_job_work ON public.outbox_job(status, lease_until, updated_at) WHERE status IN ('pending','sent');

CREATE FUNCTION public.worker_claim_outbox(p_worker text, p_chain_id text, p_contract text, p_signer text, p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE rows jsonb;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9._-]{1,64}$' OR p_chain_id IS NULL OR p_chain_id !~ '^[0-9]{1,20}$'
    OR p_contract IS NULL OR p_contract !~ '^0x[0-9a-f]{40}$' OR p_signer IS NULL OR p_signer !~ '^0x[0-9a-f]{40}$'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Worker, decimal chain id, lowercase contract and signer, and limit required.'); END IF;
  WITH picked AS (
    SELECT id FROM public.outbox_job
    WHERE status IN ('pending','sent') AND (lease_until IS NULL OR lease_until < clock_timestamp())
      AND (chain_id = 'unconfigured' OR (chain_id = p_chain_id AND contract_address = p_contract AND signer = p_signer))
    ORDER BY updated_at, id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.outbox_job j SET lease_until = clock_timestamp() + interval '2 minutes', worker = p_worker,
      chain_id = CASE WHEN j.chain_id = 'unconfigured' THEN p_chain_id ELSE j.chain_id END,
      contract_address = CASE WHEN j.contract_address = 'unconfigured' THEN p_contract ELSE j.contract_address END,
      signer = coalesce(j.signer, p_signer),
      attempts = j.attempts + CASE WHEN j.status = 'pending' THEN 1 ELSE 0 END, updated_at = clock_timestamp()
    FROM picked WHERE j.id = picked.id
    RETURNING j.id, j.event_key, j.kind, j.artifact_sha256, j.status, j.tx_hash, j.attempts
  )
  SELECT coalesce(jsonb_agg(to_jsonb(leased) ORDER BY leased.id), '[]'::jsonb) INTO rows FROM leased;
  RETURN jsonb_build_object('ok',true,'jobs',rows);
END $$;

-- The leased job's transaction hash; idempotent for the same hash, refused for a different one.
CREATE FUNCTION public.worker_mark_sent(p_job_id uuid, p_worker text, p_tx_hash text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE j public.outbox_job;
BEGIN
  SELECT * INTO j FROM public.outbox_job WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR p_tx_hash IS NULL OR p_tx_hash !~ '^0x[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Job and lowercase transaction hash required.'); END IF;
  IF j.tx_hash = p_tx_hash THEN RETURN jsonb_build_object('ok',true,'status',j.status,'idempotent',true); END IF;
  IF j.worker IS DISTINCT FROM p_worker OR j.lease_until IS NULL OR j.lease_until < clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','lease_lost','message','Job is not leased by this worker.'); END IF;
  IF j.status <> 'pending' OR j.tx_hash IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Job already has a transaction.'); END IF;
  UPDATE public.outbox_job SET status = 'sent', tx_hash = p_tx_hash, sent_at = clock_timestamp(), last_error = NULL, updated_at = clock_timestamp() WHERE id = j.id;
  RETURN jsonb_build_object('ok',true,'status','sent','idempotent',false);
END $$;

-- Records what the chain says about the job's transaction. 'pending' releases the lease for a later check.
CREATE FUNCTION public.worker_record_receipt(p_job_id uuid, p_worker text, p_outcome text, p_chain_id text, p_from text, p_to text, p_data text, p_block_number bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE j public.outbox_job; matched boolean; observed jsonb;
BEGIN
  SELECT * INTO j FROM public.outbox_job WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN ('pending','success','reverted') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Job and outcome required.'); END IF;
  IF j.status IN ('confirmed','mismatch','failed') THEN RETURN jsonb_build_object('ok',true,'status',j.status,'idempotent',true); END IF;
  IF j.status <> 'sent' OR j.worker IS DISTINCT FROM p_worker OR j.lease_until IS NULL OR j.lease_until < clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','lease_lost','message','Job is not a sent job leased by this worker.'); END IF;
  IF p_outcome = 'pending' THEN
    UPDATE public.outbox_job SET lease_until = NULL, updated_at = clock_timestamp() WHERE id = j.id;
    RETURN jsonb_build_object('ok',true,'status','sent');
  END IF;
  observed := jsonb_build_object('outcome',p_outcome,'chain_id',p_chain_id,'from',lower(p_from),'to',lower(p_to),'data',lower(p_data),'block_number',p_block_number,'at',clock_timestamp());
  IF p_outcome = 'reverted' THEN
    UPDATE public.outbox_job SET status = 'failed', receipt = observed, block_number = p_block_number, lease_until = NULL,
      last_error = 'Transaction reverted', updated_at = clock_timestamp() WHERE id = j.id;
    RETURN jsonb_build_object('ok',true,'status','failed');
  END IF;
  matched := p_chain_id IS NOT DISTINCT FROM j.chain_id AND lower(p_from) IS NOT DISTINCT FROM j.signer AND lower(p_to) IS NOT DISTINCT FROM lower(j.contract_address)
    AND lower(p_data) IS NOT DISTINCT FROM '0x' || j.artifact_sha256 AND p_block_number IS NOT NULL AND p_block_number >= 0;
  UPDATE public.outbox_job SET status = CASE WHEN matched THEN 'confirmed' ELSE 'mismatch' END, receipt = observed,
    block_number = p_block_number, confirmed_at = CASE WHEN matched THEN clock_timestamp() END, lease_until = NULL,
    last_error = CASE WHEN matched THEN NULL ELSE 'Receipt does not match chain, signer, destination or artifact hash' END,
    updated_at = clock_timestamp() WHERE id = j.id;
  RETURN jsonb_build_object('ok',true,'status',CASE WHEN matched THEN 'confirmed' ELSE 'mismatch' END);
END $$;

-- A send that failed before any transaction existed: retry later, or give up after five attempts.
CREATE FUNCTION public.worker_fail(p_job_id uuid, p_worker text, p_error text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE j public.outbox_job;
BEGIN
  SELECT * INTO j FROM public.outbox_job WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR j.worker IS DISTINCT FROM p_worker OR j.status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'code','lease_lost','message','Job is not a pending job leased by this worker.'); END IF;
  UPDATE public.outbox_job SET status = CASE WHEN j.attempts >= 5 THEN 'failed' ELSE 'pending' END, lease_until = NULL,
    last_error = left(coalesce(p_error,'Unknown error'), 500), updated_at = clock_timestamp() WHERE id = j.id;
  RETURN jsonb_build_object('ok',true,'status',CASE WHEN j.attempts >= 5 THEN 'failed' ELSE 'pending' END);
END $$;

-- Owner view: proofs of the caller's own ownership changes (activation, transfer in or out, recovery).
CREATE FUNCTION public.my_chain_proofs() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  SELECT coalesce(jsonb_agg(jsonb_build_object('event_key',j.event_key,'kind',j.kind,'serial_public',x.serial_public,'status',j.status,
      'artifact_sha256',j.artifact_sha256,'chain_id',nullif(j.chain_id,'unconfigured'),'tx_hash',j.tx_hash,'block_number',j.block_number,
      'confirmed_at',j.confirmed_at,'created_at',x.at) ORDER BY x.at DESC), '[]'::jsonb) INTO rows
  FROM (
    SELECT 'claim:' || o.id::text AS key, p.serial_public, o.start_at AS at FROM public.ownership o JOIN public.product p ON p.id = o.product_id WHERE o.account_id = aid
    UNION ALL
    SELECT 'transfer:' || t.id::text, p.serial_public, t.closed_at FROM public.ownership_transfer t JOIN public.product p ON p.id = t.product_id
      JOIN public.ownership f ON f.id = t.from_ownership_id LEFT JOIN public.ownership n ON n.id = t.to_ownership_id
      WHERE t.status = 'accepted' AND (f.account_id = aid OR n.account_id = aid)
    UNION ALL
    SELECT 'recovery:' || c.id::text, p.serial_public, c.closed_at FROM public.ownership_recovery_case c JOIN public.product p ON p.id = c.product_id
      LEFT JOIN public.ownership f ON f.id = c.from_ownership_id
      WHERE c.status = 'approved' AND (c.claimant_account_id = aid OR f.account_id = aid)
  ) x JOIN public.outbox_job j ON j.event_key = x.key;
  RETURN jsonb_build_object('ok',true,'proofs',rows);
END $$;

-- Operator view: counts per status and the latest problems, for watching the pipeline.
CREATE FUNCTION public.operator_outbox_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT public.privileged_role_active('operator') THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Verified operator session required.'); END IF;
  RETURN jsonb_build_object('ok',true,
    'counts',(SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) AS n FROM public.outbox_job GROUP BY status) s),
    'problems',(SELECT coalesce(jsonb_agg(jsonb_build_object('event_key',event_key,'kind',kind,'status',status,'attempts',attempts,
        'last_error',last_error,'tx_hash',tx_hash,'updated_at',updated_at) ORDER BY updated_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.outbox_job WHERE status IN ('failed','mismatch') OR (status = 'pending' AND attempts > 0) ORDER BY updated_at DESC LIMIT 20) p));
END $$;

REVOKE ALL ON FUNCTION public.worker_claim_outbox(text,text,text,text,integer), public.worker_mark_sent(uuid,text,text),
  public.worker_record_receipt(uuid,text,text,text,text,text,text,bigint), public.worker_fail(uuid,text,text),
  public.my_chain_proofs(), public.operator_outbox_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_claim_outbox(text,text,text,text,integer), public.worker_mark_sent(uuid,text,text),
  public.worker_record_receipt(uuid,text,text,text,text,text,text,bigint), public.worker_fail(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_chain_proofs(), public.operator_outbox_status() TO authenticated;
