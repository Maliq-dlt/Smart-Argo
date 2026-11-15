import assert from 'node:assert/strict'
import test from 'node:test'
import { activeCycle, addGarden, addPersonalPot, addSlot, bindSession, daysBetween, demoGarden, emptyGarden, parseGarden, plantCode, plantInSlot, setActiveSlot, shiftDate, switchPlant } from '../src/lib/garden.ts'

const TODAY = '2026-11-15'
const potBook = () => addPersonalPot(emptyGarden(), { name: 'Pot dapur', placement: 'indoor' })

test('plant codes put the species before the number and refuse anything outside the range', () => {
  assert.equal(plantCode(3, 7), 3_000_007)
  assert.equal(plantCode(2146, 999_999), 2_146_999_999)
  assert.ok(plantCode(2146, 999_999) <= 2_147_483_647, 'fits a Postgres integer')
  for (const [species, no] of [[0, 1], [2147, 1], [1.5, 1], [1, 0], [1, 1_000_000], [1, 2.5], [Number.NaN, 1]]) assert.throws(() => plantCode(species, no), RangeError, `${species}/${no}`)
})

test('plants are named by species in order, and a given name wins', () => {
  let book = addGarden(emptyGarden(), { name: 'Kebun', placement: 'outdoor', zones: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] })
  const [a, b, c, d] = book.slots.map(s => s.id)
  book = plantInSlot(book, a, 1, TODAY)
  book = plantInSlot(book, b, 2, TODAY)
  book = plantInSlot(book, c, 1, TODAY)
  book = plantInSlot(book, d, 1, TODAY, '  Si pedas  ')
  const names = book.slots.map(s => activeCycle(s)?.nickname)
  assert.deepEqual(names, ['Cabai 1', 'Bawang merah 1', 'Cabai 2', 'Si pedas'])
  assert.deepEqual(book.slots.map(s => activeCycle(s)?.plantNo), [1, 1, 2, 3], 'the number counts plants of the species, whatever they are called')
  assert.deepEqual(book.nextPlantNo, { 1: 4, 2: 2 })
})

test('replacing a plant five times keeps every cycle in order with one active, and never edits the old ones', () => {
  let book = potBook()
  const slot = book.slots[0].id
  book = plantInSlot(book, slot, 1, '2026-01-01')
  const outcomes = ['berhasil', 'gagal', 'berhasil', 'dihentikan', 'berhasil'] as const
  const history: unknown[] = []
  outcomes.forEach((outcome, i) => {
    const before = structuredClone(book.slots[0].cycles)
    book = switchPlant(book, slot, i % 2 === 0 ? 2 : 1, `2026-0${i + 2}-01`, outcome)
    assert.deepEqual(book.slots[0].cycles.slice(0, before.length - 1), before.slice(0, -1), 'older cycles are untouched')
    history.push(book.slots[0].cycles[i])
  })
  const cycles = book.slots[0].cycles
  assert.equal(cycles.length, 6)
  assert.equal(cycles.filter(c => c.endedOn === undefined).length, 1)
  assert.deepEqual(cycles.slice(0, 5).map(c => c.outcome), [...outcomes])
  assert.deepEqual(cycles.map(c => c.plantedOn), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'])
  for (let i = 0; i < 5; i++) assert.equal(cycles[i].endedOn, cycles[i + 1].plantedOn, 'a cycle ends the day the next begins')
  assert.equal(new Set(cycles.map(c => c.id)).size, 6)
  assert.equal(activeCycle(book.slots[0])?.id, cycles[5].id)
})

test('replacing a plant with the same species the same day is not a new cycle, and an unspecified outcome is "dihentikan"', () => {
  let book = potBook()
  const slot = book.slots[0].id
  book = plantInSlot(book, slot, 1, TODAY)
  assert.equal(switchPlant(book, slot, 1, TODAY), book, 'nothing changes')
  const other = switchPlant(book, slot, 2, TODAY)
  assert.equal(other.slots[0].cycles[0].outcome, 'dihentikan')
  assert.equal(other.slots[0].cycles.length, 2)
  const sameLater = switchPlant(book, slot, 1, '2026-11-20', 'berhasil')
  assert.equal(sameLater.slots[0].cycles.length, 2, 'the same species on another day is a fresh cycle')
  assert.throws(() => switchPlant(book, slot, 2, '2026-11-14'), RangeError, 'not before it was planted')
  assert.throws(() => switchPlant(book, slot, 2, TODAY, 'selesai' as never), RangeError)
  assert.throws(() => plantInSlot(book, slot, 2, TODAY), RangeError, 'a planted slot needs switchPlant')
  assert.throws(() => plantInSlot(potBook(), 'z1', 99, TODAY), RangeError, 'unknown species')
  assert.throws(() => plantInSlot(potBook(), 'z1', 1, '15-11-2026'), RangeError, 'dates are YYYY-MM-DD')
})

test('a switch into an empty slot just plants, and a pot has one slot while a garden can grow', () => {
  const book = potBook()
  const planted = switchPlant(book, book.slots[0].id, 3, TODAY)
  assert.equal(activeCycle(planted.slots[0])?.nickname, 'Anggrek bulan 1')
  assert.throws(() => addSlot(book, book.sites[0].id, 'Dua'), RangeError)
  const garden = addGarden(emptyGarden(), { name: 'Kebun', placement: 'rooftop', location: { lat: -6.2, lon: 106.8 }, zones: [{ name: 'A' }] })
  assert.equal(addSlot(garden, garden.sites[0].id, 'B').slots.length, 2)
  assert.throws(() => addGarden(emptyGarden(), { name: 'Kosong', placement: 'outdoor', zones: [] }), RangeError)
})

test('an indoor site keeps no location, a bad one is refused, and names are tidied', () => {
  const indoor = addPersonalPot(emptyGarden(), { name: '  Pot   rumah  ', placement: 'indoor', location: { lat: 1, lon: 2 } })
  assert.equal(indoor.sites[0].location, undefined)
  assert.equal(indoor.sites[0].name, 'Pot rumah')
  const outdoor = addPersonalPot(emptyGarden(), { name: 'Pot', placement: 'outdoor', location: { lat: -6.2, lon: 106.8 } })
  assert.deepEqual(outdoor.sites[0].location, { lat: -6.2, lon: 106.8 })
  for (const location of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: Number.NaN, lon: 0 }, { lat: 'x', lon: 0 }, null]) assert.throws(() => addPersonalPot(emptyGarden(), { name: 'Pot', placement: 'outdoor', location: location as never }), RangeError)
  for (const bad of ['', '   ', 'x'.repeat(61)]) assert.throws(() => addPersonalPot(emptyGarden(), { name: bad, placement: 'indoor' }), RangeError)
  assert.throws(() => addPersonalPot(emptyGarden(), { name: 'Pot', placement: 'balkon' as never }), RangeError)
})

