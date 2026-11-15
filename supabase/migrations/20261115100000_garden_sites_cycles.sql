-- Fase 6 (inactive until the app runs in live mode): a person's pots and gardens on the server. A site is a personal pot or a
-- garden, a slot is a place in it (a pot has one, a garden has a zone each) and a plant cycle is one plant's time in a slot.
-- Replacing a plant closes its cycle and opens another in one step; a closed cycle can never be changed again, so the history an
-- owner (and, later, the community knowledge) relies on stays what it was. Everything is reached through the functions below;
-- the tables themselves are closed to every role but the service role.

-- The species ids the server accepts. They are the permanent integers of the app's catalog (src/lib/species.ts); a plant's code is
-- species_id * 1_000_000 + plant_no, and 2146 is the largest species id for which that still fits a Postgres integer.
CREATE TABLE public.plant_species (
  species_id integer PRIMARY KEY CHECK (species_id BETWEEN 1 AND 2146),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  tier text NOT NULL CHECK (tier IN ('kurasi','belajar'))
);
INSERT INTO public.plant_species(species_id, name, tier) VALUES
  (1,'Cabai','kurasi'), (2,'Bawang merah','kurasi'), (3,'Anggrek bulan','belajar'), (4,'Peoni','belajar');

-- The next plant number of each species, across every account: a plant number is never used twice.
CREATE TABLE public.plant_counter (
  species_id integer PRIMARY KEY REFERENCES public.plant_species(species_id) ON DELETE RESTRICT,
  next_no integer NOT NULL CHECK (next_no BETWEEN 2 AND 1000000)
);

CREATE TABLE public.garden_site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  request_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('pot','garden')),
  placement text NOT NULL CHECK (placement IN ('indoor','outdoor','rooftop')),
  -- Two decimals is about a kilometre: the column cannot hold a more exact place than a forecast needs.
  latitude numeric(5,2) CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(6,2) CHECK (longitude BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (placement <> 'indoor' OR latitude IS NULL)
);
CREATE UNIQUE INDEX garden_site_request ON public.garden_site(account_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX garden_site_account ON public.garden_site(account_id, created_at, id);

CREATE TABLE public.garden_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.garden_site(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Reserved: the unit (the real device) that reports for this slot. Nothing sets it yet.
  unit_id uuid REFERENCES public.unit(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX garden_slot_name ON public.garden_slot(site_id, lower(btrim(name)));
CREATE INDEX garden_slot_account ON public.garden_slot(account_id, created_at, id);

CREATE TABLE public.plant_cycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.garden_slot(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.account(id) ON DELETE RESTRICT,
  request_id uuid,
  species_id integer NOT NULL REFERENCES public.plant_species(species_id) ON DELETE RESTRICT,
  plant_no integer NOT NULL CHECK (plant_no BETWEEN 1 AND 999999),
  code integer GENERATED ALWAYS AS (species_id * 1000000 + plant_no) STORED,
  nickname text NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 60),
  planted_on date NOT NULL,
  ended_on date,
  outcome text CHECK (outcome IN ('berhasil','gagal','dihentikan')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (species_id, plant_no),
  CHECK (ended_on IS NULL OR ended_on >= planted_on),
  CHECK ((ended_on IS NULL) = (outcome IS NULL))
);
-- One plant at a time in a slot.
CREATE UNIQUE INDEX plant_cycle_one_active ON public.plant_cycle(slot_id) WHERE ended_on IS NULL;
CREATE UNIQUE INDEX plant_cycle_request ON public.plant_cycle(account_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX plant_cycle_slot ON public.plant_cycle(slot_id, planted_on, id);

-- A cycle is written once and closed once. Nothing else about it changes, and it is never deleted.
CREATE FUNCTION public.plant_cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'plant_cycle is never deleted'; END IF;
  IF OLD.ended_on IS NOT NULL THEN RAISE EXCEPTION 'a closed plant cycle cannot change'; END IF;
  IF (NEW.id, NEW.slot_id, NEW.account_id, NEW.request_id, NEW.species_id, NEW.plant_no, NEW.nickname, NEW.planted_on, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.slot_id, OLD.account_id, OLD.request_id, OLD.species_id, OLD.plant_no, OLD.nickname, OLD.planted_on, OLD.created_at) THEN
    RAISE EXCEPTION 'a plant cycle can only be closed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plant_cycle_guard BEFORE UPDATE OR DELETE ON public.plant_cycle FOR EACH ROW EXECUTE FUNCTION public.plant_cycle_guard();

ALTER TABLE public.plant_species ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garden_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garden_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_cycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plant_species, public.plant_counter, public.garden_site, public.garden_slot, public.plant_cycle FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.plant_species, public.plant_counter, public.garden_site, public.garden_slot, public.plant_cycle TO service_role;

-- Owner: everything of theirs and nothing of anyone else's.
CREATE FUNCTION public.my_garden() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid();
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  RETURN jsonb_build_object('ok',true,
    'sites', coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind,'placement',s.placement,'latitude',s.latitude,'longitude',s.longitude) ORDER BY s.created_at, s.id) FROM public.garden_site s WHERE s.account_id = aid), '[]'::jsonb),
    'slots', coalesce((SELECT jsonb_agg(jsonb_build_object('id',z.id,'site_id',z.site_id,'name',z.name,'unit_id',z.unit_id) ORDER BY z.created_at, z.id) FROM public.garden_slot z WHERE z.account_id = aid), '[]'::jsonb),
    'cycles', coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'slot_id',c.slot_id,'species_id',c.species_id,'plant_no',c.plant_no,'code',c.code,'nickname',c.nickname,'planted_on',c.planted_on,'ended_on',c.ended_on,'outcome',c.outcome) ORDER BY c.planted_on, c.created_at, c.id) FROM public.plant_cycle c WHERE c.account_id = aid), '[]'::jsonb));
