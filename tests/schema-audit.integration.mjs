// Schema-wide guard: whatever a future migration adds, the browser roles get no table they were not meant to have.
// On the hosted project Supabase's default privileges grant anon and authenticated everything on a new table in `public`,
// so a migration that forgets its REVOKE (or its ENABLE ROW LEVEL SECURITY) fails here instead of shipping.
// Runs against the local database; the same queries can be pointed at the hosted one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const list = text => text ? text.split('\n').filter(Boolean).sort() : []
const TABLES = `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`

// Each query lists offenders, one per line; an empty answer is a clean schema.
const AUDIT = {
  noRls: `SELECT c.relname ${TABLES} AND NOT c.relrowsecurity`,
  anon: `SELECT c.relname || ':' || p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND has_table_privilege('anon', c.oid, p)`,
  authenticatedWrites: `SELECT c.relname || ':' || p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
    unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_table_privilege('authenticated', c.oid, p)`,
  readableWithoutPolicy: `SELECT c.relname ${TABLES} AND has_table_privilege('authenticated', c.oid, 'SELECT')
    AND NOT EXISTS (SELECT 1 FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = c.relname
      AND pp.cmd IN ('SELECT', 'ALL') AND pp.roles && ARRAY['authenticated', 'public']::name[])`,
  definerViews: `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)`,
  // Functions that belong to an extension (pgcrypto sits in public locally) carry no data and are left out.
  anonFunctions: `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`,
}

test('every table in public has row-level security on', () => {
  assert.ok(Number(sql(`SELECT count(*) ${TABLES}`)) > 0, 'the audit must see the tables')
  assert.deepEqual(list(sql(AUDIT.noRls)), [])
})

test('anon holds no privilege on any table or view in public', () => {
  assert.deepEqual(list(sql(AUDIT.anon)), [])
})

test('authenticated only reads, and only tables whose SELECT policy decides which rows', () => {
  assert.deepEqual(list(sql(AUDIT.authenticatedWrites)), [], 'writes go through SECURITY DEFINER functions, never straight into a table')
  assert.deepEqual(list(sql(AUDIT.readableWithoutPolicy)), [], 'every table authenticated may read has a SELECT policy')
})

test('no view in public bypasses the row-level security of the tables under it', () => {
  assert.deepEqual(list(sql(AUDIT.definerViews)), [])
})

test('anon may run exactly one function of ours: the public registry status of a serial', () => {
  assert.deepEqual(list(sql(AUDIT.anonFunctions)), ['product_public_status'])
})

test('the audit catches a table made the careless way: default grants, no row-level security, a definer view', () => {
  // Made inside a transaction that is rolled back, exactly as Supabase's default privileges would leave it.
  const run = query => sql(`BEGIN;
    CREATE TABLE public.audit_probe (id int);
    GRANT ALL ON public.audit_probe TO anon, authenticated;
    CREATE VIEW public.audit_probe_view AS SELECT id FROM public.audit_probe;
    CREATE FUNCTION public.audit_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
    ${query};
    ROLLBACK;`)
  assert.deepEqual(list(run(AUDIT.noRls)), ['audit_probe'])
  assert.ok(list(run(AUDIT.anon)).includes('audit_probe:INSERT'))
  assert.ok(list(run(AUDIT.authenticatedWrites)).includes('audit_probe:DELETE'))
  assert.deepEqual(list(run(AUDIT.readableWithoutPolicy)), ['audit_probe'])
  assert.deepEqual(list(run(AUDIT.definerViews)), ['audit_probe_view'])
  assert.deepEqual(list(run(AUDIT.anonFunctions)), ['audit_probe_fn', 'product_public_status'], 'new functions are executable by PUBLIC unless revoked')
})
