-- Parity with redemptions: a transfer offer waits out the 24-hour hold after a password or 2FA change,
-- so an intruder cannot change the keys and move the pot in one sitting. 2FA itself stays optional for
-- transfers (re-authentication covers accounts without it), unlike value_action_gate.
CREATE OR REPLACE FUNCTION public.create_transfer_offer(p_product_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE p public.product; own public.ownership; code text := upper(encode(gen_random_bytes(16),'hex'));
  tid uuid; expires timestamptz := clock_timestamp() + interval '24 hours'; hold timestamptz;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Authentication required.'); END IF;
  -- Re-authentication: a sign-in within the last ten minutes, or an authenticator code from the last five
  -- (Google accounts have no password to re-enter; same freshness rule as value_action_gate).
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE id = (auth.jwt()->>'session_id')::uuid AND created_at > clock_timestamp() - interval '10 minutes')
     AND NOT (auth.jwt()->>'aal' = 'aal2' AND EXISTS (SELECT 1 FROM jsonb_array_elements(auth.jwt()->'amr') m
       WHERE m->>'method' = 'totp' AND (m->>'timestamp')::numeric >= extract(epoch FROM now()) - 300)) THEN
    RETURN jsonb_build_object('ok',false,'code','reauth_required','message','Sign in again to confirm the transfer.'); END IF;
  hold := public.security_hold_until();
  IF hold IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','security_hold','message','Paused for 24 hours after a security change.','until',hold); END IF;
  SELECT * INTO p FROM public.product WHERE id = p_product_id FOR UPDATE;
  SELECT o.* INTO own FROM public.ownership o JOIN public.account a ON a.id = o.account_id
    WHERE o.product_id = p_product_id AND o.end_at IS NULL AND a.auth_user_id = auth.uid() FOR UPDATE OF o;
  IF own.id IS NULL OR p.registry_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok',false,'code','not_owner','message','Active ownership of an active product required.'); END IF;
  UPDATE public.ownership_transfer SET status = 'cancelled', closed_at = clock_timestamp() WHERE product_id = p.id AND status = 'open';
  INSERT INTO public.ownership_transfer(product_id,from_ownership_id,code_hash,expires_at)
    VALUES (p.id, own.id, encode(digest(code,'sha256'),'hex'), expires) RETURNING id INTO tid;
  INSERT INTO public.security_event(user_id,kind,detail) VALUES (auth.uid(),'transfer_created',p.serial_public);
  RETURN jsonb_build_object('ok',true,'transfer_id',tid,'code',code,'expires_at',expires);
END $$;