END $$;

-- Owner: a personal pot (one slot, named like it) or a garden (one slot for each zone). A retry with the same request id returns the first answer.
CREATE FUNCTION public.add_my_site(p_request_id uuid, p_name text, p_kind text, p_placement text, p_latitude numeric, p_longitude numeric, p_zones text[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; clean text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'); zones text[]; zone text; prior public.garden_site; sid uuid; zid uuid; ids uuid[] := '{}';
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_request_id IS NULL OR length(clean) NOT BETWEEN 1 AND 60 OR p_kind IS NULL OR p_kind NOT IN ('pot','garden') OR p_placement IS NULL OR p_placement NOT IN ('indoor','outdoor','rooftop')
     OR (p_latitude IS NULL) <> (p_longitude IS NULL) OR abs(coalesce(p_latitude,0)) > 90 OR abs(coalesce(p_longitude,0)) > 180 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A request id, a name, a kind, a placement and a valid place are required.'); END IF;
  IF p_kind = 'pot' THEN zones := ARRAY[clean];
  ELSE
    SELECT coalesce(array_agg(regexp_replace(btrim(z), '\s+', ' ', 'g') ORDER BY ord), '{}') INTO zones FROM unnest(coalesce(p_zones, '{}')) WITH ORDINALITY AS t(z, ord);
    IF coalesce(array_length(zones,1),0) NOT BETWEEN 1 AND 12 OR EXISTS (SELECT 1 FROM unnest(zones) z WHERE length(z) NOT BETWEEN 1 AND 60)
       OR (SELECT count(DISTINCT lower(z)) FROM unnest(zones) z) <> array_length(zones,1) THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_request','message','A garden needs 1 to 12 zones with different names.'); END IF;
  END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id = auth.uid() FOR UPDATE;
  IF aid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Account required.'); END IF;
  SELECT * INTO prior FROM public.garden_site WHERE account_id = aid AND request_id = p_request_id;
  IF FOUND THEN
    IF prior.name <> clean OR prior.kind <> p_kind OR prior.placement <> p_placement THEN
      RETURN jsonb_build_object('ok',false,'code','request_conflict','message','Request already has another payload.'); END IF;
    RETURN jsonb_build_object('ok',true,'site_id',prior.id,'slot_ids',(SELECT coalesce(jsonb_agg(id ORDER BY created_at, id),'[]'::jsonb) FROM public.garden_slot WHERE site_id = prior.id),'idempotent',true);
  END IF;
  IF (SELECT count(*) FROM public.garden_site WHERE account_id = aid) >= 20 OR (SELECT count(*) FROM public.garden_slot WHERE account_id = aid) + array_length(zones,1) > 60 THEN
    RETURN jsonb_build_object('ok',false,'code','limit_reached','message','At most 20 pots and gardens and 60 slots.'); END IF;
  INSERT INTO public.garden_site(account_id, request_id, name, kind, placement, latitude, longitude)
    VALUES (aid, p_request_id, clean, p_kind, p_placement, CASE WHEN p_placement = 'indoor' THEN NULL ELSE p_latitude END, CASE WHEN p_placement = 'indoor' THEN NULL ELSE p_longitude END) RETURNING id INTO sid;
  FOREACH zone IN ARRAY zones LOOP
    INSERT INTO public.garden_slot(site_id, account_id, name) VALUES (sid, aid, zone) RETURNING id INTO zid;
    ids := ids || zid;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'site_id',sid,'slot_ids',to_jsonb(ids),'idempotent',false);
END $$;

-- The next number of a species, taken under a row lock so two plants never get the same one.
CREATE FUNCTION public.next_plant_no(p_species_id integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE taken integer;
BEGIN
  INSERT INTO public.plant_counter(species_id, next_no) VALUES (p_species_id, 2)
    ON CONFLICT (species_id) DO UPDATE SET next_no = public.plant_counter.next_no + 1 RETURNING next_no - 1 INTO taken;
  RETURN taken;
END $$;

-- Opens a cycle in a slot that has none active. Shared by planting and by replacing; not callable by users.
CREATE FUNCTION public.open_plant_cycle(p_account_id uuid, p_request_id uuid, p_slot_id uuid, p_species_id integer, p_planted_on date, p_nickname text) RETURNS public.plant_cycle
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE sp public.plant_species; no integer; nick text := regexp_replace(btrim(coalesce(p_nickname,'')), '\s+', ' ', 'g'); made public.plant_cycle;
BEGIN
  SELECT * INTO sp FROM public.plant_species WHERE species_id = p_species_id;
  no := public.next_plant_no(p_species_id);
  -- The name a person sees counts their own plants of the species (Cabai 1, Cabai 2); the code behind it is the global one.
  IF nick = '' THEN nick := sp.name || ' ' || ((SELECT count(*) FROM public.plant_cycle WHERE account_id = p_account_id AND species_id = p_species_id) + 1); END IF;
  INSERT INTO public.plant_cycle(slot_id, account_id, request_id, species_id, plant_no, nickname, planted_on)
    VALUES (p_slot_id, p_account_id, p_request_id, p_species_id, no, nick, p_planted_on) RETURNING * INTO made;
  RETURN made;
END $$;

CREATE FUNCTION public.cycle_json(c public.plant_cycle) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id',c.id,'slot_id',c.slot_id,'species_id',c.species_id,'plant_no',c.plant_no,'code',c.code,'nickname',c.nickname,'planted_on',c.planted_on,'ended_on',c.ended_on,'outcome',c.outcome) $$;

-- Owner: plant in a slot that has nothing growing. A retry with the same request id returns the first cycle.
CREATE FUNCTION public.plant_in_my_slot(p_request_id uuid, p_slot_id uuid, p_species_id integer, p_planted_on date, p_nickname text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; slot public.garden_slot; prior public.plant_cycle; made public.plant_cycle;
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
  made := public.open_plant_cycle(aid, p_request_id, slot.id, p_species_id, p_planted_on, p_nickname);
  RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(made),'idempotent',false);
END $$;

-- Owner: replace the plant in a slot. The active cycle closes on `p_on` with its outcome and a new one opens, in one step; the
-- same species planted the same day again changes nothing. A retry with the same request id returns the first answer.
CREATE FUNCTION public.switch_my_plant(p_request_id uuid, p_slot_id uuid, p_species_id integer, p_on date, p_outcome text, p_nickname text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE aid uuid; slot public.garden_slot; active public.plant_cycle; prior public.plant_cycle; made public.plant_cycle; closed public.plant_cycle;
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
  IF active.id IS NOT NULL THEN UPDATE public.plant_cycle SET ended_on = p_on, outcome = p_outcome WHERE id = active.id RETURNING * INTO closed; END IF;
  made := public.open_plant_cycle(aid, p_request_id, slot.id, p_species_id, p_on, p_nickname);
  RETURN jsonb_build_object('ok',true,'cycle',public.cycle_json(made),'closed',CASE WHEN closed.id IS NULL THEN NULL ELSE public.cycle_json(closed) END,'idempotent',false);
END $$;

-- Only the owner-facing functions are callable by a signed-in user; the helpers are for the functions above.
REVOKE ALL ON FUNCTION public.plant_cycle_guard(), public.next_plant_no(integer), public.cycle_json(public.plant_cycle),
  public.open_plant_cycle(uuid,uuid,uuid,integer,date,text), public.my_garden(), public.add_my_site(uuid,text,text,text,numeric,numeric,text[]),
  public.plant_in_my_slot(uuid,uuid,integer,date,text), public.switch_my_plant(uuid,uuid,integer,date,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_garden(), public.add_my_site(uuid,text,text,text,numeric,numeric,text[]),
  public.plant_in_my_slot(uuid,uuid,integer,date,text), public.switch_my_plant(uuid,uuid,integer,date,text,text) TO authenticated;