test('the first slot added becomes the active one, binding a session changes only that slot, and the original book is never mutated', () => {
  const empty = emptyGarden()
  const book = potBook()
  assert.equal(book.activeSlotId, book.slots[0].id)
  assert.deepEqual(empty, emptyGarden())
  const bound = bindSession(book, book.slots[0].id, 'sesi-1')
  assert.equal(bound.slots[0].sessionId, 'sesi-1')
  assert.equal(book.slots[0].sessionId, null)
  const second = addPersonalPot(book, { name: 'Pot dua', placement: 'indoor' })
  assert.equal(second.activeSlotId, second.slots[1].id, 'a new pot opens')
  assert.equal(setActiveSlot(second, book.slots[0].id).activeSlotId, book.slots[0].id)
  assert.throws(() => setActiveSlot(second, 'z99'), RangeError)
})

test('parseGarden returns what was stored and refuses damage', () => {
  const book = switchPlant(demoGarden(TODAY), 'z1', 1, TODAY, 'berhasil')
  assert.deepEqual(parseGarden(JSON.parse(JSON.stringify(book))), book)
  assert.deepEqual(parseGarden(JSON.parse(JSON.stringify(emptyGarden()))), emptyGarden())
  const bad = (change: (copy: any) => void) => { const copy = JSON.parse(JSON.stringify(book)); change(copy); assert.throws(() => parseGarden(copy)) } // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const raw of [null, 'x', 42, [], {}, { sites: [], slots: [] }, { sites: 'a', slots: [], nextPlantNo: {} }]) assert.throws(() => parseGarden(raw))
  bad(c => { c.sites[1].id = c.sites[0].id })
  bad(c => { c.slots[1].id = c.slots[0].id })
  bad(c => { c.slots[0].siteId = 'tidak-ada' })
  bad(c => { c.activeSlotId = 'z99' })
  bad(c => { c.slots[0].cycles[1].id = c.slots[0].cycles[0].id })
  bad(c => { delete c.slots[0].cycles[0].endedOn })
  bad(c => { c.slots[0].cycles[0].outcome = 'selesai' })
  bad(c => { c.slots[0].cycles[0].endedOn = '2000-01-01' })
  bad(c => { c.slots[0].cycles[0].plantedOn = '2026-02-30' })
  bad(c => { c.slots[0].cycles[0].speciesId = 0 })
  bad(c => { c.slots[0].cycles[0].plantNo = 1_000_000 })
  bad(c => { c.sites[0].placement = 'balkon' })
  bad(c => { c.sites[1].location = { lat: 200, lon: 0 } })
  bad(c => { c.nextPlantNo = {} })
  bad(c => { c.nextPlantNo['1'] = 1 })
  bad(c => { c.slots[1].cycles.push({ ...c.slots[1].cycles[0], id: 'c99' }) })
  bad(c => { c.slots[0].sessionId = 7 })
  bad(c => { c.slots = Array.from({ length: 61 }, (_, i) => ({ ...c.slots[0], id: `z${i + 10}` })) })
})

test('the demo has an indoor orchid pot and an outdoor garden with two zones, all planted', () => {
  const book = demoGarden(TODAY)
  assert.deepEqual(book.sites.map(s => [s.kind, s.placement]), [['pot', 'indoor'], ['garden', 'outdoor']])
  assert.equal(book.slots.length, 3)
  assert.equal(book.slots.filter(s => s.siteId === book.sites[1].id).length, 2)
  assert.deepEqual(book.slots.map(s => activeCycle(s)?.speciesId), [3, 1, 2])
  assert.equal(book.sites[1].location, undefined, 'the demo carries no coordinates')
  assert.deepEqual(parseGarden(JSON.parse(JSON.stringify(book))), book)
  assert.equal(book.activeSlotId, book.slots[0].id)
})

test('date helpers count in whole UTC days across month ends', () => {
  assert.equal(shiftDate('2026-03-01', 1), '2026-02-28')
  assert.equal(shiftDate('2026-11-15', 40), '2026-10-06')
  assert.equal(shiftDate('2026-11-15', -20), '2026-12-05')
  assert.equal(daysBetween('2026-10-06', '2026-11-15'), 40)
  assert.equal(daysBetween(TODAY, TODAY), 0)
})
