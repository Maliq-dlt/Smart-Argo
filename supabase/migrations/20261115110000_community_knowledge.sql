-- Fase 7 (inactive until live mode and the hosted release): what many people's finished plants say about one kind of plant.
-- Nothing is shared unless the owner of a slot turns sharing on for it, and then only after a plant in it has grown well for
-- long enough, and only three numbers about it: how often it was watered and the moisture band it was kept in. Who shared it is
-- kept (to count different owners and to withdraw a share) but is never returned to anybody; the place is reduced to a coarse
-- climate zone. What others may read is an aggregate, and only when enough different owners and plants stand behind it. It is
-- labelled "belum dikurasi": nobody has checked it yet, and it is not a recommendation.

-- The rules in one place, so the functions and the tests agree. min_cycle_days is how long a plant grew (the dates the owner
-- gave); min_age_days is how long the server has known the plant (the owner cannot backdate that), so a new account cannot
-- invent a long history on the first day.
CREATE FUNCTION public.community_rules(OUT min_cycle_days integer, OUT min_age_days integer, OUT min_cycles integer, OUT min_owners integer, OUT owner_cap integer)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$ SELECT 30, 30, 5, 3, 2 $$;

-- A coarse zone from the band of latitude, and an indoor site is its own zone: the exact place is not kept.
CREATE FUNCTION public.climate_zone(p_placement text, p_latitude numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_placement = 'indoor' THEN 'dalam_ruangan' WHEN p_latitude IS NULL THEN 'tanpa_lokasi'
              WHEN abs(p_latitude) <= 23.5 THEN 'tropis' WHEN abs(p_latitude) <= 35 THEN 'subtropis' WHEN abs(p_latitude) <= 60 THEN 'sedang' ELSE 'dingin' END $$;

-- The owner's standing choice for a slot. Off unless they turn it on.
ALTER TABLE public.garden_slot ADD COLUMN community_share boolean NOT NULL DEFAULT false;

CREATE TABLE public.community_contribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL REFERENCES public.garden_slot(id) ON DELETE RESTRICT,
  cycle_id uuid NOT NULL UNIQUE REFERENCES public.plant_cycle(id) ON DELETE RESTRICT,
  request_id uuid,
  species_id integer NOT NULL REFERENCES public.plant_species(species_id) ON DELETE RESTRICT,
  zone text NOT NULL CHECK (zone IN ('dalam_ruangan','tanpa_lokasi','tropis','subtropis','sedang','dingin')),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 800),
  watering_interval_days numeric(4,1) NOT NULL CHECK (watering_interval_days BETWEEN 0.5 AND 60),
  moisture_low smallint NOT NULL CHECK (moisture_low BETWEEN 0 AND 100),
  moisture_high smallint NOT NULL CHECK (moisture_high BETWEEN 0 AND 100),
  shared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  excluded_at timestamptz,
  excluded_by uuid REFERENCES public.account(id) ON DELETE RESTRICT,
  excluded_reason text CHECK (excluded_reason IS NULL OR length(btrim(excluded_reason)) BETWEEN 1 AND 500),
  CHECK (moisture_low < moisture_high),
  CHECK ((excluded_at IS NULL) = (excluded_by IS NULL) AND (excluded_at IS NULL) = (excluded_reason IS NULL))
);
CREATE UNIQUE INDEX community_contribution_request ON public.community_contribution(account_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX community_contribution_kind ON public.community_contribution(species_id, zone) WHERE excluded_at IS NULL;
CREATE INDEX community_contribution_slot ON public.community_contribution(slot_id);

ALTER TABLE public.community_contribution ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_contribution FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_contribution TO service_role;

-- Owner: the garden, now with each slot's sharing choice and whether a finished plant has been shared.
CREATE OR REPLACE FUNCTION public.my_garden() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  RETURN jsonb_build_object('ok',true,
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'placement',s.placement,'latitude',s.latitude,'longitude',s.longitude) ORDER BY s.created_at, s.id) FROM public.garden_site s WHERE s.account_id = aid), '[]'::jsonb),
    'slots', coalesce((SELECT jsonb_agg(jsonb_build_object('id',z.id,'site_id',z.site_id,'name',z.name,'unit_id',z.unit_id,'share',z.community_share) ORDER BY z.created_at, z.id) FROM public.garden_slot z WHERE z.account_id = aid), '[]'::jsonb),
    'cycles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'slot_id',c.slot_id,'species_id',c.species_id,'plant_no',c.plant_no,'code',c.code,'nickname',c.nickname,'planted_on',c.planted_on,'ended_on',c.ended_on,'outcome',c.outcome,
      'shared',EXISTS (SELECT 1 FROM public.community_contribution x WHERE x.cycle_id = c.id)) ORDER BY c.planted_on, c.created_at, c.id) FROM public.plant_cycle c WHERE c.account_id = aid), '[]'::jsonb));
