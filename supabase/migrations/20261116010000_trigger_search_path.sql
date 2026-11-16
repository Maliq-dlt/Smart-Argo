-- Two trigger functions were the only ones in public without a fixed search_path (hosted security advisor, lint 0011). Neither
-- names a table or function, so pinning the path changes nothing they do; it only stops a caller's path from ever mattering.
ALTER FUNCTION public.plant_cycle_guard() SET search_path = pg_catalog, public;
ALTER FUNCTION public.reward_case_event_immutable() SET search_path = pg_catalog, public;
