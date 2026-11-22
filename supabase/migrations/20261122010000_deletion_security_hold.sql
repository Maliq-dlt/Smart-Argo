-- Asking to delete the account releases its products and signs its owner out everywhere, so it waits out the same
-- 24-hour hold as an ownership transfer after a password or second-factor change: someone who just took the account
-- over (new password, own authenticator) must not be able to cut the owner off and free the products at once.
-- (Finding of the automated security review of 20261122000000.)
CREATE OR REPLACE FUNCTION public.request_account_deletion() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE acc public.account; d public.account_deletion; ts timestamptz := clock_timestamp(); rel uuid[]; hold timestamptz;
BEGIN
  IF NOT public.signed_in_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  IF NOT public.recently_verified() THEN
    RETURN jsonb_build_object('ok',false,'code','reauth_required','message','Sign in again to confirm deleting the account.'); END IF;
  hold := public.security_hold_until();
  IF hold IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','security_hold','message','Paused for 24 hours after a security change.','until',hold); END IF;
  SELECT * INTO acc FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','account_required','message','Create the account first.'); END IF;
  SELECT * INTO d FROM public.account_deletion WHERE account_id = acc.id AND cancelled_at IS NULL AND purged_at IS NULL;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'deletion',public.deletion_json(d)); END IF;
  -- Lock order as elsewhere: products first, then what hangs off them.
  PERFORM 1 FROM public.product p JOIN public.ownership o ON o.product_id = p.id WHERE o.account_id = acc.id AND o.end_at IS NULL FOR UPDATE OF p;
  UPDATE public.ownership_transfer SET status = 'cancelled', closed_at = ts WHERE status = 'open'
    AND from_ownership_id IN (SELECT id FROM public.ownership WHERE account_id = acc.id AND end_at IS NULL);
  WITH ended AS (UPDATE public.ownership SET end_at = ts WHERE account_id = acc.id AND end_at IS NULL RETURNING product_id)
    SELECT coalesce(array_agg(product_id), '{}') INTO rel FROM ended;
  INSERT INTO public.account_deletion(account_id, requested_at, purge_after, released) VALUES (acc.id, ts, ts + interval '14 days', rel)
    ON CONFLICT (account_id) DO UPDATE SET requested_at = EXCLUDED.requested_at, purge_after = EXCLUDED.purge_after,
      released = EXCLUDED.released, cancelled_at = NULL
    RETURNING * INTO d;
  INSERT INTO public.security_event(user_id, kind, detail) VALUES (auth.uid(), 'deletion_requested',
    left(coalesce((SELECT string_agg(serial_public, ', ' ORDER BY serial_public) FROM public.product WHERE id = ANY(rel)), ''), 200));
  -- Signed out everywhere: refresh tokens go with their sessions, and current_auth_session() refuses the access tokens.
  DELETE FROM auth.sessions WHERE user_id = auth.uid();
  RETURN jsonb_build_object('ok',true,'idempotent',false,'deletion',public.deletion_json(d));
END $$;