END $$;

-- Owner: turn sharing on or off for one slot. Turning it off takes back everything already shared from it.
CREATE FUNCTION public.set_slot_sharing(p_slot_id uuid, p_share boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; slot public.garden_slot; gone integer := 0;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_slot_id IS NULL OR p_share IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A slot and a choice are required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO slot FROM public.garden_slot WHERE id = p_slot_id AND account_id = aid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','slot_unavailable','message','Own slot required.'); END IF;
  UPDATE public.garden_slot SET community_share = p_share WHERE id = slot.id;
  IF NOT p_share THEN DELETE FROM public.community_contribution WHERE slot_id = slot.id; GET DIAGNOSTICS gone = ROW_COUNT; END IF;
  RETURN jsonb_build_object('ok',true,'slot_id',slot.id,'share',p_share,'withdrawn',gone);
END $$;

-- Owner: share one finished plant. It must have grown well, for long enough (by the dates given and by the server's own clock),
-- in a slot whose sharing is on, and it can be shared once. A retry with the same request id returns the first answer.
CREATE FUNCTION public.share_my_cycle(p_request_id uuid, p_cycle_id uuid, p_watering_interval_days numeric, p_moisture_low numeric, p_moisture_high numeric) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; rules record; cyc public.plant_cycle; slot public.garden_slot; site public.garden_site; prior public.community_contribution; made public.community_contribution; days integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR p_cycle_id IS NULL OR p_watering_interval_days IS NULL OR p_watering_interval_days NOT BETWEEN 0.5 AND 60
     OR p_moisture_low IS NULL OR p_moisture_high IS NULL OR p_moisture_low NOT BETWEEN 0 AND 100 OR p_moisture_high NOT BETWEEN 0 AND 100 OR p_moisture_low >= p_moisture_high THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A request id, a plant, a watering interval of 0.5 to 60 days and a moisture band inside 0 to 100 are required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO prior FROM public.community_contribution WHERE account_id = aid AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.cycle_id <> p_cycle_id OR prior.watering_interval_days <> round(p_watering_interval_days, 1) OR prior.moisture_low <> round(p_moisture_low) OR prior.moisture_high <> round(p_moisture_high) THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'contribution_id',prior.id,'zone',prior.zone,'idempotent',true);
  END IF;
  SELECT * INTO cyc FROM public.plant_cycle WHERE id = p_cycle_id AND account_id = aid FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','cycle_unavailable','message','Own plant required.'); END IF;
  IF cyc.ended_on IS NULL THEN RETURN jsonb_build_object('ok',false,'code','state_conflict','message','Only a finished plant can be shared.'); END IF;
  SELECT * INTO slot FROM public.garden_slot WHERE id = cyc.slot_id FOR UPDATE;
  IF NOT slot.community_share THEN RETURN jsonb_build_object('ok',false,'code','not_opted_in','message','Sharing is off for this slot.'); END IF;
  SELECT * INTO rules FROM public.community_rules();
  days := cyc.ended_on - cyc.planted_on;
  IF cyc.outcome <> 'berhasil' THEN RETURN jsonb_build_object('ok',false,'code','not_eligible','message','Only a plant that grew well can be shared.'); END IF;
  IF days < rules.min_cycle_days THEN RETURN jsonb_build_object('ok',false,'code','not_eligible','message','It grew for too short a time to be shared.'); END IF;
  IF clock_timestamp() - cyc.created_at < make_interval(days => rules.min_age_days) THEN
    RETURN jsonb_build_object('ok',false,'code','not_eligible','message','This plant was added too recently to be shared.'); END IF;
  IF EXISTS (SELECT 1 FROM public.community_contribution WHERE cycle_id = cyc.id) THEN
    RETURN jsonb_build_object('ok',false,'code','state_conflict','message','This plant is already shared.'); END IF;
  SELECT * INTO site FROM public.garden_site WHERE id = slot.site_id;
  INSERT INTO public.community_contribution(account_id, slot_id, cycle_id, request_id, species_id, zone, duration_days, watering_interval_days, moisture_low, moisture_high)
    VALUES (aid, slot.id, cyc.id, p_request_id, cyc.species_id, public.climate_zone(site.placement, site.latitude), days, round(p_watering_interval_days, 1), round(p_moisture_low), round(p_moisture_high)) RETURNING * INTO made;
  RETURN jsonb_build_object('ok',true,'contribution_id',made.id,'zone',made.zone,'idempotent',false);
END $$;

-- Owner: take one shared plant back.
CREATE FUNCTION public.unshare_my_cycle(p_cycle_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; gone integer;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_cycle_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A plant is required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plant_cycle WHERE id = p_cycle_id AND account_id = aid) THEN
    RETURN jsonb_build_object('ok',false,'code','cycle_unavailable','message','Own plant required.'); END IF;
  DELETE FROM public.community_contribution WHERE cycle_id = p_cycle_id AND account_id = aid;
  GET DIAGNOSTICS gone = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'withdrawn',gone);
