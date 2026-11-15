// Pots, gardens and plant cycles on the server (Fase 6, inactive until live mode): isolation between owners, atomic replacing, a
// history that cannot change, plant numbers that never repeat, and limits. Needs the local backend (npm run backend:local).
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const base = 'http://127.0.0.1:54321', config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const sqlFails = (input, pattern) => { try { sql(input) } catch (error) { assert.match(String(error.stderr), pattern); return } assert.fail(`The statement was accepted: ${input}`) }
async function api(path, token, body, method = 'POST') { const r = await fetch(base + path, { method, headers: { apikey: config.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) }); return { status: r.status, data: await r.json().catch(() => null) } }
const rpc = (name, token, body = {}) => api('/rest/v1/rpc/' + name, token, body).then(r => r.data)
const run = randomUUID().slice(0, 8), password = randomBytes(20).toString('base64url')
async function account(label) { const r = await api('/auth/v1/signup', null, { email: `garden-${run}-${label}@example.test`, password }); assert.equal(r.status, 200); return { token: r.data.access_token, id: (await rpc('ensure_my_account', r.data.access_token)).account.id } }
const today = new Date().toISOString().slice(0, 10)
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const addSite = (who, patch = {}) => rpc('add_my_site', who.token, { p_request_id: randomUUID(), p_name: 'Pot dapur', p_kind: 'pot', p_placement: 'indoor', p_latitude: null, p_longitude: null, p_zones: null, ...patch })
const plant = (who, slot, patch = {}) => rpc('plant_in_my_slot', who.token, { p_request_id: randomUUID(), p_slot_id: slot, p_species_id: 1, p_planted_on: today, p_nickname: null, ...patch })
const swap = (who, slot, patch = {}) => rpc('switch_my_plant', who.token, { p_request_id: randomUUID(), p_slot_id: slot, p_species_id: 2, p_on: today, p_outcome: 'berhasil', p_nickname: null, ...patch })
const mine = who => rpc('my_garden', who.token)

