// ID-01 public status and ID-03 ownership transfer against the local stack (`npm run backend:local`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { enableTotp, totp } from './totp.mjs'
const base = 'http://127.0.0.1:54321', config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = v => "'" + String(v).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8' }).trim()
async function api(path, token, body, method = 'POST') { const r = await fetch(base + path, { method, headers: { apikey: config.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); return { status: r.status, data: await r.json().catch(() => null) } }
const rpc = (name, token, body = {}) => api('/rest/v1/rpc/' + name, token, body).then(r => r.data)
const run = randomUUID().slice(0, 8), password = randomBytes(20).toString('base64url')
async function account(label) {
  const email = `transfer-${run}-${label}@example.test`, r = await api('/auth/v1/signup', null, { email, password })
  const login = async () => (await api('/auth/v1/token?grant_type=password', null, { email, password })).data.access_token
  return { token: r.data.access_token, id: (await rpc('ensure_my_account', r.data.access_token)).account.id, login }
}
const session = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).session_id
const serial = `XFER-${run}`.toUpperCase(), product = randomUUID()

await test('ID-01 and ID-03: public status, re-authenticated one-time transfer', async t => {
  const [a, b, c, d] = await Promise.all(['a', 'b', 'c', 'd'].map(account))
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q(serial)},'single_pot','software-test'); INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(a.id)});`)
  const owned = async token => (await rpc('my_products', token)).products.map(p => p.serial_public)

  await t.test('anyone can read registry status and claim state, never the owner', async () => {
    const r = await rpc('product_public_status', null, { p_serial: ` ${serial.toLowerCase()} ` })
    assert.deepEqual(r, { ok: true, serial_public: serial, variant: 'single_pot', registry_status: 'active', claimed: true })
    assert.equal((await rpc('product_public_status', null, { p_serial: 'NOPE-' + run })).code, 'not_registered')
    assert((await api('/rest/v1/ownership_transfer', a.token, undefined, 'GET')).status >= 400, 'No direct table access')
  })

  let offer
  await t.test('an old session must sign in again; a fresh one gets a one-time code', async () => {
    sql(`UPDATE auth.sessions SET created_at = now() - interval '1 hour' WHERE id = ${q(session(a.token))}`)
    assert.equal((await rpc('create_transfer_offer', a.token, { p_product_id: product })).code, 'reauth_required')
    a.token = await a.login()
    offer = await rpc('create_transfer_offer', a.token, { p_product_id: product })
    assert.equal(offer.ok, true); assert.match(offer.code, /^[0-9A-F]{32}$/)
    assert.equal(sql(`SELECT count(*) FROM ownership_transfer WHERE code_hash = ${q(offer.code)}`), '0', 'Only the hash is stored')
    assert.equal((await rpc('create_transfer_offer', b.token, { p_product_id: product })).code, 'not_owner')
  })

  await t.test('no password (Google): a fresh authenticator code confirms an old session, a stale one does not', async () => {
    const e = await account('e'), own = randomUUID()
    sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(own)},${q(serial + '-G')},'single_pot','software-test'); INSERT INTO ownership(product_id,account_id) VALUES(${q(own)},${q(e.id)});`)
    const { factor, secret, token } = await enableTotp(base, config.anon, e.token)
    // Turning 2FA on is a security change: like redemptions, transfers wait 24 hours, so an intruder cannot change keys and move the pot at once.
    const hold = await rpc('create_transfer_offer', token, { p_product_id: own })
    assert.equal(hold.code, 'security_hold')
    assert(new Date(hold.until) > new Date(Date.now() + 23 * 3600e3), 'Hold lasts about a day')
    sql(`UPDATE security_event SET created_at = created_at - interval '25 hours' WHERE user_id = ${q(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub)}`)
    sql(`UPDATE auth.sessions SET created_at = now() - interval '1 hour' WHERE id = ${q(session(token))}`)
    const verify = async () => { const ch = (await api(`/auth/v1/factors/${factor}/challenge`, token, {})).data; return (await api(`/auth/v1/factors/${factor}/verify`, token, { challenge_id: ch.id, code: totp(secret) })).data }
    // Verify, age that code's claim, then refresh: the newly signed JWT carries the old `amr` timestamp.
    const { refresh_token } = await verify()
    sql(`UPDATE auth.mfa_amr_claims SET updated_at = now() - interval '10 minutes' WHERE session_id = ${q(session(token))} AND authentication_method = 'totp'`)
    // With 2FA on, a password-only sign-in (aal1) is fresh enough for the ten-minute rule but fails the session check.
    assert.equal((await rpc('create_transfer_offer', await e.login(), { p_product_id: own })).code, 'unauthorized')
    const stale = (await api('/auth/v1/token?grant_type=refresh_token', null, { refresh_token })).data.access_token
    assert.equal((await rpc('create_transfer_offer', stale, { p_product_id: own })).code, 'reauth_required')
    const fresh = await verify()
    assert.equal((await rpc('create_transfer_offer', fresh.access_token, { p_product_id: own })).ok, true)
  })

  await t.test('wrong codes count; the right code moves ownership atomically and once', async () => {
    assert.equal((await rpc('accept_transfer', b.token, { p_serial: serial, p_code: '0'.repeat(32) })).code, 'invalid_code')
    assert.equal((await rpc('accept_transfer', a.token, { p_serial: serial, p_code: offer.code })).code, 'self_transfer')
    const grouped = offer.code.toLowerCase().match(/.{4}/g).join('-')
    const ok = await rpc('accept_transfer', b.token, { p_serial: serial, p_code: grouped })
    assert.equal(ok.ok, true); assert.equal(ok.idempotent, false)
    assert.equal((await rpc('accept_transfer', b.token, { p_serial: serial, p_code: grouped })).idempotent, true)
    assert.deepEqual(await owned(a.token), []); assert.deepEqual(await owned(b.token), [serial])
    assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id = ${q(product)} AND end_at IS NULL`), '1')
    assert.equal(sql(`SELECT count(*) FROM outbox_job WHERE kind = 'ownership_transfer' AND event_key = 'transfer:' || (SELECT id FROM ownership_transfer WHERE product_id = ${q(product)} AND status = 'accepted')::text`), '1')
    assert.equal((await rpc('create_transfer_offer', a.token, { p_product_id: product })).code, 'not_owner', 'The previous owner lost control')
  })

  await t.test('two recipients at once: exactly one owner', async () => {
    const code = (await rpc('create_transfer_offer', b.token, { p_product_id: product })).code
    const results = await Promise.all([c, d].map(x => rpc('accept_transfer', x.token, { p_serial: serial, p_code: code })))
    assert.equal(results.filter(r => r.ok).length, 1)
    assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id = ${q(product)} AND end_at IS NULL`), '1')
  })

  await t.test('five wrong attempts, expiry and cancellation close the code', async () => {
    const owner = (await owned(c.token)).length ? c : d, other = owner === c ? b : c
    owner.token = await owner.login()
    let code = (await rpc('create_transfer_offer', owner.token, { p_product_id: product })).code
    for (let i = 0; i < 5; i++) await rpc('accept_transfer', other.token, { p_serial: serial, p_code: 'F'.repeat(32) })
    assert.equal((await rpc('accept_transfer', other.token, { p_serial: serial, p_code: code })).code, 'transfer_unavailable')
    code = (await rpc('create_transfer_offer', owner.token, { p_product_id: product })).code
    sql(`UPDATE ownership_transfer SET expires_at = now() - interval '1 minute' WHERE product_id = ${q(product)} AND status = 'open'`)
    assert.equal((await rpc('accept_transfer', other.token, { p_serial: serial, p_code: code })).code, 'transfer_unavailable')
    code = (await rpc('create_transfer_offer', owner.token, { p_product_id: product })).code
    assert.equal((await rpc('cancel_transfer_offer', owner.token, { p_product_id: product })).cancelled, true)
    assert.equal((await rpc('accept_transfer', other.token, { p_serial: serial, p_code: code })).code, 'transfer_unavailable')
    assert.deepEqual(await owned(owner.token), [serial])
  })
})
