set -eu
export PGPASSWORD="$(cat /run/smart-agro/db-password)"
psql -X -v ON_ERROR_STOP=1 -c 'CREATE TABLE IF NOT EXISTS public.smart_agro_migration(name text PRIMARY KEY);'
for migration in /migrations/*.sql; do
  name="$(basename "$migration")"
  case "$name" in *[!0-9a-z_.]*) echo 'Invalid migration filename' >&2; exit 1;; esac
  applied="$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.smart_agro_migration WHERE name='$name'")"
  if [ "$applied" = 0 ]; then
    echo "Applying $name"
    { printf 'BEGIN;\n'; cat "$migration"; printf "\nINSERT INTO public.smart_agro_migration VALUES ('%s');\nCOMMIT;\n" "$name"; } | psql -X -q -v ON_ERROR_STOP=1
  fi
done
psql -X -v ON_ERROR_STOP=1 -c "ALTER TABLE public.smart_agro_migration ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.smart_agro_migration FROM PUBLIC,anon,authenticated; NOTIFY pgrst, 'reload schema';"
echo 'All application migrations are applied.'
