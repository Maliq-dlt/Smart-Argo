CREATE TABLE public.alert_preference (
  account_id uuid PRIMARY KEY REFERENCES public.account(id),
  email_enabled boolean NOT NULL DEFAULT false,
  kinds text[] NOT NULL DEFAULT ARRAY['soil_dry','battery_low','device_silent','soil_hot'],
  CHECK (array_position(kinds,NULL) IS NULL AND kinds <@ ARRAY['soil_dry','battery_low','device_silent','soil_hot'])
);
CREATE TABLE public.alert_episode (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.alert_preference(account_id) ON DELETE CASCADE,
  ownership_id uuid NOT NULL REFERENCES public.ownership(id),
  unit_id uuid NOT NULL REFERENCES public.unit(id),
  device_id uuid NOT NULL REFERENCES public.device(id),
  kind text NOT NULL CHECK (kind IN ('soil_dry','battery_low','device_silent','soil_hot')),
  opened_at timestamptz NOT NULL, closed_at timestamptz, notified_at timestamptz,
  lease_token uuid, lease_until timestamptz
);
CREATE UNIQUE INDEX alert_open ON public.alert_episode(ownership_id,unit_id,device_id,kind) WHERE closed_at IS NULL;
ALTER TABLE public.alert_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_episode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_preference, public.alert_episode FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.my_alert_preferences() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE prefs public.alert_preference; aid uuid; denied jsonb:=public.care_session_error();
BEGIN
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid();
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  SELECT * INTO prefs FROM public.alert_preference WHERE account_id=aid;
  RETURN jsonb_build_object('ok',true,'email_enabled',coalesce(prefs.email_enabled,false),
    'kinds',coalesce(prefs.kinds,ARRAY['soil_dry','battery_low','device_silent','soil_hot']));