END $$;

-- Anyone signed in: what the shared plants of one species say, zone by zone. A zone appears only when enough different owners and
-- plants stand behind it after three safeguards: one owner counts at most owner_cap plants per zone (the most recent ones), plants
-- that a curator excluded are left out, and a plant whose numbers lie outside the usual spread of its zone (more than 1.5 times the
-- interquartile range beyond the quartiles, in any of the three numbers) is trimmed. The thresholds apply to what is left, so
-- trimming cannot leave a result resting on fewer plants than the rules say. A zone below them is not listed at all, and no count is
-- given for it. Values are rounded; no identifier of any kind is returned. With two plants counted per owner, five plants already
-- mean three owners; both checks stay so that the rule still holds if either number is changed.
CREATE FUNCTION public.community_knowledge(p_species_id integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE rules record; zones jsonb;
BEGIN
  IF NOT public.current_auth_session() OR NOT EXISTS (SELECT 1 FROM public.account WHERE auth_user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_species_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.plant_species WHERE species_id = p_species_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A known species is required.'); END IF;
  SELECT * INTO rules FROM public.community_rules();
  WITH ranked AS (
    SELECT c.zone, c.account_id, c.watering_interval_days AS w, c.moisture_low AS lo, c.moisture_high AS hi,
           row_number() OVER (PARTITION BY c.account_id, c.zone ORDER BY c.shared_at DESC, c.id) AS rn
    FROM public.community_contribution c WHERE c.species_id = p_species_id AND c.excluded_at IS NULL
  ), capped AS (SELECT * FROM ranked WHERE rn <= rules.owner_cap),
  spread AS (
    SELECT zone,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY w) AS w1, percentile_cont(0.75) WITHIN GROUP (ORDER BY w) AS w3,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY lo) AS l1, percentile_cont(0.75) WITHIN GROUP (ORDER BY lo) AS l3,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY hi) AS h1, percentile_cont(0.75) WITHIN GROUP (ORDER BY hi) AS h3
    FROM capped GROUP BY zone
  ), usual AS (
    SELECT c.* FROM capped c JOIN spread s USING (zone)
    WHERE c.w BETWEEN s.w1 - 1.5 * (s.w3 - s.w1) AND s.w3 + 1.5 * (s.w3 - s.w1)
      AND c.lo BETWEEN s.l1 - 1.5 * (s.l3 - s.l1) AND s.l3 + 1.5 * (s.l3 - s.l1)
      AND c.hi BETWEEN s.h1 - 1.5 * (s.h3 - s.h1) AND s.h3 + 1.5 * (s.h3 - s.h1)
  ), enough AS (
    SELECT zone, count(*) AS cycles, count(DISTINCT account_id) AS owners,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY w) AS w25, percentile_cont(0.5) WITHIN GROUP (ORDER BY w) AS w50, percentile_cont(0.75) WITHIN GROUP (ORDER BY w) AS w75,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY lo) AS lo50, percentile_cont(0.5) WITHIN GROUP (ORDER BY hi) AS hi50
    FROM usual GROUP BY zone HAVING count(*) >= rules.min_cycles AND count(DISTINCT account_id) >= rules.min_owners
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('zone',zone,'cycles',cycles,'owners',owners,
      'watering_interval_days',jsonb_build_object('low',round(w25 * 2) / 2,'median',round(w50 * 2) / 2,'high',round(w75 * 2) / 2),
      'moisture',jsonb_build_object('low',round(lo50),'high',round(hi50))) ORDER BY zone), '[]'::jsonb) INTO zones FROM enough;
  RETURN jsonb_build_object('ok',true,'label','belum dikurasi','source','komunitas','species_id',p_species_id,'zones',zones);
