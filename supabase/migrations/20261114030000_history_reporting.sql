-- Owner-only history: receipt cutoff and tuple cursor, never signed packet contents.
CREATE INDEX measurement_history_page ON public.measurement(unit_id,measured_at DESC,id DESC);
CREATE FUNCTION public.read_my_measurement_history(p_unit_id uuid,p_from timestamptz,p_to timestamptz,p_limit integer DEFAULT 100,p_cursor_at timestamptz DEFAULT NULL,p_cursor_id uuid DEFAULT NULL,p_snapshot_as_of timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE pid uuid; own public.ownership; cutoff timestamptz; rows jsonb; next_cursor jsonb;
BEGIN
  IF NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  IF p_unit_id IS NULL OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
    OR p_from>=p_to OR p_to-p_from>interval '31 days' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
    OR (p_cursor_at IS NULL)<>(p_cursor_id IS NULL) OR (p_cursor_at IS NOT NULL AND (NOT isfinite(p_cursor_at) OR p_snapshot_as_of IS NULL))
    OR (p_snapshot_as_of IS NOT NULL AND (NOT isfinite(p_snapshot_as_of) OR p_snapshot_as_of>clock_timestamp())) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_range','message','Finite ordered windows up to 31 days, limit 1–500 and a complete cursor required.'); END IF;
  SELECT product_id INTO pid FROM public.unit WHERE id=p_unit_id;
  -- Ingestion and transfers lock product first. Wait before taking the receipt cutoff.
  PERFORM 1 FROM public.product WHERE id=pid FOR SHARE;
  PERFORM 1 FROM public.account WHERE auth_user_id=auth.uid() FOR SHARE;
  PERFORM 1 FROM auth.sessions WHERE id=(auth.jwt()->>'session_id')::uuid AND user_id=auth.uid() FOR SHARE;
  IF NOT FOUND OR NOT public.current_auth_session() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','message','Active session required.'); END IF;
  SELECT o.* INTO own FROM public.ownership o JOIN public.account a ON a.id=o.account_id
    WHERE o.product_id=pid AND o.end_at IS NULL AND a.auth_user_id=auth.uid() FOR SHARE OF o;
  IF own.id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unit_unavailable','message','Owned unit required.'); END IF;
  cutoff:=coalesce(p_snapshot_as_of,clock_timestamp());
  IF p_cursor_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.id=p_cursor_id AND m.measured_at=p_cursor_at AND m.unit_id=p_unit_id AND m.source='device'
      AND m.measured_at>=greatest(p_from,own.start_at) AND m.measured_at<p_to AND m.received_at>=own.start_at AND m.received_at<=cutoff) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_cursor','message','Cursor does not belong to this history window.'); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.measured_at DESC,r.id DESC),'[]'::jsonb) INTO rows FROM (
    SELECT m.id,m.unit_id,m.device_id,m.packet_id,m.sensor_id,m.quality_status,m.value_nullable,m.error_message,
      m.measured_at,m.received_at,m.source,t.clock_status,t.sequence,t.boot_id
    FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.unit_id=p_unit_id AND m.source='device' AND m.measured_at>=greatest(p_from,own.start_at) AND m.measured_at<p_to
      AND m.received_at>=own.start_at AND m.received_at<=cutoff
      AND (p_cursor_at IS NULL OR (m.measured_at,m.id)<(p_cursor_at,p_cursor_id))
    ORDER BY m.measured_at DESC,m.id DESC LIMIT p_limit+1
  ) r;
  IF jsonb_array_length(rows)>p_limit THEN
    rows:=rows-p_limit;
    next_cursor:=jsonb_build_object('measured_at',rows->(p_limit-1)->>'measured_at','id',rows->(p_limit-1)->>'id');
  END IF;
  -- ponytail: receipt cutoff is stable for normal serialized ingest, not a retained MVCC snapshot against privileged manual writes.
  RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'from',p_from,'to',p_to,'snapshot_as_of',cutoff,'readings',rows,'next_cursor',next_cursor);
END $$;