await test('Garden: private sites, slots and plant cycles, one history, and numbers that never repeat', async t => {
  const [a, b, c] = await Promise.all([account('owner'), account('other'), account('limits')])

  await t.test('the tables are closed and every function needs a signed-in user', async () => {
    for (const name of ['my_garden', 'add_my_site', 'plant_in_my_slot', 'switch_my_plant']) assert((await api('/rest/v1/rpc/' + name, null, {})).status >= 400, `${name} for anon`)
    for (const table of ['garden_site', 'garden_slot', 'plant_cycle', 'plant_counter', 'plant_species'])
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert((await api('/rest/v1/' + table, a.token, method === 'GET' ? undefined : { name: 'spoof' }, method)).status >= 400, `${method} ${table}`)
    sqlFails('SET ROLE authenticated; SELECT * FROM public.plant_cycle', /permission denied/)
    sqlFails('SET ROLE anon; SELECT * FROM public.garden_site', /permission denied/)
    sqlFails('SET ROLE authenticated; SELECT public.open_plant_cycle(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, current_date, null)', /permission denied/)
    sqlFails('SET ROLE authenticated; SELECT public.next_plant_no(1)', /permission denied/)
    assert((await api('/rest/v1/rpc/my_garden', a.token, { p_account_id: b.id })).status >= 400, 'a spoofed account argument is not accepted')
    assert.deepEqual((await mine(a)).sites, [])
  })

  let pot, garden
  await t.test('a pot and a garden are made with their slots; the place is kept to a kilometre and not at all indoors', async () => {
    pot = await addSite(a, { p_name: '  Pot   dapur ', p_placement: 'outdoor', p_latitude: -6.2041, p_longitude: 106.8456 })
    assert.equal(pot.ok, true); assert.equal(pot.slot_ids.length, 1)
    garden = await addSite(a, { p_name: 'Kebun belakang', p_kind: 'garden', p_placement: 'rooftop', p_zones: [' Bedeng A ', 'Bedeng B', 'Bedeng C'] })
    assert.equal(garden.slot_ids.length, 3)
    const indoor = await addSite(a, { p_name: 'Anggrek', p_placement: 'indoor', p_latitude: 10.1234, p_longitude: 20.5678 })
    assert.equal(indoor.ok, true)
    const g = await mine(a)
    assert.deepEqual(g.sites.map(s => s.name), ['Pot dapur', 'Kebun belakang', 'Anggrek'])
    assert.deepEqual([g.sites[0].latitude, g.sites[0].longitude], [-6.2, 106.85], 'two decimals only')
    assert.deepEqual([g.sites[2].latitude, g.sites[2].longitude], [null, null], 'an indoor site keeps no place')
    assert.deepEqual(g.slots.filter(s => s.site_id === garden.site_id).map(s => s.name), ['Bedeng A', 'Bedeng B', 'Bedeng C'])
    assert.equal(g.slots.find(s => s.site_id === pot.site_id).name, 'Pot dapur')
    assert.equal(sql(`SELECT count(*) FROM garden_site WHERE account_id='${a.id}'`), '3')
  })

  await t.test('invalid sites are refused', async () => {
    for (const patch of [{ p_name: '' }, { p_name: '   ' }, { p_name: 'x'.repeat(61) }, { p_name: null }, { p_kind: 'kebun' }, { p_kind: null }, { p_placement: null }, { p_kind: 'pot', p_placement: 'balkon' }, { p_request_id: null },
      { p_latitude: 1 }, { p_longitude: 1 }, { p_placement: 'outdoor', p_latitude: 91, p_longitude: 0 }, { p_placement: 'outdoor', p_latitude: 0, p_longitude: -181 },
      { p_kind: 'garden', p_zones: [] }, { p_kind: 'garden', p_zones: null }, { p_kind: 'garden', p_zones: ['A', 'a'] }, { p_kind: 'garden', p_zones: ['A', ' '] },
      { p_kind: 'garden', p_zones: ['x'.repeat(61)] }, { p_kind: 'garden', p_zones: Array.from({ length: 13 }, (_, i) => `Z${i}`) }])
      assert.equal((await addSite(a, patch)).code, 'invalid_request', JSON.stringify(patch).slice(0, 80))
    assert((await api('/rest/v1/rpc/add_my_site', a.token, { p_request_id: randomUUID(), p_name: 'x', p_kind: 'pot', p_placement: 'indoor', p_latitude: null, p_longitude: null, p_zones: null, p_account_id: b.id })).status >= 400, 'a spoofed owner is not accepted')
  })

  await t.test('a retry of the same request is one site, and a changed retry is refused', async () => {
    const request = randomUUID()
    const results = await Promise.all([addSite(a, { p_request_id: request, p_name: 'Pot ganda' }), addSite(a, { p_request_id: request, p_name: 'Pot ganda' })])
    assert(results.every(r => r.ok)); assert.equal(results.filter(r => !r.idempotent).length, 1); assert.equal(results[0].site_id, results[1].site_id)
    assert.equal(sql(`SELECT count(*) FROM garden_site WHERE account_id='${a.id}' AND name='Pot ganda'`), '1')
    assert.equal((await addSite(a, { p_request_id: request, p_name: 'Nama lain' })).code, 'request_conflict')
    assert.equal(sql(`SELECT count(*) FROM garden_slot WHERE site_id='${results[0].site_id}'`), '1')
  })

  await t.test('another owner sees none of it and can touch none of it', async () => {
    const g = await mine(b)
    assert.deepEqual([g.sites, g.slots, g.cycles], [[], [], []])
    const slot = garden.slot_ids[0]
    assert.equal((await plant(b, slot)).code, 'slot_unavailable')
    assert.equal((await swap(b, slot)).code, 'slot_unavailable')
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE slot_id='${slot}'`), '0')
    const theirs = await addSite(b, { p_name: 'Milik b' })
    assert.equal((await plant(a, theirs.slot_ids[0])).code, 'slot_unavailable', 'and the other way round')
  })

  await t.test('planting names a plant by its owner\'s own count, numbers it for the whole service, and refuses a second plant in a slot', async () => {
    const [z1, z2, z3] = garden.slot_ids
    const first = await plant(a, z1), second = await plant(a, z2), third = await plant(a, z3, { p_species_id: 2, p_nickname: '  Si merah  ', p_planted_on: daysAgo(10) })
    assert([first, second, third].every(r => r.ok), JSON.stringify([first, second, third]))
    assert.deepEqual([first.cycle.nickname, second.cycle.nickname, third.cycle.nickname], ['Cabai 1', 'Cabai 2', 'Si merah'])
    for (const r of [first, second]) assert.equal(r.cycle.code, 1_000_000 + r.cycle.plant_no)
    assert.equal(third.cycle.code, 2_000_000 + third.cycle.plant_no)
    assert.notEqual(first.cycle.plant_no, second.cycle.plant_no)
    assert.equal((await plant(a, z1, { p_species_id: 2 })).code, 'state_conflict')
    const g = await mine(a)
    assert.equal(g.cycles.length, 3)
    assert.equal(g.cycles.find(x => x.id === third.cycle.id).planted_on, daysAgo(10))
  })

  await t.test('invalid planting is refused', async () => {
    const [empty] = (await addSite(a, { p_name: 'Kosong' })).slot_ids.slice(0, 1)
    for (const patch of [{ p_species_id: 0 }, { p_species_id: 99 }, { p_species_id: 2147 }, { p_species_id: null }, { p_planted_on: null }, { p_planted_on: daysAgo(-5) }, { p_planted_on: daysAgo(401) }, { p_nickname: 'x'.repeat(61) }, { p_request_id: null }, { p_slot_id: null }])
      assert.equal((await plant(a, empty, patch)).code, 'invalid_request', JSON.stringify(patch))
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE slot_id='${empty}'`), '0')
  })

  let replaced
  await t.test('replacing closes the old cycle and opens the new one in a single step, and the old one is kept as it was', async () => {
    const slot = garden.slot_ids[0]
    const before = (await mine(a)).cycles.find(x => x.slot_id === slot)
    replaced = await swap(a, slot, { p_species_id: 2, p_on: today, p_outcome: 'gagal' })
    assert.equal(replaced.ok, true)
    assert.equal(replaced.closed.id, before.id)
    assert.deepEqual([replaced.closed.ended_on, replaced.closed.outcome], [today, 'gagal'])
    assert.equal(replaced.cycle.species_id, 2); assert.equal(replaced.cycle.ended_on, null); assert.equal(replaced.cycle.nickname, 'Bawang merah 2', 'the owner had one shallot already')
    const cycles = (await mine(a)).cycles.filter(x => x.slot_id === slot)
    assert.equal(cycles.length, 2)
    assert.deepEqual({ ...cycles.find(x => x.id === before.id), ended_on: null, outcome: null }, before, 'only the closing differs from what it was')
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE slot_id='${slot}' AND ended_on IS NULL`), '1')
  })

  await t.test('a history never changes: no edit of a closed cycle, no edit of an active one except closing it, no delete, no second active plant', async () => {
    const closed = replaced.closed.id, active = replaced.cycle.id, slot = garden.slot_ids[0]
    sqlFails(`UPDATE plant_cycle SET nickname='x' WHERE id='${closed}'`, /closed plant cycle cannot change/)
    sqlFails(`UPDATE plant_cycle SET outcome='berhasil' WHERE id='${closed}'`, /closed plant cycle cannot change/)
    sqlFails(`UPDATE plant_cycle SET ended_on=NULL, outcome=NULL WHERE id='${closed}'`, /closed plant cycle cannot change/)
    sqlFails(`UPDATE plant_cycle SET nickname='x' WHERE id='${active}'`, /can only be closed/)
    sqlFails(`UPDATE plant_cycle SET species_id=1 WHERE id='${active}'`, /can only be closed/)
    sqlFails(`UPDATE plant_cycle SET plant_no=plant_no+1000 WHERE id='${active}'`, /can only be closed/)
    sqlFails(`DELETE FROM plant_cycle WHERE id='${closed}'`, /never deleted/)
    sqlFails(`DELETE FROM plant_cycle WHERE id='${active}'`, /never deleted/)
    sqlFails(`INSERT INTO plant_cycle(slot_id,account_id,species_id,plant_no,nickname,planted_on) VALUES('${slot}','${a.id}',1,999999,'Dua','${today}')`, /plant_cycle_one_active/)
    sqlFails(`UPDATE plant_cycle SET ended_on='2000-01-01', outcome='gagal' WHERE id='${active}'`, /plant_cycle_check|violates check constraint/)
    sqlFails(`UPDATE plant_cycle SET ended_on='${today}' WHERE id='${active}'`, /violates check constraint/)
  })

  await t.test('the same plant the same day changes nothing; a retry returns the first answer; a changed retry is refused', async () => {
    const slot = garden.slot_ids[1]
    const same = await swap(a, slot, { p_species_id: 1, p_on: (await mine(a)).cycles.find(x => x.slot_id === slot).planted_on })
    assert.equal(same.ok, true); assert.equal(same.unchanged, true)
    assert.equal((await mine(a)).cycles.filter(x => x.slot_id === slot).length, 1, 'no second cycle')
    const request = randomUUID()
    const results = await Promise.all([swap(a, slot, { p_request_id: request, p_species_id: 3 }), swap(a, slot, { p_request_id: request, p_species_id: 3 })])
    assert(results.every(r => r.ok), JSON.stringify(results)); assert.equal(results.filter(r => !r.idempotent).length, 1); assert.equal(results[0].cycle.id, results[1].cycle.id)
    assert.equal((await mine(a)).cycles.filter(x => x.slot_id === slot).length, 2, 'two retries are one replacement')
    assert.equal((await swap(a, slot, { p_request_id: request, p_species_id: 4 })).code, 'request_conflict')
  })

  await t.test('invalid replacing is refused and leaves the cycle as it was', async () => {
    const slot = garden.slot_ids[2], before = JSON.stringify((await mine(a)).cycles.filter(x => x.slot_id === slot))
    for (const patch of [{ p_species_id: 99 }, { p_outcome: 'selesai' }, { p_outcome: null }, { p_on: daysAgo(-5) }, { p_on: daysAgo(30) }, { p_nickname: 'x'.repeat(61) }, { p_request_id: null }])
      assert.equal((await swap(a, slot, patch)).code, 'invalid_request', JSON.stringify(patch))
    assert.equal(JSON.stringify((await mine(a)).cycles.filter(x => x.slot_id === slot)), before)
  })

  await t.test('twelve plants started at once by two owners get twelve different numbers and codes', async () => {
    const [ga, gb] = await Promise.all([addSite(a, { p_name: 'Banyak A', p_kind: 'garden', p_placement: 'outdoor', p_zones: Array.from({ length: 6 }, (_, i) => `A${i}`) }), addSite(b, { p_name: 'Banyak B', p_kind: 'garden', p_placement: 'outdoor', p_zones: Array.from({ length: 6 }, (_, i) => `B${i}`) })])
    const results = await Promise.all([...ga.slot_ids.map(s => plant(a, s, { p_species_id: 4 })), ...gb.slot_ids.map(s => plant(b, s, { p_species_id: 4 }))])
    assert(results.every(r => r.ok), JSON.stringify(results.find(r => !r.ok)))
    const numbers = results.map(r => r.cycle.plant_no)
    assert.equal(new Set(numbers).size, 12, `distinct plant numbers: ${numbers}`)
    assert.equal(new Set(results.map(r => r.cycle.code)).size, 12)
    for (const r of results) assert.equal(r.cycle.code, 4_000_000 + r.cycle.plant_no)
    assert.equal(sql('SELECT count(*)=count(DISTINCT code) FROM plant_cycle'), 't', 'no code is used twice anywhere')
    assert.equal(sql('SELECT count(*) FROM plant_cycle WHERE code <> species_id*1000000+plant_no'), '0')
  })

  await t.test('a person has at most 20 pots and gardens and 60 slots', async () => {
    for (let i = 0; i < 20; i++) assert.equal((await addSite(c, { p_name: `Pot ${i}` })).ok, true, `pot ${i}`)
    assert.equal((await addSite(c, { p_name: 'Pot ke-21' })).code, 'limit_reached')
    assert.equal(sql(`SELECT count(*) FROM garden_site WHERE account_id='${c.id}'`), '20')
    const d = await account('slots')
    for (let i = 0; i < 5; i++) assert.equal((await addSite(d, { p_name: `Kebun ${i}`, p_kind: 'garden', p_placement: 'outdoor', p_zones: Array.from({ length: 12 }, (_, k) => `Z${k}`) })).ok, true)
    assert.equal((await addSite(d, { p_name: 'Kebun terlalu besar', p_kind: 'garden', p_placement: 'outdoor', p_zones: ['Z'] })).code, 'limit_reached', '61 slots are too many')
    assert.equal(sql(`SELECT count(*) FROM garden_slot WHERE account_id='${d.id}'`), '60')
  })

  // Plant numbers are one supply for the whole service (the code is a single integer), so nobody may be able to use them all up.
  // The filler rows are closed cycles written straight into the table, numbered high above anything a real plant gets, and marked as failures.
  const fill = (who, slot, species, count, age) => sql(`INSERT INTO plant_cycle(slot_id, account_id, species_id, plant_no, nickname, planted_on, ended_on, outcome, created_at)
    SELECT '${slot}', '${who.id}', ${species}, (SELECT greatest(coalesce(max(plant_no), 0), 500000) FROM plant_cycle WHERE species_id = ${species}) + g, 'Isi ' || g, current_date - 9, current_date - 5, 'gagal', clock_timestamp() - interval '${age}'
    FROM generate_series(1, ${count}) g`)

  await t.test('at most 30 new plants a day, and a refused replacement leaves the growing plant alone', async () => {
    const e = await account('daily'), pot = await addSite(e, { p_name: 'Pot harian' }), slot = pot.slot_ids[0]
    fill(e, slot, 4, 29, '1 hour')
    const thirtieth = await plant(e, slot, { p_species_id: 4 })
    assert.equal(thirtieth.ok, true, JSON.stringify(thirtieth))
    const refused = await swap(e, slot, { p_species_id: 2 })
    assert.equal(refused.code, 'limit_reached'); assert.match(refused.message, /30 new plants a day/)
    assert.deepEqual((await mine(e)).cycles.filter(x => x.slot_id === slot && x.ended_on === null).map(x => x.id), [thirtieth.cycle.id], 'the plant is still growing')
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE account_id='${e.id}'`), '30')
  })

  await t.test('at most 300 plants per account over its whole life', async () => {
    const f = await account('total'), site = await addSite(f, { p_name: 'Kebun penuh', p_kind: 'garden', p_placement: 'outdoor', p_zones: Array.from({ length: 6 }, (_, i) => `Z${i}`) })
    for (const slot of site.slot_ids) fill(f, slot, 4, 50, '3 days')
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE account_id='${f.id}'`), '300')
    const refused = await plant(f, site.slot_ids[0])
    assert.equal(refused.code, 'limit_reached'); assert.match(refused.message, /300 plants/)
    assert.equal(sql(`SELECT count(*) FROM plant_cycle WHERE account_id='${f.id}'`), '300', 'nothing was opened')
  })

  await t.test('a species whose numbers have run out refuses with a reason, and the other species carry on', async () => {
    const g = await account('numbers'), site = await addSite(g, { p_name: 'Dua pot', p_kind: 'garden', p_placement: 'outdoor', p_zones: ['A', 'B'] })
    const before = sql('SELECT next_no FROM plant_counter WHERE species_id = 3')
    sql('INSERT INTO plant_counter(species_id, next_no) VALUES (3, 1000000) ON CONFLICT (species_id) DO UPDATE SET next_no = 1000000')
    try {
      const refused = await plant(g, site.slot_ids[0], { p_species_id: 3 })
      assert.equal(refused.code, 'limit_reached'); assert.match(refused.message, /no plant numbers left/)
      assert.equal((await plant(g, site.slot_ids[1], { p_species_id: 1 })).ok, true, 'another species is not affected')
    } finally {
      sql(before === '' ? 'DELETE FROM plant_counter WHERE species_id = 3' : `UPDATE plant_counter SET next_no = ${before} WHERE species_id = 3`)
    }
  })
  await t.test('the quota helper is not callable by a signed-in user', async () => {
    sqlFails('SET ROLE authenticated; SELECT public.cycle_quota_message(gen_random_uuid(), 1)', /permission denied/)
    assert((await api('/rest/v1/rpc/cycle_quota_message', a.token, { p_account_id: a.id, p_species_id: 1 })).status >= 400)
  })
})
