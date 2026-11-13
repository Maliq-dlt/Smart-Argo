// Read-only production checks: no accounts, product records, or telemetry are created.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const origin = 'https://smart-agro-demo.pages.dev'
const env = Object.fromEntries((await readFile('.env.cloud', 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
const backend = new URL(env.VITE_SUPABASE_URL)
assert.equal(backend.protocol, 'https:')
assert.ok(env.VITE_SUPABASE_ANON_KEY.startsWith('sb_publishable_'))
const page = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
assert.equal(page.status, 200)
const html = await page.text()
const built = await readFile('dist/index.html', 'utf8')
const assets = [...built.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1])
assert.ok(assets.length >= 2, 'Build must contain JS and CSS entry assets')
for (const asset of [...assets, './fonts/fraunces-soft.woff2', './fonts/general-sans-400.woff2']) {
  if (asset.startsWith('./assets/')) assert.ok(html.includes(asset), `Production must serve the current build: ${asset}`)
  const response = await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200, `Asset must load: ${asset}`)
  assert.ok(!response.headers.get('content-type')?.includes('text/html'), `Asset must not fall back to HTML: ${asset}`)
}
const settings = await fetch(new URL('/auth/v1/settings', backend), { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Origin: origin }, signal: AbortSignal.timeout(20000) })
assert.equal(settings.status, 200)
assert.equal((await settings.json()).external.google, true)
for (const name of ['product-claim', 'telemetry-ingest', 'unit-explanation', 'energy-ingest']) {
  for (const [requestOrigin, expectedStatus] of [[origin, 204], ['https://untrusted.invalid', 403]]) {
    const response = await fetch(new URL(`/functions/v1/${name}`, backend), { method: 'OPTIONS', headers: { Origin: requestOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' }, signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, expectedStatus, `${name}: origin policy`)
    assert.equal(response.headers.get('access-control-allow-origin'), origin, `${name}: exact production origin`)
  }
}
for (const name of ['product-claim', 'unit-explanation']) {
  const response = await fetch(new URL(`/functions/v1/${name}`, backend), { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Origin: origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 401, `${name}: unauthenticated requests must be rejected`)
}
console.log('Cloud smoke passed: current assets, fonts, hosted Auth, four CORS policies, and unauthenticated access rejection.')
