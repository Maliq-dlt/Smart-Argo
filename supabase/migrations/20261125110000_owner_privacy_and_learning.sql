-- Snapshots remain immutable while their owner's account exists. A completed
-- deletion also erases questions and generated answers from every ownership period.
DROP TRIGGER ai_snapshot_immutable ON public.ai_snapshot;
CREATE TRIGGER ai_snapshot_immutable BEFORE UPDATE ON public.ai_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.profile_artifact_immutable();

CREATE FUNCTION public.guard_snapshot_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ownership o JOIN public.account_deletion d ON d.account_id=o.account_id
             WHERE o.id=OLD.ownership_id AND d.purged_at IS NOT NULL) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'snapshot is immutable';
END $$;
CREATE TRIGGER ai_snapshot_delete BEFORE DELETE ON public.ai_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.guard_snapshot_delete();

CREATE FUNCTION public.erase_purged_snapshots() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  DELETE FROM public.ai_snapshot s USING public.ownership o
    WHERE s.ownership_id=o.id AND o.account_id=NEW.account_id;
  RETURN NEW;
END $$;
CREATE TRIGGER erase_purged_snapshots AFTER UPDATE OF purged_at ON public.account_deletion
  FOR EACH ROW WHEN (OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL)
  EXECUTE FUNCTION public.erase_purged_snapshots();
DELETE FROM public.ai_snapshot s USING public.ownership o, public.account_deletion d
  WHERE s.ownership_id=o.id AND o.account_id=d.account_id AND d.purged_at IS NOT NULL;

-- All release paths close the ownership while holding the product lock.
-- Keep the physical unit and placement usable with a neutral, renameable label.
CREATE FUNCTION public.clear_released_unit_labels() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.unit SET location_label='Unit ' || left(id::text,8) WHERE product_id=NEW.product_id;
  RETURN NEW;
END $$;
CREATE TRIGGER clear_released_unit_labels AFTER UPDATE OF end_at ON public.ownership
  FOR EACH ROW WHEN (OLD.end_at IS NULL AND NEW.end_at IS NOT NULL)
  EXECUTE FUNCTION public.clear_released_unit_labels();
-- Repair only inherited labels. A unit created or renamed after release keeps its label.
UPDATE public.unit u SET location_label='Unit ' || left(u.id::text,8)
WHERE EXISTS (SELECT 1 FROM public.ownership o WHERE o.product_id=u.product_id AND u.created_at<=o.end_at
  AND NOT EXISTS (SELECT 1 FROM public.unit_event e WHERE e.unit_id=u.id AND e.action='renamed' AND e.created_at>=o.end_at));

REVOKE ALL ON FUNCTION public.guard_snapshot_delete(), public.erase_purged_snapshots(),
  public.clear_released_unit_labels() FROM PUBLIC, anon, authenticated;

-- Older events for a recipient can contain the previous owner's label in "from".
CREATE OR REPLACE FUNCTION public.my_unit_history(p_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE since timestamptz; rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT o.start_at INTO since FROM public.unit u JOIN public.ownership o ON o.product_id = u.product_id AND o.end_at IS NULL
    JOIN public.account a ON a.id = o.account_id WHERE u.id = p_unit_id AND a.auth_user_id = auth.uid();
  IF since IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Active owned unit required.'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('action',e.action,'detail',CASE WHEN e.action='renamed' AND EXISTS (SELECT 1 FROM public.ownership old JOIN public.unit u ON u.product_id=old.product_id WHERE u.id=p_unit_id AND old.end_at<=since) THEN e.detail-'from' ELSE e.detail END,'created_at',e.created_at) ORDER BY e.id DESC), '[]'::jsonb)
    INTO rows FROM (SELECT * FROM public.unit_event WHERE unit_id = p_unit_id AND created_at >= since ORDER BY id DESC LIMIT 100) e;
  RETURN jsonb_build_object('ok',true,'events',rows);
END $$;

-- Accept the tagged observations saved by earlier Android versions.
CREATE OR REPLACE FUNCTION public.care_band(p_unit uuid,p_version uuid,p_owner uuid,p_device uuid,p_since timestamptz) RETURNS numeric[]
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE limits numeric[]; cycle_start timestamptz;
BEGIN
  SELECT v.care_limits INTO limits FROM public.profile_version v WHERE v.id=p_version AND v.published_at<=now()
    AND v.provenance IS NOT NULL AND v.parameters_and_scope->>'pot_id'=p_unit::text;
  IF limits IS NOT NULL OR p_device IS NULL THEN RETURN limits; END IF;
  SELECT greatest(public.care_moisture_since(p_unit,p_device,p_since),c.created_at) INTO cycle_start FROM public.garden_slot s
    JOIN public.plant_cycle c ON c.slot_id=s.id AND c.ended_on IS NULL
    JOIN public.ownership o ON o.id=p_owner AND o.account_id=s.account_id
    WHERE s.unit_id=p_unit;
  IF cycle_start IS NULL THEN RETURN NULL; END IF;
  WITH readings AS MATERIALIZED (
    SELECT m.measured_at AS at, m.value_nullable AS value
    FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.unit_id=p_unit AND m.device_id=p_device AND m.source='device' AND m.sensor_id='moisture' AND m.quality_status='ok'
      AND t.clock_status='synced' AND m.measured_at>=cycle_start AND m.received_at>=p_since AND m.measured_at<=now()
  ), visits AS MATERIALIZED (
    SELECT j.kind, j.observed_at AS at, lower(j.notes) AS note FROM public.care_journal j
    WHERE j.ownership_id=p_owner AND j.unit_id=p_unit AND j.kind IN ('inspection','watering')
      AND j.observed_at BETWEEN cycle_start AND now()
  )
  SELECT ARRAY[floor(min(r.value)),ceil(max(r.value))]::numeric[] INTO limits FROM readings r
  WHERE EXISTS (SELECT 1 FROM visits v WHERE v.kind='inspection' AND (btrim(v.note)='sehat' OR btrim(v.note) ~ '^\[sehat\]([[:space:]]|$)') AND r.at BETWEEN v.at AND v.at+interval '6 hours')
    AND (SELECT max(at)-min(at) FROM readings)>=interval '7 days'
    AND (SELECT count(*) FROM visits WHERE kind='inspection')>=3
    AND (SELECT count(*) FROM visits w WHERE w.kind='watering'  -- measured: a reading 2 h before and one 3 h after
      AND EXISTS (SELECT 1 FROM readings b WHERE b.at BETWEEN w.at-interval '2 hours' AND w.at)
      AND EXISTS (SELECT 1 FROM readings a WHERE a.at>w.at AND a.at<=w.at+interval '3 hours'))>=2
  HAVING count(DISTINCT r.at)>=3;
  RETURN limits;
END
$$;