END $$;

-- Curator (verified authenticator): the shared plants of one species, without who shared them, which slot or plant they came from
-- or when to the minute, so that a strange one can be excluded.
CREATE FUNCTION public.review_community_contributions(p_species_id integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF NOT ('curator' = ANY(public.my_curation_roles())) THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Curator role with a verified authenticator required.'); END IF;
  IF p_species_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.plant_species WHERE species_id = p_species_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A known species is required.'); END IF;
  RETURN jsonb_build_object('ok',true,'label','belum dikurasi','species_id',p_species_id,'contributions', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',c.id,'zone',c.zone,'duration_days',c.duration_days,'watering_interval_days',c.watering_interval_days,'moisture_low',c.moisture_low,'moisture_high',c.moisture_high,
      'shared_on',c.shared_at::date,'excluded',c.excluded_at IS NOT NULL,'excluded_reason',c.excluded_reason) ORDER BY c.shared_at, c.id)
    FROM (SELECT * FROM public.community_contribution WHERE species_id = p_species_id ORDER BY shared_at DESC, id LIMIT 500) c), '[]'::jsonb));
END $$;

-- Curator (verified authenticator, fresh enough): leave one shared plant out of the aggregates, with a reason, or put it back.
CREATE FUNCTION public.set_community_exclusion(p_contribution_id uuid, p_excluded boolean, p_reason text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; target public.community_contribution; denial jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO actor FROM public.account WHERE auth_user_id = auth.uid() AND 'curator' = ANY(access_roles);
  IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'code','forbidden','message','Curator role required.'); END IF;
  IF p_contribution_id IS NULL OR p_excluded IS NULL OR (p_excluded AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500)) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A contribution, a choice and, to exclude, a reason of up to 500 characters are required.'); END IF;
  SELECT * INTO target FROM public.community_contribution WHERE id = p_contribution_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','contribution_unavailable','message','Contribution unavailable.'); END IF;
  denial := public.privileged_write_gate('curator');
  IF denial IS NOT NULL THEN RETURN denial; END IF;
  UPDATE public.community_contribution SET
    excluded_at = CASE WHEN p_excluded THEN clock_timestamp() END, excluded_by = CASE WHEN p_excluded THEN actor END, excluded_reason = CASE WHEN p_excluded THEN btrim(p_reason) END
    WHERE id = target.id;
  RETURN jsonb_build_object('ok',true,'contribution_id',target.id,'excluded',p_excluded);
END $$;

REVOKE ALL ON FUNCTION public.community_rules(), public.climate_zone(text, numeric), public.set_slot_sharing(uuid, boolean),
  public.share_my_cycle(uuid, uuid, numeric, numeric, numeric), public.unshare_my_cycle(uuid), public.community_knowledge(integer),
  public.review_community_contributions(integer), public.set_community_exclusion(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_slot_sharing(uuid, boolean), public.share_my_cycle(uuid, uuid, numeric, numeric, numeric), public.unshare_my_cycle(uuid),
  public.community_knowledge(integer), public.review_community_contributions(integer), public.set_community_exclusion(uuid, boolean, text) TO authenticated;
