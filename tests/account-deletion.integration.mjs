// Account deletion with a 14-day grace period, and the profile photo (plan 2026-11-22, phase 1).
// Needs the local backend (npm run backend:local).
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const base = 'http://127.0.0.1:54321', config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = v => "'" + String(v).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
async function api(path, token, body, method = 'POST') { const r = await fetch(base + path, { method, headers: { apikey: config.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); return { status: r.status, data: await r.json().catch(() => null) } }
const rpc = (name, token, body = {}) => api('/rest/v1/rpc/' + name, token, body).then(r => r.data)
const run = randomUUID().slice(0, 8), password = randomBytes(20).toString('base64url')
async function account(label) {
  const email = `delete-${run}-${label}@example.test`, r = await api('/auth/v1/signup', null, { email, password })
  assert.equal(r.status, 200)
  const login = async () => (await api('/auth/v1/token?grant_type=password', null, { email, password })).data?.access_token
  return { email, token: r.data.access_token, user: r.data.user.id, id: (await rpc('ensure_my_account', r.data.access_token)).account.id, login }
}
const session = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).session_id
const today = new Date().toISOString().slice(0, 10)
const addSite = who => rpc('add_my_site', who.token, { p_request_id: randomUUID(), p_name: 'Pot teras', p_kind: 'pot', p_placement: 'outdoor', p_latitude: -6.9, p_longitude: 107.6, p_zones: null })
const plant = (who, slot) => rpc('plant_in_my_slot', who.token, { p_request_id: randomUUID(), p_slot_id: slot, p_species_id: 1, p_planted_on: today, p_nickname: 'Cabai kesayangan' })
const count = (table, column, id) => sql(`SELECT count(*) FROM ${table.includes('.') ? table : 'public.' + table} WHERE ${column} = ${q(id)}`)
const product = randomUUID(), serial = `DEL-${run}`.toUpperCase()
const image = (magic, size = 160) => Buffer.concat([Buffer.from(magic, 'hex'), randomBytes(size)]).toString('base64')
const png = image('89504e470d0a1a0a'), jpeg = image('ffd8ffe0')

await test('Account deletion: re-verified, signs out everywhere, can be cancelled for 14 days, then purged', async t => {
  const [a, b] = await Promise.all(['a', 'b'].map(account))
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q(serial)},'single_pot','software-test');
       INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(a.id)});`)
  const [siteA, siteB] = [await addSite(a), await addSite(b)]
  assert.equal((await plant(a, siteA.slot_ids[0])).ok, true)
  assert.equal((await plant(b, siteB.slot_ids[0])).ok, true)

  await t.test('closed to anon and to direct table access; the purge is for the service only', async () => {
    for (const name of ['my_account_deletion', 'request_account_deletion', 'cancel_account_deletion', 'my_avatar', 'set_my_avatar', 'clear_my_avatar'])
      assert((await api('/rest/v1/rpc/' + name, null, {})).status >= 400, `${name} for anon`)
    for (const table of ['account_deletion', 'account_avatar']) assert((await api('/rest/v1/' + table, a.token, undefined, 'GET')).status >= 400, table)
    assert((await api('/rest/v1/rpc/purge_due_account_deletions', a.token, {})).status >= 400, 'a user cannot run the purge')
  })

  await t.test('the confirmation step lists what the account owns', async () => {
    const r = await rpc('my_account_deletion', a.token)
    assert.equal(r.ok, true); assert.equal(r.deletion.pending, false); assert.deepEqual(r.products, [serial])
  })

  await t.test('an old sign-in must verify again', async () => {
    sql(`UPDATE auth.sessions SET created_at = now() - interval '1 hour' WHERE id = ${q(session(a.token))}`)
    assert.equal((await rpc('request_account_deletion', a.token)).code, 'reauth_required')
    assert.equal(sql(`SELECT count(*) FROM ownership WHERE account_id = ${q(a.id)} AND end_at IS NULL`), '1', 'nothing changed')
  })

  let oldToken
  await t.test('asking releases the products, cancels transfer offers and signs out every session', async () => {
    oldToken = a.token
    const second = await a.login()
    a.token = await a.login()
    sql(`INSERT INTO ownership_transfer(product_id,from_ownership_id,code_hash,expires_at)
         SELECT product_id, id, repeat('a',64), now() + interval '1 day' FROM ownership WHERE product_id = ${q(product)} AND end_at IS NULL`)
    const r = await rpc('request_account_deletion', a.token)
    assert.equal(r.ok, true); assert.equal(r.deletion.pending, true); assert.deepEqual(r.deletion.released, [serial])
    assert.equal(Date.parse(r.deletion.purge_after) - Date.parse(r.deletion.requested_at), 14 * 86400000)
    assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id = ${q(product)} AND end_at IS NULL`), '0', 'anyone may claim it now')
    assert.equal(sql(`SELECT status FROM ownership_transfer WHERE product_id = ${q(product)}`), 'cancelled')
    assert.equal(count('auth.sessions', 'user_id', a.user), '0')
    for (const token of [a.token, second, oldToken]) assert.equal((await rpc('my_garden', token)).code, 'unauthorized', 'every session is out')
    assert.equal(sql(`SELECT kind || ':' || detail FROM security_event WHERE user_id = ${q(a.user)} AND kind = 'deletion_requested'`), `deletion_requested:${serial}`)
  })

  await t.test('signing in again shows the pending deletion and nothing else', async () => {
    a.token = await a.login()
    assert.ok(a.token, 'GoTrue still signs the account in during the grace period')
    const r = await rpc('my_account_deletion', a.token)
    assert.equal(r.deletion.pending, true); assert.deepEqual(r.deletion.restorable, [serial])
    // my_products predates the error codes: it answers ok:false with nothing listed.
    for (const name of ['my_garden', 'my_products', 'ensure_my_account', 'my_avatar']) assert.equal((await rpc(name, a.token)).ok, false, name)
    assert.equal((await rpc('my_account_deletion', b.token)).deletion.pending, false, 'another account is not affected')
    assert.equal((await rpc('my_garden', b.token)).sites.length, 1)
  })

  await t.test('cancelling gives back the products nobody claimed and reopens the account', async () => {
    const r = await rpc('cancel_account_deletion', a.token)
    assert.equal(r.ok, true); assert.deepEqual(r.restored, [serial]); assert.equal(r.lost, 0)
    assert.equal((await rpc('my_garden', a.token)).sites.length, 1, 'the garden was never touched')
    assert.deepEqual((await rpc('my_products', a.token)).products.map(p => p.serial_public), [serial])
    assert.equal((await rpc('cancel_account_deletion', a.token)).code, 'no_pending_deletion')
  })

  await t.test('a product claimed by someone else during the grace period stays theirs', async () => {
    a.token = await a.login()
    assert.equal((await rpc('request_account_deletion', a.token)).ok, true)
    sql(`INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(b.id)})`)
    a.token = await a.login()
    const r = await rpc('cancel_account_deletion', a.token)
    assert.deepEqual(r.restored, []); assert.equal(r.lost, 1)
    assert.equal(sql(`SELECT account_id FROM ownership WHERE product_id = ${q(product)} AND end_at IS NULL`), b.id)
  })

  await t.test('after 14 days the purge deletes what the person wrote and the sign-in, and keeps a tombstone', async () => {
    a.token = await a.login()
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/png', p_data: png })).ok, true)
    assert.equal((await rpc('request_account_deletion', a.token)).ok, true)
    assert.equal((await rpc('purge_due_account_deletions', config.service, { p_limit: 50 })).ok, true)
    assert.equal(count('garden_site', 'account_id', a.id), '1', 'not before the grace period ends')
    sql(`UPDATE account_deletion SET requested_at = requested_at - interval '15 days', purge_after = purge_after - interval '15 days' WHERE account_id = ${q(a.id)}`)
    const r = await rpc('purge_due_account_deletions', config.service, { p_limit: 50 })
    assert.equal(r.ok, true); assert.ok(r.purged >= 1)
    for (const [table, column] of [['garden_site', 'account_id'], ['garden_slot', 'account_id'], ['plant_cycle', 'account_id'], ['account_avatar', 'account_id']])
      assert.equal(count(table, column, a.id), '0', table)
    assert.equal(count('security_event', 'user_id', a.user), '0')
    assert.equal(count('auth.users', 'id', a.user), '0', 'the email and sign-in are gone')
    assert.equal(sql(`SELECT display_name || '|' || coalesce(auth_user_id::text,'') FROM account WHERE id = ${q(a.id)}`), 'Akun dihapus|')
    assert.equal(sql(`SELECT count(*) FROM ownership WHERE account_id = ${q(a.id)}`), '2', 'ownership history (first and restored) keeps the tombstone id')
    assert.equal(sql(`SELECT purged_at IS NOT NULL FROM account_deletion WHERE account_id = ${q(a.id)}`), 't')
    assert.equal(await a.login(), undefined, 'cannot sign in any more')
    assert.equal((await rpc('my_garden', b.token)).sites.length, 1, 'the other account keeps its garden')
    assert.equal(count('plant_cycle', 'account_id', b.id), '1')
  })

  await t.test('only a purge may delete a plant cycle', () => {
    assert.throws(() => sql(`DELETE FROM plant_cycle WHERE account_id = ${q(b.id)}`), /never deleted/)
  })
})

