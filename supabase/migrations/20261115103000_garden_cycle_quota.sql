-- Fase 6 follow-up (found by the automated review of 20261115100000): plant numbers are one shared supply per species, so a
-- script that opens cycles on many accounts could use them all up, and the last caller would get a raw constraint error. Each
-- account now has a limit on the plants it can open in total and in a day, and a species whose numbers have run out refuses
-- politely instead of failing. The numbers themselves stay global: the plant code is one integer for the whole service.

-- NULL means "go ahead"; anything else is the reason to refuse. Not callable by users.
CREATE FUNCTION public.cycle_quota_message(p_account_id uuid, p_species_id integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF (SELECT count(*) FROM public.plant_cycle WHERE account_id = p_account_id) >= 300 THEN RETURN 'At most 300 plants per account.'; END IF;
  IF (SELECT count(*) FROM public.plant_cycle WHERE account_id = p_account_id AND created_at > clock_timestamp() - interval '24 hours') >= 30 THEN
    RETURN 'At most 30 new plants a day.'; END IF;
  IF coalesce((SELECT next_no FROM public.plant_counter WHERE species_id = p_species_id), 2) >= 1000000 THEN RETURN 'This species has no plant numbers left.'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cycle_quota_message(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.plant_in_my_slot(p_request_id uuid, p_slot_id uuid, p_species_id integer, p_planted_on date, p_nickname text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; slot public.garden_slot; prior public.plant_cycle; made public.plant_cycle; quota text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR p_slot_id IS NULL OR p_planted_on IS NULL OR p_planted_on > current_date + 1 OR p_planted_on < current_date - 400
     OR NOT EXISTS (SELECT 1 FROM public.plant_species WHERE species_id = p_species_id) OR length(btrim(coalesce(p_nickname,''))) > 60 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A request id, a slot, a known species, a recent date and a short name are required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO prior FROM public.plant_cycle WHERE account_id = aid AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.slot_id <> p_slot_id OR prior.species_id <> p_species_id OR prior.planted_on <> p_planted_on THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(prior),'idempotent',true);
  END IF;
  SELECT * INTO slot FROM public.garden_slot WHERE id = p_slot_id AND account_id = aid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','slot_unavailable','message','Own slot required.'); END IF;
  IF EXISTS (SELECT 1 FROM public.plant_cycle WHERE slot_id = slot.id AND ended_on IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Something is already growing here; replace it instead.'); END IF;
  IF (SELECT count(*) FROM public.plant_cycle WHERE slot_id = slot.id) >= 100 THEN
    RETURN jsonb_build_object('ok',false,'code','limit_reached','message','The history of this slot is full.'); END IF;
  quota := public.cycle_quota_message(aid, p_species_id);
  IF quota IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','limit_reached','message',quota); END IF;
  made := public.open_plant_cycle(aid, p_request_id, slot.id, p_species_id, p_planted_on, p_nickname);
  RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(made),'idempotent',false);
END $$;

CREATE OR REPLACE FUNCTION public.switch_my_plant(p_request_id uuid, p_slot_id uuid, p_species_id integer, p_on date, p_outcome text, p_nickname text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; slot public.garden_slot; active public.plant_cycle; prior public.plant_cycle; made public.plant_cycle; closed public.plant_cycle; quota text;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR p_slot_id IS NULL OR p_on IS NULL OR p_on > current_date + 1 OR p_on < current_date - 400 OR p_outcome IS NULL OR p_outcome NOT IN ('berhasil','gagal','dihentikan')
     OR NOT EXISTS (SELECT 1 FROM public.plant_species WHERE species_id = p_species_id) OR length(btrim(coalesce(p_nickname,''))) > 60 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A request id, a slot, a known species, a recent date, an outcome and a short name are required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO prior FROM public.plant_cycle WHERE account_id = aid AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.slot_id <> p_slot_id OR prior.species_id <> p_species_id OR prior.planted_on <> p_on THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(prior),'idempotent',true);
  END IF;
  SELECT * INTO slot FROM public.garden_slot WHERE id = p_slot_id AND account_id = aid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','slot_unavailable','message','Own slot required.'); END IF;
  SELECT * INTO active FROM public.plant_cycle WHERE slot_id = slot.id AND ended_on IS NULL;
  IF FOUND THEN
    IF active.species_id = p_species_id AND active.planted_on = p_on THEN
      RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(active),'unchanged',true,'idempotent',false); END IF;
    IF p_on < active.planted_on THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Replacing cannot come before planting.'); END IF;
  END IF;
  IF (SELECT count(*) FROM public.plant_cycle WHERE slot_id = slot.id) >= 100 THEN
    RETURN jsonb_build_object('ok',false,'code','limit_reached','message','The history of this slot is full.'); END IF;
  -- Before the old cycle is closed: a refused replacement must leave everything as it was.
  quota := public.cycle_quota_message(aid, p_species_id);
  IF quota IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','limit_reached','message',quota); END IF;
  IF active.id IS NOT NULL THEN UPDATE public.plant_cycle SET ended_on = p_on, outcome = p_outcome WHERE id = active.id RETURNING * INTO closed; END IF;
  made := public.open_plant_cycle(aid, p_request_id, slot.id, p_species_id, p_on, p_nickname);
  RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(made),'closed',CASE WHEN closed.id IS NULL THEN NULL ELSE public.cycle_json(closed) END,'idempotent',false);
END $$;
