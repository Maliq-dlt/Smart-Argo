-- Tegangan baterai di ringkasan unit (2026-11-21). Firmware sends an optional top-level object
-- "battery": {"status": "ok" | "error" | "not_measured", "value": volts | null, "error"?: text} read through the RAB
-- 47k/47k divider (docs/telemetry-v2.md). Ingest already keeps unknown top-level keys in the signed payload, so this
-- only surfaces it: my_unit_overview from 20261114130000_unit_overview.sql with a battery fact and a voltage-based
-- battery_low alert, edits marked. The index serves this and last_packet_at, which scanned a unit's packets.

CREATE INDEX IF NOT EXISTS telemetry_packet_unit_measured ON public.telemetry_packet(unit_id, measured_at DESC);

CREATE OR REPLACE FUNCTION public.my_unit_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  WITH owned AS (
    SELECT o.id AS ownership_id, o.product_id, o.start_at FROM public.ownership o JOIN public.account a ON a.id = o.account_id
    WHERE a.auth_user_id = auth.uid() AND o.end_at IS NULL
  ), units AS (
    SELECT u.*, w.ownership_id, w.start_at AS since, p.serial_public, p.variant, p.registry_status
    FROM public.unit u JOIN owned w ON w.product_id = u.product_id JOIN public.product p ON p.id = u.product_id
    WHERE u.archived_at IS NULL
  ), facts AS (
    SELECT u.id, u.location_label, u.serial_public, u.variant, u.product_id,
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sensor_id), '[]'::jsonb) FROM (
        SELECT DISTINCT ON (m.sensor_id) m.sensor_id, m.quality_status, m.value_nullable, m.error_message, m.measured_at, m.received_at
        FROM public.measurement m WHERE m.unit_id = u.id AND m.source = 'device' AND m.measured_at >= u.since AND m.received_at >= u.since
        ORDER BY m.sensor_id, m.measured_at DESC, m.id DESC) s) AS sensors,
      (SELECT max(t.received_at) FROM public.telemetry_packet t WHERE t.unit_id = u.id AND t.received_at >= u.since AND t.measured_at >= u.since) AS last_packet_at,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('device_id',d.id,'status',d.status,'placed_here',pl.unit_id = u.id) ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.device d LEFT JOIN public.device_placement pl ON pl.device_id = d.id AND pl.end_at IS NULL
        WHERE d.product_id = u.product_id AND (pl.unit_id IS NULL OR pl.unit_id = u.id)) AS devices,
      (SELECT jsonb_build_object('windows',count(*),'solar_wh',sum(e.solar_end_wh - e.solar_start_wh),'load_wh',sum(e.load_end_wh - e.load_start_wh),
          'battery_soc_pct',(array_agg(e.battery_soc_pct ORDER BY e.end_at DESC) FILTER (WHERE e.battery_soc_pct IS NOT NULL))[1])
        FROM public.energy_window e JOIN public.device d ON d.id = e.device_id
        WHERE d.product_id = u.product_id AND e.ownership_id = u.ownership_id AND e.end_at > clock_timestamp() - interval '24 hours') AS energy,
      (SELECT jsonb_build_object('state',x.decision_payload->>'mascot_state','at',x.created_at) FROM public.ai_snapshot x
        WHERE x.unit_id = u.id AND x.ownership_id = u.ownership_id ORDER BY x.created_at DESC, x.id DESC LIMIT 1) AS assessment,
      -- Edit: the battery object of the latest packet only, so a device without the divider costs one row and adds nothing.
      (SELECT CASE WHEN lt.b->>'status' = 'ok' AND jsonb_typeof(lt.b->'value') = 'number'
          AND (lt.b->>'value')::numeric BETWEEN 2.5 AND 4.5
          THEN jsonb_build_object('voltage', round((lt.b->>'value')::numeric, 2), 'measured_at', lt.measured_at) END
        FROM (SELECT t.payload::jsonb->'battery' AS b, t.measured_at FROM public.telemetry_packet t
          WHERE t.unit_id = u.id AND t.received_at >= u.since AND t.measured_at >= u.since
          ORDER BY t.measured_at DESC, t.id DESC LIMIT 1) lt) AS battery
    FROM units u
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('unit_id',f.id,'location_label',f.location_label,'serial_public',f.serial_public,'variant',f.variant,
      'sensors',f.sensors,'last_packet_at',f.last_packet_at,'devices',f.devices,'energy',f.energy,'assessment',f.assessment,'battery',f.battery,
      'alerts', to_jsonb(array_remove(ARRAY[
        CASE WHEN f.last_packet_at IS NULL THEN 'no_data' END,
        -- ponytail: the device reads every 30 minutes; 75 minutes is two missed packets plus slack. Make it per-profile when intervals vary.
        CASE WHEN f.last_packet_at < clock_timestamp() - interval '75 minutes' THEN 'stale' END,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(f.sensors) s WHERE s->>'quality_status' = 'error') THEN 'sensor_error' END,
        CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(f.devices) d WHERE d->>'status' = 'revoked') THEN 'device_revoked' END,
        CASE WHEN (f.energy->>'windows')::int > 0 AND (f.energy->>'load_wh')::numeric > (f.energy->>'solar_wh')::numeric THEN 'energy_deficit' END,
        -- Edit: a 1S Li-ion cell near 3.4 V under radio load has roughly a tenth of its charge left.
        CASE WHEN (f.energy->>'battery_soc_pct')::numeric < 20 OR (f.battery->>'voltage')::numeric < 3.4 THEN 'battery_low' END
      ], NULL))) ORDER BY f.serial_public, f.location_label, f.id), '[]'::jsonb)
    INTO rows FROM facts f;
  RETURN jsonb_build_object('ok',true,'checked_at',clock_timestamp(),'units',rows);
END $$;

REVOKE ALL ON FUNCTION public.my_unit_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_unit_overview() TO authenticated;
