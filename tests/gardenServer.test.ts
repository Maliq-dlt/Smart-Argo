import assert from 'node:assert/strict'
import test from 'node:test'
import { bindSession, emptyGarden, gardenFromServer, setActiveSlot } from '../src/lib/garden.ts'
import { addSiteOnServer, gardenErrorText, switchOnServer } from '../src/lib/gardenServer.ts'

const S = '11111111-1111-4111-8111-111111111111', Z1 = '22222222-2222-4222-8222-222222222222', Z2 = '33333333-3333-4333-8333-333333333333'
const C1 = '44444444-4444-4444-8444-444444444444', C2 = '55555555-5555-4555-8555-555555555555'
// The shape my_garden() returns (supabase/migrations/20261115100000 and 20261115110000).
const answer = {
  ok: true,
  sites: [{ id: S, name: 'Kebun belakang', kind: 'garden', placement: 'outdoor', latitude: -6.9, longitude: 107.6 }],
  slots: [{ id: Z1, site_id: S, name: 'Bedeng A', unit_id: null, share: false }, { id: Z2, site_id: S, name: 'Bedeng B', unit_id: null, share: false }],
  cycles: [
    { id: C1, slot_id: Z1, species_id: 1, plant_no: 7, code: 1000007, nickname: 'Cabai 1', planted_on: '2026-10-01', ended_on: '2026-11-01', outcome: 'berhasil', shared: false },
    { id: C2, slot_id: Z1, species_id: 2, plant_no: 3, code: 2000003, nickname: 'Bawang merah 1', planted_on: '2026-11-01', ended_on: null, outcome: null, shared: false },
  ],
}

test('the server garden becomes the app book, and this device keeps which session each slot opens and which slot is chosen', () => {
  const local = setActiveSlot(bindSession(gardenFromServer(answer, emptyGarden()), Z1, 'sesi-a'), Z2)
  const book = gardenFromServer(answer, local)
  assert.deepEqual(book.sites, [{ id: S, name: 'Kebun belakang', kind: 'garden', placement: 'outdoor', location: { lat: -6.9, lon: 107.6 } }])
  assert.deepEqual(book.slots.map(s => [s.id, s.sessionId, s.cycles.length]), [[Z1, 'sesi-a', 2], [Z2, null, 0]])
  assert.deepEqual(book.slots[0].cycles[1], { id: C2, speciesId: 2, plantNo: 3, nickname: 'Bawang merah 1', plantedOn: '2026-11-01' })
  assert.deepEqual(book.slots[0].cycles[0].outcome, 'berhasil')
  assert.equal(book.activeSlotId, Z2)
  assert.equal(gardenFromServer(answer, emptyGarden()).activeSlotId, Z1, 'with nothing chosen yet, the first slot is')
  assert.equal(gardenFromServer({ ok: true, sites: [], slots: [], cycles: [] }, local).activeSlotId, null)
})

test('a server answer that is not a garden is refused, never read as an empty one', () => {
  for (const bad of [{}, { ok: true, sites: [], slots: [] }, { ...answer, cycles: [{ ...answer.cycles[1], species_id: 99999 }] },
    { ...answer, cycles: [answer.cycles[1], { ...answer.cycles[1], id: C1 }] }, { ...answer, slots: [{ ...answer.slots[0], site_id: 'elsewhere' }] }])
    assert.throws(() => gardenFromServer(bad, emptyGarden()), JSON.stringify(bad).slice(0, 80))
})

test('a new garden is made, then each zone is planted in its own slot, every write with its own request id', async () => {
  const calls: [string, Record<string, unknown>][] = []
  const rpc = async (name: string, body?: unknown) => { calls.push([name, body as Record<string, unknown>]); return name === 'add_my_site' ? { ok: true, slot_ids: [Z1, Z2] } : { ok: true } }
  await addSiteOnServer(rpc, { kind: 'garden', name: 'Kebun belakang', placement: 'outdoor', location: { lat: -6.9, lon: 107.6 },
    zones: [{ name: 'Bedeng A', plant: { speciesId: 1, plantedOn: '2026-11-16' } }, { name: 'Bedeng B' }] })
  assert.deepEqual(calls.map(([name]) => name), ['add_my_site', 'plant_in_my_slot'])
  const [[, site], [, plant]] = calls
  assert.deepEqual({ ...site, p_request_id: 'x' }, { p_request_id: 'x', p_name: 'Kebun belakang', p_kind: 'garden', p_placement: 'outdoor', p_latitude: -6.9, p_longitude: 107.6, p_zones: ['Bedeng A', 'Bedeng B'] })
  assert.deepEqual({ ...plant, p_request_id: 'x' }, { p_request_id: 'x', p_slot_id: Z1, p_species_id: 1, p_planted_on: '2026-11-16', p_nickname: null })
  assert.match(String(site.p_request_id), /^[0-9a-f-]{36}$/)
  assert.notEqual(site.p_request_id, plant.p_request_id)
})

test('a pot sends no zones, an indoor pot no place, and an answer without its slots is an error', async () => {
  const calls: Record<string, unknown>[] = []
  await addSiteOnServer(async (_name, body) => { calls.push(body as Record<string, unknown>); return { ok: true, slot_ids: [Z1] } },
    { kind: 'pot', name: 'Pot meja', placement: 'indoor', zones: [{ name: 'Pot meja', plant: { speciesId: 3, plantedOn: '2026-11-16', nickname: 'Si ungu' } }] })
  assert.deepEqual([calls[0].p_zones, calls[0].p_latitude, calls[1].p_nickname], [null, null, 'Si ungu'])
  await assert.rejects(addSiteOnServer(async () => ({ ok: true }), { kind: 'pot', name: 'Pot', placement: 'indoor', zones: [{ name: 'Pot' }] }))
})

test('replacing a plant is one call, and a garden refusal is told in words a person can act on', async () => {
  let sent: unknown
  const result = await switchOnServer(async (_name, body) => { sent = body; return { ok: true, unchanged: true } }, Z1, { speciesId: 2, outcome: 'gagal' }, '2026-11-16')
  assert.deepEqual({ ...(sent as object), p_request_id: 'x' }, { p_request_id: 'x', p_slot_id: Z1, p_species_id: 2, p_on: '2026-11-16', p_outcome: 'gagal', p_nickname: null })
  assert.equal(result.unchanged, true)
  assert.match(gardenErrorText(Object.assign(new Error('x'), { code: 'limit_reached' })), /20 pot dan kebun/)
  assert.equal(gardenErrorText(new Error('Koneksi terputus.')), 'Koneksi terputus.')
})
