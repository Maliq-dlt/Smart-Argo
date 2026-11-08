import { startGateway } from './backend-gateway.mjs'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

process.chdir(fileURLToPath(new URL('..', import.meta.url)))
await mkdir('.tmp/phase1', { recursive: true })
let settings
try { settings = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  const secret = randomBytes(48).toString('hex')
  const token = role => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000) + 31536000 })).toString('base64url')
    const data = `${header}.${payload}`
    return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`
  }
  settings = { password: randomBytes(32).toString('hex'), secret, anon: token('anon'), service: token('service_role') }
  await writeFile('.tmp/phase1/settings.json', JSON.stringify(settings))
}
await writeFile('.tmp/phase1/compose.env', `PHASE1_DB_PASSWORD=${settings.password}\nPHASE1_JWT_SECRET=${settings.secret}\n`)
process.env.PHASE1_DB_PASSWORD = settings.password
process.env.PHASE1_JWT_SECRET = settings.secret
const compose = ['compose', '-p', 'smart-agro-phase1', '-f', 'supabase/compose.phase1.yml']
function docker(args, input) {
  const result = spawnSync('docker', [...compose, ...args], { input, encoding: 'utf8', maxBuffer: 4*1024*1024 })
  if (result.status !== 0) throw new Error(`Docker failed: ${result.stderr || result.error?.message || 'unknown'}`)
  return result.stdout
}
async function ready(url) {
  for(let i=0;i<60;i++) {
    try { if ((await fetch(url, {signal:AbortSignal.timeout(2000)})).ok) return } catch { /* starting */ }
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  throw new Error(`Service did not become ready: ${url}`)
}
console.log('Starting local PostgreSQL, Supabase Auth and PostgREST...')
docker(['up', '-d', '--wait', '--wait-timeout', '120'])
await ready('http://127.0.0.1:54324/health')
const psql = sql => docker(['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'], sql)
psql('CREATE TABLE IF NOT EXISTS public.smart_agro_migration(name text PRIMARY KEY);')
for (const name of (await readdir('supabase/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
  if (psql(`SELECT count(*) FROM public.smart_agro_migration WHERE name='${name}';`).trim() === '0') {
    const sql = await readFile(`supabase/migrations/${name}`, 'utf8')
    psql(`BEGIN;\n${sql}\nINSERT INTO public.smart_agro_migration VALUES ('${name}'); COMMIT;`)
  }
}
psql("ALTER TABLE public.smart_agro_migration ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.smart_agro_migration FROM PUBLIC,anon,authenticated; NOTIFY pgrst, 'reload schema';")
await ready('http://127.0.0.1:54325/')
const browserEnv = `VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_ANON_KEY=${settings.anon}\n`
await writeFile('.tmp/phase1/browser.env', browserEnv)
try { await access('.env.local') } catch { await writeFile('.env.local', browserEnv) }
const server = startGateway({settings, appOrigin:'http://127.0.0.1:5173', extraOrigins:['http://127.0.0.1:4178']})
process.on('SIGINT',()=>server.close(()=>process.exit(0)))