await test('Profile photo: one small image of the type it claims, readable by its owner only', async t => {
  const [a, b] = await Promise.all(['photo-a', 'photo-b'].map(account))
  await t.test('stored and read back unchanged', async () => {
    assert.equal((await rpc('my_avatar', a.token)).avatar, null)
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/png', p_data: png })).ok, true)
    const r = await rpc('my_avatar', a.token)
    assert.equal(r.avatar.mime, 'image/png'); assert.equal(r.avatar.data, png)
    assert.equal((await rpc('my_avatar', b.token)).avatar, null, 'nobody else sees it')
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/jpeg', p_data: jpeg })).ok, true, 'replacing keeps one row')
    assert.equal(count('account_avatar', 'account_id', a.id), '1')
  })
  await t.test('refuses a wrong type, a lie about the type, a broken encoding and a large file', async () => {
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/gif', p_data: png })).code, 'invalid_image')
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/webp', p_data: png })).code, 'invalid_image')
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/png', p_data: '***' })).code, 'invalid_image')
    assert.equal((await rpc('set_my_avatar', a.token, { p_mime: 'image/png', p_data: image('89504e470d0a1a0a', 262200) })).code, 'avatar_too_large')
    assert.equal((await rpc('my_avatar', a.token)).avatar.mime, 'image/jpeg', 'the last good photo stays')
  })
  await t.test('removing it leaves the initials', async () => {
    assert.equal((await rpc('clear_my_avatar', a.token)).ok, true)
    assert.equal((await rpc('my_avatar', a.token)).avatar, null)
  })
})