CREATE FUNCTION public.compare_my_measurement_history(p_unit_id uuid,p_first_from timestamptz,p_first_to timestamptz,p_second_from timestamptz,p_second_to timestamptz,p_snapshot_as_of timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE checked jsonb; cutoff timestamptz; own_start timestamptz; result jsonb; row_count integer;
BEGIN
  checked:=public.read_my_measurement_history(p_unit_id,p_first_from,p_first_to,1,NULL,NULL,p_snapshot_as_of);
  IF NOT (checked->>'ok')::boolean THEN RETURN checked; END IF;
  cutoff:=(checked->>'snapshot_as_of')::timestamptz;
  checked:=public.read_my_measurement_history(p_unit_id,p_second_from,p_second_to,1,NULL,NULL,cutoff);
  IF NOT (checked->>'ok')::boolean THEN RETURN checked; END IF;
  IF p_first_from<p_second_to AND p_second_from<p_first_to THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_range','message','Comparison windows must not overlap.'); END IF;
  SELECT o.start_at INTO own_start FROM public.unit u JOIN public.ownership o ON o.product_id=u.product_id
    JOIN public.account a ON a.id=o.account_id WHERE u.id=p_unit_id AND o.end_at IS NULL AND a.auth_user_id=auth.uid();
  SELECT count(*) INTO row_count FROM (SELECT 1 FROM public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id
    WHERE m.unit_id=p_unit_id AND m.source='device' AND m.measured_at>=own_start AND m.received_at>=own_start AND m.received_at<=cutoff
      AND ((m.measured_at>=p_first_from AND m.measured_at<p_first_to) OR (m.measured_at>=p_second_from AND m.measured_at<p_second_to)) LIMIT 20001) bounded;
  IF row_count>20000 THEN RETURN jsonb_build_object('ok',false,'code','range_too_large','message','Comparison exceeds 20000 measurements; choose smaller windows.'); END IF;
  WITH windows(label,start_at,end_at) AS (VALUES ('first',p_first_from,p_first_to),('second',p_second_from,p_second_to)),
  sensors(sensor_id) AS (VALUES ('moisture'),('soil_temperature'),('soil_ph')),
  stats AS (
    SELECT s.sensor_id,w.label,count(m.id) AS total_count,
      count(m.id) FILTER (WHERE m.quality_status='ok') AS ok_count,
      count(m.id) FILTER (WHERE m.quality_status='error') AS error_count,
      count(m.id) FILTER (WHERE m.quality_status='not_measured') AS not_measured_count,
      count(m.id) FILTER (WHERE t.clock_status='unsynced') AS unsynced_count,
      count(m.id) FILTER (WHERE m.quality_status='ok' AND t.clock_status='synced' AND m.value_nullable>'-Infinity'::float8 AND m.value_nullable<'Infinity'::float8) AS eligible_count,
      min(m.value_nullable) FILTER (WHERE m.quality_status='ok' AND t.clock_status='synced' AND m.value_nullable>'-Infinity'::float8 AND m.value_nullable<'Infinity'::float8) AS min,
      max(m.value_nullable) FILTER (WHERE m.quality_status='ok' AND t.clock_status='synced' AND m.value_nullable>'-Infinity'::float8 AND m.value_nullable<'Infinity'::float8) AS max,
      avg(m.value_nullable) FILTER (WHERE m.quality_status='ok' AND t.clock_status='synced' AND m.value_nullable>'-Infinity'::float8 AND m.value_nullable<'Infinity'::float8) AS avg
    FROM sensors s CROSS JOIN windows w LEFT JOIN (public.measurement m JOIN public.telemetry_packet t ON t.id=m.packet_id)
      ON m.sensor_id=s.sensor_id AND m.unit_id=p_unit_id AND m.source='device' AND m.measured_at>=greatest(w.start_at,own_start)
        AND m.measured_at<w.end_at AND m.received_at>=own_start AND m.received_at<=cutoff
    GROUP BY s.sensor_id,w.label
  ) SELECT jsonb_agg(jsonb_build_object('sensor_id',a.sensor_id,'first',to_jsonb(a)-'sensor_id'-'label','second',to_jsonb(b)-'sensor_id'-'label',
      'avg_delta',CASE WHEN a.eligible_count>0 AND b.eligible_count>0 THEN b.avg-a.avg ELSE NULL END) ORDER BY a.sensor_id)
    INTO result FROM stats a JOIN stats b USING(sensor_id) WHERE a.label='first' AND b.label='second';
  RETURN jsonb_build_object('ok',true,'unit_id',p_unit_id,'snapshot_as_of',cutoff,'first_from',p_first_from,'first_to',p_first_to,
    'second_from',p_second_from,'second_to',p_second_to,'sensors',result);
END $$;
REVOKE ALL ON FUNCTION public.read_my_measurement_history(uuid,timestamptz,timestamptz,integer,timestamptz,uuid,timestamptz),public.compare_my_measurement_history(uuid,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_my_measurement_history(uuid,timestamptz,timestamptz,integer,timestamptz,uuid,timestamptz),public.compare_my_measurement_history(uuid,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) TO authenticated;
