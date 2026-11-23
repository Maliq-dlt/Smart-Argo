// Community knowledge (Fase 7, inactive until live mode and the hosted release): sharing is a choice per slot, only a plant that grew
// well for long enough can be shared, what others read is an aggregate behind a threshold of different owners and plants, and nothing
// that identifies anyone ever comes back. Needs the local backend (npm run backend:local).
//
// SYNTHETIC DATA: every account, site, plant and number below is made up by this test (accounts are community-<run>-*@example.test,
// watering intervals and moisture bands are invented). Nothing here describes how any real plant is cared for. Each scenario uses its
// own climate zone as a separate bucket, so the scenarios do not see each other's plants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { enableTotp } from './totp.mjs'
const base = 'http://127.0.0.1:54321', config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = v => "'" + String(v).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const sqlFails = (input, pattern) => { try { sql(input) } catch (error) { assert.match(String(error.stderr), pattern); return } assert.fail(`The statement was accepted: ${input}`) }
async function api(path, token, body, method = 'POST') { const r = await fetch(base + path, { method, headers: { Connection: 'close', apikey: config.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }); return { status: r.status, data: await r.json().catch(() => null) } }
const rpc = (name, token, body = {}) => api('/rest/v1/rpc/' + name, token, body).then(r => r.data)
const run = randomUUID().slice(0, 8), password = randomBytes(20).toString('base64url')
const seen = { accounts: [], slots: [], cycles: [] }
async function account(label, roles) {
  const r = await api('/auth/v1/signup', null, { email: `community-${run}-${label}@example.test`, password }); assert.equal(r.status, 200)
  const made = await rpc('ensure_my_account', r.data.access_token); assert.equal(made.ok, true)
  if (roles) sql(`UPDATE account SET access_roles = ARRAY[${roles.map(q).join(',')}]::text[] WHERE id = ${q(made.account.id)}`)
  seen.accounts.push(made.account.id)
  return { token: r.data.access_token, id: made.account.id }
}
const today = new Date().toISOString().slice(0, 10)
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const addSite = (who, patch = {}) => rpc('add_my_site', who.token, { p_request_id: randomUUID(), p_name: 'Pot', p_kind: 'pot', p_placement: 'outdoor', p_latitude: null, p_longitude: null, p_zones: null, ...patch })
const plant = (who, slot, patch = {}) => rpc('plant_in_my_slot', who.token, { p_request_id: randomUUID(), p_slot_id: slot, p_species_id: 3, p_planted_on: today, p_nickname: null, ...patch })
const swap = (who, slot, patch = {}) => rpc('switch_my_plant', who.token, { p_request_id: randomUUID(), p_slot_id: slot, p_species_id: 1, p_on: today, p_outcome: 'berhasil', p_nickname: null, ...patch })
const mine = who => rpc('my_garden', who.token)
const setSharing = (who, slot, on) => rpc('set_slot_sharing', who.token, { p_slot_id: slot, p_share: on })
const share = (who, cycle, patch = {}) => rpc('share_my_cycle', who.token, { p_request_id: randomUUID(), p_cycle_id: cycle, p_watering_interval_days: 5, p_moisture_low: 35, p_moisture_high: 60, ...patch })
const knowledge = (who, species = 3) => rpc('community_knowledge', who.token, { p_species_id: species })
const zoneOf = (result, name) => result.zones.find(z => z.zone === name)
// The server's own clock decides how long it has known a plant, and an owner cannot move it. The test moves it to say "this plant was
// added a month and a half ago", with triggers off for this one statement.
const age = id => sql(`SET session_replication_role = replica; UPDATE plant_cycle SET created_at = clock_timestamp() - interval '45 days' WHERE id = ${q(id)}`)

// One finished plant of species 3 in a site of its own (so one slot, one cycle), by default a success of 40 days in the tropics that
// the server has known for 45 days and whose slot has sharing on. The plant that replaces it is a chili growing on.
async function finished(owner, o = {}) {
  const { placement = 'outdoor', lat = -6.2, days = 40, outcome = 'berhasil', species = 3, sharing = true, aged = true } = o
  const place = placement !== 'indoor' && lat !== null
  const site = await addSite(owner, { p_name: `Pot ${randomUUID().slice(0, 6)}`, p_placement: placement, p_latitude: place ? lat : null, p_longitude: place ? 106.8 : null })
  assert.equal(site.ok, true, JSON.stringify(site))
  const slot = site.slot_ids[0]
  if (sharing) assert.equal((await setSharing(owner, slot, true)).ok, true)
  const planted = await plant(owner, slot, { p_species_id: species, p_planted_on: daysAgo(days) })
  assert.equal(planted.ok, true, JSON.stringify(planted))
  const ended = await swap(owner, slot, { p_outcome: outcome })
  assert.equal(ended.ok, true, JSON.stringify(ended))
  if (aged) age(planted.cycle.id)
  seen.slots.push(slot); seen.cycles.push(planted.cycle.id)
  return { cycle: planted.cycle.id, slot }
}
// A finished plant that is shared at once, with the numbers given.
async function shared(owner, o = {}, numbers = {}) {
  const f = await finished(owner, o)
  const r = await share(owner, f.cycle, numbers)
  assert.equal(r.ok, true, JSON.stringify(r))
  return { ...f, contribution: r.contribution_id }
}
const W = w => ({ p_watering_interval_days: w })

sql(`DELETE FROM community_contribution WHERE account_id IN (SELECT a.id FROM account a JOIN auth.users u ON u.id = a.auth_user_id WHERE u.email LIKE 'community-%@example.test')`)

await test('Community knowledge: shared by choice, anonymous, behind a threshold, and never about one person', async t => {
  const [stranger, owner] = await Promise.all([account('stranger'), account('owner')])

  await t.test('the table is closed and every function needs a signed-in user', async () => {
    for (const name of ['set_slot_sharing', 'share_my_cycle', 'unshare_my_cycle', 'community_knowledge', 'review_community_contributions', 'set_community_exclusion'])
      assert((await api('/rest/v1/rpc/' + name, null, {})).status >= 400, `${name} for anon`)
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert((await api('/rest/v1/community_contribution', owner.token, method === 'GET' ? undefined : { zone: 'tropis' }, method)).status >= 400, `${method} on the table`)
    sqlFails('SET ROLE authenticated; SELECT * FROM public.community_contribution', /permission denied/)
    sqlFails('SET ROLE anon; SELECT * FROM public.community_contribution', /permission denied/)
    sqlFails('SET ROLE authenticated; SELECT * FROM public.community_rules()', /permission denied/)
    sqlFails("SET ROLE authenticated; SELECT public.climate_zone('outdoor', 1)", /permission denied/)
    assert((await api('/rest/v1/rpc/community_knowledge', owner.token, { p_species_id: 3, p_account_id: stranger.id })).status >= 400, 'a spoofed account argument is not accepted')
    assert.equal((await knowledge(owner, 999)).code, 'invalid_request'); assert.equal((await knowledge(owner, null)).code, 'invalid_request')
  })

  await t.test('the rules are the ones the design says, and the zone is only a band of latitude', async () => {
    assert.equal(sql('SELECT min_cycle_days, min_age_days, min_cycles, min_owners, owner_cap FROM public.community_rules()'), '30|30|5|3|2')
    const zones = [['indoor', 10, 'dalam_ruangan'], ['indoor', null, 'dalam_ruangan'], ['outdoor', null, 'tanpa_lokasi'], ['outdoor', -6.2, 'tropis'], ['rooftop', 23.5, 'tropis'], ['outdoor', 23.51, 'subtropis'],
      ['outdoor', -35, 'subtropis'], ['outdoor', 35.01, 'sedang'], ['outdoor', 60, 'sedang'], ['outdoor', 60.01, 'dingin'], ['outdoor', -89, 'dingin']]
    for (const [placement, latitude, zone] of zones) assert.equal(sql(`SELECT public.climate_zone(${q(placement)}, ${latitude === null ? 'NULL' : latitude})`), zone, `${placement} ${latitude}`)
  })

  await t.test('only a finished, successful, long and well-known plant of a slot that is opted in can be shared, once', async () => {
    const sharer = await account('sharer'), other = await account('other')
    // Not finished.
    const site = await addSite(sharer, { p_name: 'Masih tumbuh', p_latitude: -6.2, p_longitude: 106.8 })
    await setSharing(sharer, site.slot_ids[0], true)
    const growing = await plant(sharer, site.slot_ids[0], { p_planted_on: daysAgo(40) })
    seen.slots.push(site.slot_ids[0]); seen.cycles.push(growing.cycle.id)
    assert.equal((await share(sharer, growing.cycle.id)).code, 'state_conflict')
    // Sharing off.
    const off = await finished(sharer, { sharing: false })
    assert.equal((await share(sharer, off.cycle)).code, 'not_opted_in')
    // Not a success, too short, too new to the server (the planting date can be backdated, the server's own clock cannot).
    for (const outcome of ['gagal', 'dihentikan']) assert.match((await share(sharer, (await finished(sharer, { outcome })).cycle)).message, /grew well/, outcome)
    const short = await share(sharer, (await finished(sharer, { days: 10 })).cycle)
    assert.equal(short.code, 'not_eligible'); assert.match(short.message, /too short/)
    const recent = await share(sharer, (await finished(sharer, { aged: false })).cycle)
    assert.equal(recent.code, 'not_eligible'); assert.match(recent.message, /too recently/)
    // Someone else's plant.
    const good = await finished(sharer)
    assert.equal((await share(other, good.cycle)).code, 'cycle_unavailable')
    assert.equal((await rpc('unshare_my_cycle', other.token, { p_cycle_id: good.cycle })).code, 'cycle_unavailable')
    assert.equal((await setSharing(other, good.slot, true)).code, 'slot_unavailable')
    // Numbers that make no sense.
    for (const patch of [{ p_watering_interval_days: 0.4 }, { p_watering_interval_days: 60.1 }, { p_watering_interval_days: null }, { p_moisture_low: null }, { p_moisture_high: null }, { p_moisture_high: 101 },
      { p_moisture_low: -1 }, { p_moisture_low: 50, p_moisture_high: 50 }, { p_moisture_low: 60, p_moisture_high: 35 }, { p_request_id: null }, { p_cycle_id: null }])
      assert.equal((await share(sharer, good.cycle, patch)).code, 'invalid_request', JSON.stringify(patch))
    assert.equal((await rpc('set_slot_sharing', sharer.token, { p_slot_id: good.slot, p_share: null })).code, 'invalid_request')
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE account_id = ${q(sharer.id)}`), '0', 'nothing was shared by all of that')

    // The good one, with numbers rounded the way they are stored.
    const request = randomUUID()
    const first = await share(sharer, good.cycle, { p_request_id: request, p_watering_interval_days: 5.26, p_moisture_low: 34.6, p_moisture_high: 60.2 })
    assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.zone, 'tropis'); assert.equal(first.idempotent, false)
    assert.equal(sql(`SELECT zone, duration_days, watering_interval_days, moisture_low, moisture_high FROM community_contribution WHERE cycle_id = ${q(good.cycle)}`), 'tropis|40|5.3|35|60')
    const again = await share(sharer, good.cycle, { p_request_id: request, p_watering_interval_days: 5.26, p_moisture_low: 34.6, p_moisture_high: 60.2 })
    assert.deepEqual([again.ok, again.idempotent, again.contribution_id], [true, true, first.contribution_id])
    assert.equal((await share(sharer, good.cycle, { p_request_id: request, p_watering_interval_days: 9 })).code, 'request_conflict')
    assert.equal((await share(sharer, good.cycle)).code, 'state_conflict', 'a plant is shared once')
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE cycle_id = ${q(good.cycle)}`), '1')
    const garden = await mine(sharer)
    assert.equal(garden.cycles.find(c => c.id === good.cycle).shared, true); assert.equal(garden.slots.find(s => s.id === good.slot).share, true)
    assert.equal((await mine(other)).cycles.length, 0, 'and another person sees nothing of it')

    // Taking it back, and sharing it again.
    assert.equal((await rpc('unshare_my_cycle', sharer.token, { p_cycle_id: good.cycle })).withdrawn, 1)
    assert.equal((await rpc('unshare_my_cycle', sharer.token, { p_cycle_id: good.cycle })).withdrawn, 0)
    assert.equal((await mine(sharer)).cycles.find(c => c.id === good.cycle).shared, false)
    assert.equal((await share(sharer, good.cycle)).ok, true)
    // Leave nothing behind in the tropics: the scenarios below count what is shared there.
    assert.equal((await rpc('unshare_my_cycle', sharer.token, { p_cycle_id: good.cycle })).withdrawn, 1)
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE account_id = ${q(sharer.id)}`), '0')
  })

  await t.test('below the threshold nothing is shown, not even a count; at it, the middle of what was shared is', async () => {
    const [o1, o2, o3] = await Promise.all([account('t-a'), account('t-b'), account('t-c')])
    // Two owners with two plants each: four plants and two owners, below both.
    for (const [who, w] of [[o1, 4], [o1, 5], [o2, 4.5], [o2, 5.5]]) await shared(who, {}, { ...W(w), p_moisture_low: w === 4 ? 30 : w === 5 ? 35 : w === 4.5 ? 32 : 36, p_moisture_high: w === 4 ? 55 : w === 5 ? 60 : w === 4.5 ? 58 : 62 })
    assert.equal(zoneOf(await knowledge(stranger), 'tropis'), undefined)
    // Five plants but only two owners would still not do; the third owner is what makes it.
    await shared(o3, {}, { ...W(6), p_moisture_low: 34, p_moisture_high: 57 })
    const released = await knowledge(stranger), tropics = zoneOf(released, 'tropis')
    assert.deepEqual([released.ok, released.label, released.source, released.species_id], [true, 'belum dikurasi', 'komunitas', 3])
    // The middle moisture band is 34 to 58; it is published to the nearest 5 points, about what a soil probe can tell apart, so
    // it no longer equals any one plant's whole-number band (the plant with 34 and 57 is not readable from the result).
    assert.deepEqual(tropics, { zone: 'tropis', cycles: 5, owners: 3, watering_interval_days: { low: 4.5, median: 5, high: 5.5 }, moisture: { low: 35, high: 60 } })
    assert.equal(zoneOf(released, 'sedang'), undefined, 'a zone with nothing in it is not listed')
    assert.deepEqual((await knowledge(stranger, 4)).zones, [], 'and another species has nothing')
    assert.deepEqual(await knowledge(owner), released, 'everybody reads the same thing')
  })

  await t.test('one owner counts for two plants a zone however many they share, so many plants of one person never make a result', async () => {
    const [s, p, r] = await Promise.all([account('c-single'), account('c-second'), account('c-third')])
    for (let i = 0; i < 6; i++) await shared(s, { lat: 30 })
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE account_id = ${q(s.id)}`), '6')
    assert.equal(zoneOf(await knowledge(stranger), 'subtropis'), undefined, 'six plants, one owner')
    for (let i = 0; i < 2; i++) await shared(p, { lat: 30 })
    assert.equal(zoneOf(await knowledge(stranger), 'subtropis'), undefined, 'two owners, however many plants')
    await shared(r, { lat: 30 })
    const zone = zoneOf(await knowledge(stranger), 'subtropis')
    assert.deepEqual([zone.cycles, zone.owners], [5, 3], 'nine plants shared, five counted: two of the first owner, two of the second, one of the third')
  })

  await t.test('a plant far outside the rest is trimmed, and trimming cannot leave a result on fewer plants than the threshold', async () => {
    const owners = await Promise.all(['a', 'b', 'c', 'd'].map(l => account('x-' + l)))
    // Seven plants, three owners with two each and a fourth with one that is wildly different.
    for (const [who, w] of [[owners[0], 5], [owners[0], 6], [owners[1], 4], [owners[1], 5], [owners[2], 5.5], [owners[2], 4.5], [owners[3], 60]]) await shared(who, { lat: 45 }, W(w))
    const zone = zoneOf(await knowledge(stranger), 'sedang')
    assert.deepEqual([zone.cycles, zone.owners, zone.watering_interval_days], [6, 3, { low: 4.5, median: 5, high: 5.5 }], 'the outlier is gone from the count and from the numbers')
    // The same in another zone, but with only five plants to start with: four are left after trimming, which is not enough.
    const [d1, d2, d3, d4] = await Promise.all(['a', 'b', 'c', 'd'].map(l => account('y-' + l)))
    for (const [who, w] of [[d1, 5], [d1, 5], [d2, 5], [d2, 5], [d3, 60]]) await shared(who, { lat: 70 }, W(w))
    assert.equal(zoneOf(await knowledge(stranger), 'dingin'), undefined, 'five shared, four usable: withheld')
    await shared(d4, { lat: 70 }, W(5))
    const zone2 = zoneOf(await knowledge(stranger), 'dingin')
    assert.deepEqual([zone2.cycles, zone2.owners, zone2.watering_interval_days.median], [5, 3, 5])
  })

  const curatorPlain = await account('curator-plain', ['owner', 'curator'])
  let curator = await account('curator', ['owner', 'curator'])
  curator.token = (await enableTotp(base, config.anon, curator.token)).token

  await t.test('a curator can leave one plant out and put it back, and nobody else can', async () => {
    const [c1, c2, c3] = await Promise.all([account('k-a'), account('k-b'), account('k-c')])
    const made = []
    for (const [who, w] of [[c1, 4], [c1, 4.5], [c2, 5], [c2, 5.5], [c3, 6]]) made.push(await shared(who, { placement: 'indoor' }, W(w)))
    const room = r => zoneOf(r, 'dalam_ruangan')
    assert.equal(room(await knowledge(stranger)).cycles, 5)
    const target = made[2].contribution

    // Not a curator, or a curator without a verified authenticator.
    for (const who of [stranger, owner, c1]) {
      assert.equal((await rpc('review_community_contributions', who.token, { p_species_id: 3 })).code, 'forbidden')
      assert.equal((await rpc('set_community_exclusion', who.token, { p_contribution_id: target, p_excluded: true, p_reason: 'No.' })).code, 'forbidden')
    }
    assert.equal((await rpc('review_community_contributions', curatorPlain.token, { p_species_id: 3 })).code, 'forbidden')
    assert.equal((await rpc('set_community_exclusion', curatorPlain.token, { p_contribution_id: target, p_excluded: true, p_reason: 'No authenticator.' })).code, 'mfa_required')
    assert.equal(room(await knowledge(stranger)).cycles, 5, 'nothing changed')

    // The curator sees the plants without who or what they came from.
    const listing = await rpc('review_community_contributions', curator.token, { p_species_id: 3 })
    assert.equal(listing.ok, true); assert.equal(listing.label, 'belum dikurasi')
    const rows = listing.contributions.filter(c => c.zone === 'dalam_ruangan')
    assert.equal(rows.length, 5)
    for (const row of listing.contributions) assert.deepEqual(Object.keys(row).sort(), ['duration_days', 'excluded', 'excluded_reason', 'id', 'moisture_high', 'moisture_low', 'shared_on', 'watering_interval_days', 'zone'])
    assert.equal((await rpc('review_community_contributions', curator.token, { p_species_id: 999 })).code, 'invalid_request')

    // Excluding needs a reason and a real contribution.
    for (const patch of [{ p_reason: null }, { p_reason: '   ' }, { p_reason: 'x'.repeat(501) }, { p_excluded: null }, { p_contribution_id: null }])
      assert.equal((await rpc('set_community_exclusion', curator.token, { p_contribution_id: target, p_excluded: true, p_reason: 'Looks wrong.', ...patch })).code, 'invalid_request', JSON.stringify(patch).slice(0, 60))
    assert.equal((await rpc('set_community_exclusion', curator.token, { p_contribution_id: randomUUID(), p_excluded: true, p_reason: 'Unknown.' })).code, 'contribution_unavailable')
    const out = await rpc('set_community_exclusion', curator.token, { p_contribution_id: target, p_excluded: true, p_reason: '  Synthetic exclusion for the test.  ' })
    assert.deepEqual([out.ok, out.excluded], [true, true], JSON.stringify(out))
    assert.equal(sql(`SELECT excluded_reason, excluded_by = ${q(curator.id)} FROM community_contribution WHERE id = ${q(target)}`), 'Synthetic exclusion for the test.|t')
    assert.equal(room(await knowledge(stranger)), undefined, 'four plants are not enough')
    assert.equal((await rpc('review_community_contributions', curator.token, { p_species_id: 3 })).contributions.find(c => c.id === target).excluded, true)
    assert.equal((await mine(c2)).cycles.some(c => c.shared), true, 'the owner is not told, and still sees it as shared')

    const back = await rpc('set_community_exclusion', curator.token, { p_contribution_id: target, p_excluded: false, p_reason: null })
    assert.deepEqual([back.ok, back.excluded], [true, false])
    assert.equal(sql(`SELECT excluded_at IS NULL AND excluded_by IS NULL AND excluded_reason IS NULL FROM community_contribution WHERE id = ${q(target)}`), 't')
    assert.equal(room(await knowledge(stranger)).cycles, 5)
  })

  await t.test('taking sharing back, even in the middle of a plant\'s life, takes the plant out of what others read', async () => {
    const [u1, u2, u3, u4] = await Promise.all(['a', 'b', 'c', 'd'].map(l => account('u-' + l)))
    const made = []
    for (const [who, w] of [[u1, 4], [u1, 4.5], [u2, 5], [u2, 5.5], [u3, 6]]) made.push(await shared(who, { lat: null }, W(w)))
    const unlocated = r => zoneOf(r, 'tanpa_lokasi')
    assert.equal(unlocated(await knowledge(stranger)).cycles, 5)
    // Turning sharing off for one slot takes back what came from it and nothing else.
    const off = await setSharing(u1, made[0].slot, false)
    assert.deepEqual([off.ok, off.share, off.withdrawn], [true, false, 1])
    assert.equal(unlocated(await knowledge(stranger)), undefined, 'four plants are left')
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE account_id = ${q(u1.id)}`), '1', 'the other plant of the same person stays')
    const g = await mine(u1)
    assert.deepEqual([g.slots.find(s => s.id === made[0].slot).share, g.cycles.find(c => c.id === made[0].cycle).shared], [false, false])
    assert.equal((await share(u1, made[0].cycle)).code, 'not_opted_in', 'and it cannot be shared again until sharing is turned on')
    assert.equal((await setSharing(u1, made[0].slot, true)).withdrawn, 0)
    assert.equal((await share(u1, made[0].cycle, W(4))).ok, true, 'turning it on again is a new choice')
    assert.equal(unlocated(await knowledge(stranger)).cycles, 5)

    // Changing one's mind while the plant is still growing: it cannot be shared when it ends.
    const site = await addSite(u4, { p_name: 'Berubah pikiran', p_latitude: null, p_longitude: null })
    const slot = site.slot_ids[0]
    await setSharing(u4, slot, true)
    const growing = await plant(u4, slot, { p_planted_on: daysAgo(40) })
    await setSharing(u4, slot, false)
    assert.equal((await swap(u4, slot)).ok, true)
    age(growing.cycle.id)
    seen.slots.push(slot); seen.cycles.push(growing.cycle.id)
    assert.equal((await share(u4, growing.cycle.id)).code, 'not_opted_in')
    assert.equal(unlocated(await knowledge(stranger)).cycles, 5, 'nothing from it')
  })

  await t.test('replacing plants again and again makes nothing to share: only a long success counts', async () => {
    const churn = await account('churn'), site = await addSite(churn, { p_name: 'Ganti-ganti', p_latitude: -6.2, p_longitude: 106.8 })
    const slot = site.slot_ids[0]
    await setSharing(churn, slot, true)
    // An orchid planted five days ago, then five replacements on the same day, each closing the one before as a success.
    const ids = [(await plant(churn, slot, { p_planted_on: daysAgo(5) })).cycle.id]
    for (let i = 0; i < 5; i++) { const next = await swap(churn, slot, { p_species_id: i % 2 ? 3 : 4, p_outcome: 'berhasil' }); assert.equal(next.ok, true, JSON.stringify(next)); ids.push(next.cycle.id) }
    for (const id of ids) age(id)
    for (const id of ids.slice(0, -1)) { const r = await share(churn, id); assert.equal(r.code, 'not_eligible', JSON.stringify(r)); assert.match(r.message, /too short/) }
    assert.equal((await share(churn, ids.at(-1))).code, 'state_conflict', 'the one still growing is not finished')
    assert.equal(sql(`SELECT count(*) FROM community_contribution WHERE account_id = ${q(churn.id)}`), '0')
  })

  await t.test('nothing that identifies a person comes back to anyone: not the aggregate, not a curator listing, not an account of the same name', async () => {
    const forbidden = [...seen.accounts, ...seen.slots, ...seen.cycles]
    assert(forbidden.length > 40, 'there is plenty to look for')
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    for (const species of [3, 4]) {
      const read = await knowledge(stranger, species), text = JSON.stringify(read)
      assert.deepEqual(Object.keys(read).sort(), ['label', 'ok', 'source', 'species_id', 'zones'])
      for (const zone of read.zones) assert.deepEqual(Object.keys(zone).sort(), ['cycles', 'moisture', 'owners', 'watering_interval_days', 'zone'])
      assert(!uuid.test(text), 'no identifier of any kind'); for (const id of forbidden) assert(!text.includes(id), id)
      assert(!/\d{4}-\d{2}-\d{2}|T\d{2}:/.test(text), 'and no date or time')
    }
    const listing = JSON.stringify(await rpc('review_community_contributions', curator.token, { p_species_id: 3 }))
    for (const id of forbidden) assert(!listing.includes(id), 'the curator listing carries no account, slot or plant id')
    // Another person cannot learn which of their plants somebody else has shared, or turn a stranger's sharing off.
    const theirs = (await mine(owner)).slots
    assert.deepEqual(theirs, [], 'a stranger has no slots to read')
    const victim = await account('victim'), slot = (await finished(victim)).slot
    assert.equal((await setSharing(stranger, slot, false)).code, 'slot_unavailable')
    assert.equal((await setSharing(victim, slot, true)).ok, true, 'and the owner is the one who can')
    assert.equal(sql('SELECT count(*) FROM community_contribution c WHERE NOT EXISTS (SELECT 1 FROM plant_cycle p WHERE p.id = c.cycle_id AND p.account_id = c.account_id AND p.slot_id = c.slot_id)'), '0', 'every share belongs to its owner\'s own plant')
  })
})