END $$;
CREATE FUNCTION public.set_my_alert_preferences(p_email_enabled boolean,p_kinds text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE aid uuid; denied jsonb:=public.care_session_error();
BEGIN
  SELECT id INTO aid FROM public.account WHERE auth_user_id=auth.uid() FOR UPDATE;
  IF denied IS NOT NULL THEN RETURN denied; END IF;
  IF p_email_enabled IS NULL OR p_kinds IS NULL OR cardinality(p_kinds)>4 OR coalesce(array_ndims(p_kinds),1)<>1
     OR array_position(p_kinds,NULL) IS NOT NULL OR NOT p_kinds <@ ARRAY['soil_dry','battery_low','device_silent','soil_hot']
     OR (SELECT count(DISTINCT k) FROM unnest(p_kinds) k)<>cardinality(p_kinds) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_request','message','Use distinct supported alert kinds.');
  END IF;
  INSERT INTO public.alert_preference VALUES(aid,p_email_enabled,p_kinds)
    ON CONFLICT(account_id) DO UPDATE SET email_enabled=excluded.email_enabled,kinds=excluded.kinds;
  RETURN public.my_alert_preferences();
END $$;

-- Each signal supplies the most recent trigger and recovery. Polling a reading twice cannot count it twice.
CREATE FUNCTION public.care_alert_signals(p_unit uuid,p_device uuid,p_since timestamptz,p_low double precision)
RETURNS TABLE(kind text,bad_at timestamptz,good_at timestamptz) LANGUAGE sql STABLE SET search_path='' AS $$
  WITH samples AS MATERIALIZED (SELECT * FROM public.care_samples(p_unit,p_device,greatest(p_since,now()-interval '48 hours'))),
  -- `good` is what counts toward recovery. A battery on a solar panel dips under 3.4 V at night and charges by day, so it
  -- recovers only at 3.6 V or more after 24 h without a low reading: one episode, one mail, until a healthy day.
  -- ponytail: 3.6 V and 24 h are engineering hysteresis for one Li-ion cell, not measured; revisit after the bench test.
  readings AS (SELECT at, v.kind, v.bad, v.good FROM samples CROSS JOIN LATERAL (VALUES
    ('soil_dry',moisture<p_low,moisture>=p_low),('battery_low',volts<3.4,volts>=3.6),
    ('soil_hot',temperature>=35,temperature<35)) v(kind,bad,good)),
  pairs AS (SELECT *, lag(bad) OVER w AS prev_bad, lag(good) OVER w AS prev_good, lag(at) OVER w AS prev_at FROM readings
    WINDOW w AS (PARTITION BY kind ORDER BY at)),
  runs AS (SELECT *, max(at) FILTER (WHERE bad IS DISTINCT FROM prev_bad OR prev_at IS NULL
      OR at-prev_at>interval '75 minutes' OR at=prev_at) OVER (PARTITION BY kind ORDER BY at) AS run_start,
    max(at) FILTER (WHERE bad) OVER (PARTITION BY kind ORDER BY at) AS last_bad FROM pairs),
  arrivals AS (SELECT DISTINCT t.received_at AS received FROM public.telemetry_packet t
    WHERE t.device_id=p_device AND t.unit_id=p_unit AND t.measured_at>=p_since
      AND t.received_at BETWEEN greatest(p_since,now()-interval '48 hours') AND now()),
  links AS (SELECT received,lag(received) OVER (ORDER BY received) AS prev FROM arrivals),
  last_upload AS (SELECT coalesce((SELECT max(t.received_at) FROM public.telemetry_packet t
    WHERE t.device_id=p_device AND t.unit_id=p_unit AND t.measured_at>=p_since AND t.received_at>=p_since),p_since) AS at)
  SELECT kind,
    max(at) FILTER (WHERE bad AND at >= now()-interval '75 minutes' AND
      (kind='battery_low' OR (kind='soil_dry' AND prev_bad AND at>prev_at AND at-prev_at<=interval '75 minutes')
       OR (kind='soil_hot' AND at-run_start>=interval '3 hours'))),
    max(at) FILTER (WHERE good AND prev_good AND at>prev_at AND at-prev_at<=interval '75 minutes'
      AND (kind<>'battery_low' OR last_bad IS NULL OR at-last_bad>=interval '24 hours'))
  FROM runs GROUP BY kind
  UNION ALL
  SELECT 'device_silent', CASE WHEN now()-at>interval '90 minutes' THEN at+interval '90 minutes' END,
    (SELECT max(received) FROM links WHERE received-prev<=interval '90 minutes') FROM last_upload
$$;

CREATE FUNCTION public.evaluate_alerts() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE signal record; episode uuid; pending uuid[] := '{}';
BEGIN
  -- Only one job updates episode boundaries. Claims below also protect concurrent/retried deliveries.
  IF NOT pg_try_advisory_xact_lock(20261123,1) THEN RETURN '[]'::jsonb; END IF;
  FOR signal IN SELECT o.id AS ownership, o.account_id, u.id AS unit, dev.device_id, dev.since_at, s.*
    FROM public.alert_preference prefs JOIN public.ownership o ON o.account_id=prefs.account_id AND o.end_at IS NULL
    JOIN public.product p ON p.id=o.product_id AND p.registry_status='active'
    JOIN public.unit u ON u.product_id=p.id AND u.archived_at IS NULL
    CROSS JOIN LATERAL public.care_unit_device(u.id,p.id,o.start_at) dev
    CROSS JOIN LATERAL public.care_alert_signals(u.id,dev.device_id,dev.since_at,(public.care_band(u.id,u.profile_version_id,o.id,dev.device_id,dev.since_at))[1]::double precision) s
    WHERE prefs.email_enabled AND s.kind=ANY(prefs.kinds)
      AND NOT EXISTS (SELECT 1 FROM public.account_deletion d WHERE d.account_id=o.account_id AND d.cancelled_at IS NULL)
  LOOP
    UPDATE public.alert_episode SET closed_at=greatest(signal.good_at,signal.since_at)
      WHERE ownership_id=signal.ownership AND unit_id=signal.unit AND device_id=signal.device_id AND kind=signal.kind
        AND closed_at IS NULL AND (opened_at<signal.good_at OR opened_at<signal.since_at);
    IF signal.bad_at IS NOT NULL AND (signal.good_at IS NULL OR signal.bad_at>signal.good_at) THEN
      INSERT INTO public.alert_episode(account_id,ownership_id,unit_id,device_id,kind,opened_at)
        VALUES(signal.account_id,signal.ownership,signal.unit,signal.device_id,signal.kind,signal.bad_at)
        ON CONFLICT (ownership_id,unit_id,device_id,kind) WHERE closed_at IS NULL DO NOTHING;
      SELECT id INTO episode FROM public.alert_episode WHERE ownership_id=signal.ownership AND unit_id=signal.unit
        AND device_id=signal.device_id AND kind=signal.kind AND closed_at IS NULL AND notified_at IS NULL
        AND (lease_until IS NULL OR lease_until<=now());
      IF episode IS NOT NULL THEN pending:=array_append(pending,episode); END IF;
    END IF;
  END LOOP;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'account_id',e.account_id,'email',au.email,
    'unit_name',u.location_label,'kind',e.kind,'opened_at',e.opened_at) ORDER BY e.opened_at,e.id)
    FROM public.alert_episode e JOIN public.unit u ON u.id=e.unit_id JOIN public.account a ON a.id=e.account_id
    JOIN auth.users au ON au.id=a.auth_user_id AND au.email_confirmed_at IS NOT NULL WHERE e.id=ANY(pending)), '[]');
