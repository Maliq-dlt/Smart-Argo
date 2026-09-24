import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { advanceSimulation, createJourney, plantSeed, simulationOf, waterSimulation, recordFertilizer, feedingDue, shouldPause, scenePeriod, simulationStopped } from '../src/lib/simulation.ts'
import { createSession, parseSession, exportSession, importSession } from '../src/lib/sessionStore.ts'
import { evaluate, type PotCase } from '../src/lib/agronomyEngine.ts'

const cases: PotCase[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))
test('Bibit harus ditanam; clock, HST dan perkembangan perjalanan bergerak bersama', () => {
  const unplanted = createJourney(cases[0])
  assert.equal(advanceSimulation(unplanted), unplanted)
  assert.throws(() => waterSimulation(unplanted, 150), /Tanam/)
  const planted = plantSeed(unplanted)
  const start = { ...planted, simulation: { ...simulationOf(planted), pauseOnCare: false } }
  const next = advanceSimulation(start, 48)
  assert.equal(next.day, 1); assert.equal(next.data.now_h, 24); assert.equal(next.data.samples.length, 49)
  assert.ok(simulationOf(next).growthHours > 0 && simulationOf(next).growthHours <= 24)
  assert.equal(start.data.now_h, 0); assert.match(planted.logs[0].message, /Bibit ditanam/)
  assert.equal(scenePeriod(0), 'Pagi'); assert.equal(scenePeriod(6), 'Siang'); assert.equal(scenePeriod(12), 'Sore'); assert.equal(scenePeriod(18), 'Malam')
})
test('Sampel acak dapat diulang dari seed yang tersimpan, dibatasi, dan tidak mengubah HST eksperimen', () => {
  const old = createSession(cases[1], 'Eksperimen', '1', 42)
  const s = { ...old, simulation: { ...simulationOf(old), source: 'random' as const, pauseOnCare: false } }
  const a = advanceSimulation(s, 48), b = advanceSimulation(s, 48)
  assert.deepEqual(a.data, b.data); assert.equal(a.day, 42)
  assert.ok(a.data.samples.every(r => r.moisture >= 0 && r.moisture <= 100 && r.temp_c >= -20 && r.temp_c <= 60))
  assert.notDeepEqual(a.data.samples.slice(-6).map(r => r.moisture), [55,55,55,55,55,55])
  assert.equal(a.data.samples[6].ph, null)
  assert.ok(a.data.samples.slice(6).some(r => r.ph !== null))
})
test('Siram mengubah sampel berikutnya sekali, tanpa menulis ulang riwayat', () => {
  const s = plantSeed(createJourney(cases[0]))
  const water = waterSimulation(s, 150), watered = advanceSimulation(water), dry = advanceSimulation(s)
  assert.deepEqual(water.data.samples, s.data.samples)
  assert.ok(watered.data.samples.at(-1)!.moisture > dry.data.samples.at(-1)!.moisture)
  assert.equal(simulationOf(watered).pendingWater, 0)
  assert.ok(advanceSimulation(watered).data.samples.at(-1)!.moisture < watered.data.samples.at(-1)!.moisture)
  assert.throws(() => waterSimulation(s, 0)); assert.throws(() => waterSimulation(s, Infinity))
})
test('Pupuk hanya jadwal/catatan; tidak mengubah sensor, aturan, atau pertumbuhan', () => {
  const planted = plantSeed(createJourney(cases[0]))
  const start = { ...planted, simulation: { ...simulationOf(planted), pauseOnCare: false, feedEveryDays: 1 } }
  const due = advanceSimulation(start, 48); assert.equal(feedingDue(due), true)
  assert.ok(due.logs.some(l => l.message.includes('Pengingat jadwal pupuk')))
  const fed = recordFertilizer(due)
  assert.deepEqual(fed.data, due.data); assert.deepEqual(evaluate(fed.data), evaluate(due.data))
  assert.equal(simulationOf(fed).growthHours, simulationOf(due).growthHours)
  assert.equal(feedingDue(fed), false)
})
test('Jeda berhenti di tindakan; restore mempertahankan dinamika, seed, dan siraman pending', () => {
  const planted = plantSeed(createJourney(cases[0]))
  const s = { ...planted, simulation: { ...simulationOf(planted), pauseOnCare: true } }
  const next = advanceSimulation(advanceSimulation(s, 48), 48)
  assert.ok(next.data.now_h < 48); assert.equal(shouldPause(next), true)
  const pending = waterSimulation(next, 150)
  const restored = importSession(exportSession(pending), 'Pulih')
  assert.deepEqual(restored.simulation, pending.simulation)
  assert.deepEqual(advanceSimulation(restored).data, advanceSimulation(pending).data)
  assert.throws(() => parseSession({ ...s, simulation: { ...simulationOf(s), seed: -1 } }))
  assert.throws(() => parseSession({ ...s, simulation: { ...simulationOf(s), rate: 100 } }))
})
test('Perjalanan terawat selesai 90 HST, tumbuh sampai berbuah, dan tidak melebihi batas sampel', () => {
  let s = plantSeed(createJourney(cases[0]))
  s = { ...s, simulation: { ...simulationOf(s), pauseOnCare: false } }
  for (let i = 0; i < 4320; i++) {
    if (s.data.samples.at(-1)!.moisture < 55) s = waterSimulation(s, 150)
    s = advanceSimulation(s)
  }
  assert.equal(s.day, 90); assert.equal(s.data.samples.length, 4321); assert.equal(simulationStopped(s), true)
  assert.ok(simulationOf(s).growthHours / 24 >= 74)
  assert.ok(s.logs.length <= 500); parseSession(s)
  assert.equal(advanceSimulation(s), s)
})


test('Waktu baru berjalan terus; peringatan yang sudah dilihat tidak menghentikan resume', () => {
  const planted = plantSeed(createJourney(cases[0]))
  assert.equal(simulationOf(planted).pauseOnCare, false)
  const continuous = advanceSimulation(advanceSimulation(planted, 48), 48)
  assert.equal(continuous.data.now_h, 48)
  assert.equal(shouldPause(continuous), false)
  const dry = { ...planted, simulation: { ...simulationOf(planted), pauseOnCare: true }, data: { ...planted.data, now_h: 3,
    samples: Array.from({ length: 7 }, (_, i) => ({ t_h: i / 2, moisture: 20, temp_c: 25, ph: 6.2, valid: true })) } }
  assert.equal(shouldPause(dry), true)
  const resumed = advanceSimulation(dry, 6)
  assert.equal(resumed.data.now_h, 6)
  assert.equal(shouldPause(resumed, dry), false)
  assert.deepEqual(dry.data.samples, resumed.data.samples.slice(0, 7))
})

test('Jadwal pupuk baru menjeda sekali; meneruskan waktu tidak menghapus peringatan', () => {
  const planted = plantSeed(createJourney(cases[0]))
  const before = { ...planted, simulation: { ...simulationOf(planted), pauseOnCare: true, feedEveryDays: 1 }, data: { ...planted.data, now_h: 23.5,
    samples: Array.from({ length: 4 }, (_, i) => ({ t_h: 22 + i / 2, moisture: 70, temp_c: 25, ph: 6.2, valid: true })) } }
  assert.equal(feedingDue(before), false)
  const due = advanceSimulation(before, 48)
  assert.equal(due.data.now_h, 24)
  assert.equal(shouldPause(due, before), true)
  const resumed = advanceSimulation(due, 2)
  assert.equal(resumed.data.now_h, 25)
  assert.equal(feedingDue(resumed), true)
  assert.equal(shouldPause(resumed, due), false)
})
