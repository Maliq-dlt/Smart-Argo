// Read-only production checks: no accounts, product records, or telemetry are created.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The demo by default; the live app with SMOKE_ORIGIN=https://live.smart-agro-demo.pages.dev SMOKE_DIST=dist-live.
const origin = process.env.SMOKE_ORIGIN || 'https://smart-agro-demo.pages.dev'
const dist = process.env.SMOKE_DIST || 'dist'
const env =Object.fromEntries((await readFile('.env.cloud', 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] }))
const backend = new URL(env.VITE_SUPABASE_URL)
assert.equal(backend.protocol, 'https:')
assert.ok(env.VITE_SUPABASE_ANON_KEY.startsWith('sb_publishable_'))
const built = await readFile(`${dist}/index.html`, 'utf8')
const assets = [...built.matchAll(/(?:src|href)="(\.\/assets\/[^"?]+\.(?:js|css))"/g)].map(match => match[1])
assert.ok(assets.length >= 2, 'Build must contain JS and CSS entry assets')
// The CDN can keep serving the previous index.html for a short while after a publish (this run starts seconds after it),
// so wait up to 90s for the new one before judging it.
let html = '', status = 0
for (let attempt = 0; attempt < 18; attempt++) {
  try {
    const page = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
    status = page.status; html = await page.text()
    if (status === 200 && assets.every(asset => html.includes(asset))) break
  } catch { /* one slow or dropped response (a 20 s timeout failed a deploy on 2026-11-15) counts as "not yet": try again; a page that never answers still fails the status check below */ }
  await new Promise(resolve => setTimeout(resolve, 5000))
}
assert.equal(status, 200)
for (const asset of [...assets, './fonts/fraunces-soft.woff2', './fonts/general-sans-400.woff2']) {
  if (asset.startsWith('./assets/')) assert.ok(html.includes(asset), `Production must serve the current build: ${asset}`)
  const response = await fetch(new URL(asset, origin), { signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200, `Asset must load: ${asset}`)
  assert.ok(!response.headers.get('content-type')?.includes('text/html'), `Asset must not fall back to HTML: ${asset}`)
}
const settings = await fetch(new URL('/auth/v1/settings', backend), { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Origin: origin }, signal: AbortSignal.timeout(20000) })
assert.equal(settings.status, 200)
assert.equal((await settings.json()).external.google, true)
// The real Google client, not the mock the browser tests use: Auth must hand a sign-in to accounts.google.com with a client
// id and its own callback. Consent and the callback itself still need a person (see SECURITY.md).
const google = await fetch(new URL(`/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${origin}/`)}`, backend), { redirect: 'manual', signal: AbortSignal.timeout(20000) })
assert.ok([302, 303].includes(google.status), `Google authorize must redirect, got ${google.status}`)
const consent = new URL(google.headers.get('location'))
assert.equal(consent.hostname, 'accounts.google.com')
assert.match(consent.searchParams.get('client_id') ?? '', /\.apps\.googleusercontent\.com$/)
assert.equal(consent.searchParams.get('redirect_uri'), new URL('/auth/v1/callback', backend).href)
const functions = ['product-claim', 'telemetry-ingest', 'unit-explanation', 'energy-ingest', 'history-export', 'mfa-recovery', 'product-provision', 'weather-forecast']
for (const name of functions) {
  for (const [requestOrigin, expectedStatus] of [[origin, 204], ['https://untrusted.invalid', 403]]) {
    const response = await fetch(new URL(`/functions/v1/${name}`, backend), { method: 'OPTIONS', headers: { Origin: requestOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' }, signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, expectedStatus, `${name}: origin policy for ${requestOrigin}`)
    const allowed = response.headers.get('access-control-allow-origin')
    if (expectedStatus === 204) assert.equal(allowed, origin, `${name}: names this app's origin`)
    else assert.notEqual(allowed, requestOrigin, `${name}: never names an untrusted origin`)
  }
}
for (const name of ['product-claim', 'unit-explanation', 'history-export', 'mfa-recovery', 'product-provision', 'weather-forecast']) {
  const response = await fetch(new URL(`/functions/v1/${name}`, backend), { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Origin: origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 401, `${name}: unauthenticated requests must be rejected`)
}
// A well-formed bearer that is not a session must not reach the weather provider either.
const stranger = await fetch(new URL('/functions/v1/weather-forecast', backend), { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: 'Bearer not.a.session', Origin: origin, 'Content-Type': 'application/json' }, body: '{"lat":-6.9,"lon":107.6}', signal: AbortSignal.timeout(20000) })
assert.equal(stranger.status, 401, 'weather-forecast: only a live session may ask')
console.log(`Cloud smoke passed for ${origin}: current assets, fonts, hosted Auth, the real Google client, ${functions.length} CORS policies, and unauthenticated access rejection.`)
