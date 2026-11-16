-- Community moisture bands are published to the nearest 5 points instead of the nearest point. A low-cost soil probe cannot tell
-- 47 from 49 apart, so a whole-number band claimed more than the plants measured; and with an odd number of plants the median
-- was one contributor's own number. Watering intervals stay at half a day and the counts stay exact: how many plants and owners
-- stand behind a zone is what lets a reader judge it. Only the final rounding differs from 20261115110000.
CREATE OR REPLACE FUNCTION public.community_knowledge(p_species_id integer) RETURNS jsonb
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
      'moisture',jsonb_build_object('low',(round(lo50 / 5) * 5)::integer,'high',(round(hi50 / 5) * 5)::integer)) ORDER BY zone), '[]'::jsonb) INTO zones FROM enough;
  RETURN jsonb_build_object('ok',true,'label','belum dikurasi','source','komunitas','species_id',p_species_id,'zones',zones);
END $$;
