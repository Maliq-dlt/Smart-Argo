-- The overview scans receipt times for each deployment, including packets uploaded late.
CREATE INDEX care_unit_receipts ON public.telemetry_packet(unit_id,device_id,received_at) INCLUDE (measured_at);

-- One snapshot for the dashboard. Materialize current deployments once for plants and device issues.
CREATE FUNCTION public.my_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET jit=off AS $$
DECLARE denied jsonb:=public.care_session_error(); aid uuid; result jsonb;
BEGIN
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid();
  WITH owned AS MATERIALIZED (
    SELECT o.id,o.product_id,o.start_at FROM public.ownership o JOIN public.product p ON p.id=o.product_id
    WHERE o.account_id=aid AND o.end_at IS NULL AND p.registry_status='active'
  ), units AS MATERIALIZED (
    SELECT u.id,u.profile_version_id,o.id AS ownership_id,o.product_id,o.start_at FROM owned o JOIN public.unit u
      ON u.product_id=o.product_id AND u.archived_at IS NULL
  ), deployed AS MATERIALIZED (
    SELECT u.*,d.device_id,d.since_at,d.priority FROM units u
    CROSS JOIN LATERAL public.care_unit_device(u.id,u.product_id,u.start_at) WITH ORDINALITY d(device_id,since_at,priority)
  ), plant_rows AS (
    SELECT c.nickname AS name,c.species_id,site.name AS place,s.id AS slot_id,u.id AS unit_id,c.created_at,
      (ARRAY['CB','BM','AB','PN'])[c.species_id] || '-' || c.plant_no AS tag,
      w.moisture,w.measured_at,b.band,b.source AS band_source,
      CASE WHEN d.device_id IS NULL THEN 'no_device'
        WHEN b.band IS NULL OR w.moisture IS NULL THEN 'learning'
        WHEN w.moisture<=b.band[1] THEN 'below' WHEN w.moisture>=b.band[2] THEN 'above' ELSE 'ok' END AS state,
      CASE WHEN d.device_id IS NOT NULL THEN w.outlook||jsonb_build_object('band_source',b.source) END AS outlook
    FROM public.plant_cycle c JOIN public.garden_slot s ON s.id=c.slot_id AND s.account_id=aid
    JOIN public.garden_site site ON site.id=s.site_id AND site.account_id=aid
    LEFT JOIN units u ON u.id=s.unit_id
    LEFT JOIN deployed d ON d.id=u.id AND d.priority=1
    LEFT JOIN LATERAL (SELECT x.band,CASE WHEN x.band IS NOT NULL THEN public.care_band_source(u.id,u.profile_version_id) END AS source
      FROM (SELECT public.care_band(u.id,u.profile_version_id,u.ownership_id,d.device_id,d.since_at) AS band OFFSET 0) x) b ON d.device_id IS NOT NULL
    LEFT JOIN LATERAL public.care_water_analysis(u.id,d.device_id,d.since_at,u.ownership_id,b.band,7) w ON d.device_id IS NOT NULL
    WHERE c.account_id=aid AND c.ended_on IS NULL
  ), issues AS (
    SELECT d.id AS unit_id,d.device_id,v.kind,v.since,v.detail FROM deployed d
    LEFT JOIN LATERAL (SELECT t.measured_at,s.volts FROM public.telemetry_packet t
      CROSS JOIN LATERAL (SELECT CASE WHEN t.clock_status='synced' AND t.payload::jsonb#>>'{battery,status}'='ok'
        AND jsonb_typeof(t.payload::jsonb#>'{battery,value}')='number' THEN (t.payload::jsonb#>>'{battery,value}')::numeric END AS volts) s
      WHERE t.unit_id=d.id AND t.device_id=d.device_id AND t.measured_at BETWEEN greatest(d.since_at,now()-interval '75 minutes') AND now()
        AND t.received_at>=d.since_at ORDER BY t.measured_at DESC,t.id DESC LIMIT 1) cell ON true
    LEFT JOIN LATERAL (SELECT max(t.received_at) AS at FROM public.telemetry_packet t
      WHERE t.device_id=d.device_id AND t.unit_id=d.id AND t.measured_at>=d.since_at AND t.received_at>=d.since_at) receipt ON true
    -- One recovered gap is history (my_unit_health.upload_gaps); queued readings arrive after it anyway.
    -- Three in seven days point at weak Wi-Fi where the pot stands, which the owner can act on.
    LEFT JOIN LATERAL (SELECT count(*) AS n,min(prev) AS prev,max(at) AS at FROM (
      SELECT received_at AS at,lag(received_at) OVER(ORDER BY received_at) AS prev FROM public.telemetry_packet t
      WHERE t.unit_id=d.id AND t.device_id=d.device_id AND t.measured_at>=d.since_at
        AND t.received_at>=greatest(d.since_at,now()-interval '7 days')) times
      WHERE at-prev>interval '90 minutes') gap ON true
    CROSS JOIN LATERAL (VALUES
      ('battery_low',cell.measured_at,jsonb_build_object('volts',cell.volts),cell.volts>=2.5 AND cell.volts<3.4),
      ('silent',coalesce(receipt.at,d.since_at),jsonb_build_object('last_upload',receipt.at),
        coalesce(receipt.at,d.since_at)<now()-interval '90 minutes'),
      ('gap',gap.prev,jsonb_build_object('count',gap.n,'last_resumed_at',gap.at),gap.n>=3)
    ) v(kind,since,detail,active) WHERE v.active
  )
  SELECT jsonb_build_object('ok',true,'plants',coalesce((SELECT jsonb_agg(to_jsonb(r)-'created_at' ORDER BY r.created_at,r.slot_id) FROM plant_rows r),'[]'),
    'devices',jsonb_build_object('total',(SELECT count(*) FROM owned o JOIN public.device d ON d.product_id=o.product_id WHERE d.status<>'revoked'),
    'issues',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.unit_id,i.device_id,i.kind) FROM issues i),'[]'))) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.my_overview() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_overview() TO authenticated;