END $$;

-- Recheck the live recipient when reserving a job and again immediately before SMTP DATA.
CREATE FUNCTION public.care_alert_recipient(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',e.id,'email',au.email,'kind',e.kind,'unit_name',u.location_label,'opened_at',e.opened_at)
  FROM public.alert_episode e JOIN public.alert_preference prefs ON prefs.account_id=e.account_id
  JOIN public.ownership o ON o.id=e.ownership_id AND o.account_id=e.account_id AND o.end_at IS NULL
  JOIN public.product p ON p.id=o.product_id AND p.registry_status='active'
  JOIN public.unit u ON u.id=e.unit_id AND u.product_id=p.id AND u.archived_at IS NULL
  JOIN public.account a ON a.id=prefs.account_id JOIN auth.users au ON au.id=a.auth_user_id AND au.email_confirmed_at IS NOT NULL
  WHERE e.id=p_id AND prefs.email_enabled AND e.kind=ANY(prefs.kinds)
    AND NOT EXISTS (SELECT 1 FROM public.account_deletion d WHERE d.account_id=e.account_id AND d.cancelled_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.care_unit_device(u.id,p.id,o.start_at) dev
      WHERE dev.device_id=e.device_id AND dev.since_at<=e.opened_at)
$$;
CREATE FUNCTION public.claim_alert_delivery(p_episode_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job jsonb := public.care_alert_recipient(p_episode_id);
BEGIN
  IF p_token IS NULL OR job IS NULL THEN RETURN NULL; END IF;
  UPDATE public.alert_episode SET lease_token=p_token,lease_until=clock_timestamp()+interval '5 minutes'
    WHERE id=p_episode_id AND closed_at IS NULL AND notified_at IS NULL AND (lease_until IS NULL OR lease_until<=now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN job;
END $$;
CREATE FUNCTION public.begin_alert_delivery(p_episode_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job jsonb := public.care_alert_recipient(p_episode_id);
BEGIN
  IF job IS NULL THEN RETURN NULL; END IF;
  -- SMTP has no idempotency key. After DATA could reach the relay, only a definite rejection permits automatic retry.
  UPDATE public.alert_episode SET lease_until='infinity' WHERE id=p_episode_id AND lease_token=p_token AND closed_at IS NULL
    AND notified_at IS NULL AND lease_until>clock_timestamp() AND isfinite(lease_until);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN job;
END $$;
CREATE FUNCTION public.finish_alert_delivery(p_episode_id uuid,p_token uuid,p_sent boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.alert_episode SET notified_at=CASE WHEN p_sent THEN clock_timestamp() END,lease_token=NULL,lease_until=NULL
    WHERE id=p_episode_id AND lease_token=p_token AND notified_at IS NULL AND p_sent IS NOT NULL;
  RETURN FOUND;
END $$;
-- The existing purge retains an account tombstone. Remove preferences and their episodes only after final deletion.
CREATE FUNCTION public.purge_alert_preferences() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN DELETE FROM public.alert_preference WHERE account_id=NEW.account_id; RETURN NEW; END $$;
CREATE TRIGGER purge_alert_preferences AFTER UPDATE OF purged_at ON public.account_deletion FOR EACH ROW
  WHEN (OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL) EXECUTE FUNCTION public.purge_alert_preferences();

REVOKE ALL ON FUNCTION public.my_alert_preferences(), public.set_my_alert_preferences(boolean,text[]),
  public.care_alert_signals(uuid,uuid,timestamptz,double precision), public.evaluate_alerts(),
  public.care_alert_recipient(uuid), public.claim_alert_delivery(uuid,uuid), public.begin_alert_delivery(uuid,uuid),
  public.finish_alert_delivery(uuid,uuid,boolean), public.purge_alert_preferences()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_alert_preferences(), public.set_my_alert_preferences(boolean,text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_alerts(), public.claim_alert_delivery(uuid,uuid), public.begin_alert_delivery(uuid,uuid),
  public.finish_alert_delivery(uuid,uuid,boolean) TO service_role;
