import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate } from '../src/lib/agronomyEngine.ts'
import { MAX_BACKFILL_DAYS, createSlotSession, loadSpeciesScenario } from '../src/lib/gardenSessions.ts'
import { simulationOf } from '../src/lib/simulation.ts'
import { speciesOfCrop } from '../src/lib/species.ts'

test('a curated species opens the scenario of its profile, validated', () => {
  const chili = loadSpeciesScenario('cabai'), shallot = loadSpeciesScenario('bawang')
  assert.equal(speciesOfCrop(chili.data.profile.crop), 'cabai')
  assert.equal(speciesOfCrop(shallot.data.profile.crop), 'bawang')
  assert.equal(chili.data.profile.validated, true)
  assert.equal(shallot.data.profile.validated, true)
})

test('a learning species has no validated profile, so the engine holds its watering advice back', () => {
  const orchid = loadSpeciesScenario('anggrek')
  assert.equal(speciesOfCrop(orchid.data.profile.crop), 'anggrek')
  assert.equal(orchid.data.profile.crop, 'Anggrek bulan')
  assert.deepEqual([orchid.data.profile.validated, orchid.data.profile.ph_validated], [false, false])
  assert.equal(evaluate(orchid.data).decision, 'KALIBRASI_LOKAL')
  assert.equal(orchid.data.profile.phase, 'Mengamati')
  for (const id of ['cabai', 'bawang'] as const) assert.notEqual(evaluate(loadSpeciesScenario(id).data).decision, 'KALIBRASI_LOKAL', id)
})

test('a slot session is a planted journey carrying the slot name, aged to the planting date', () => {
  const fresh = createSlotSession('cabai', 'Bedeng A', '2026-11-15', '2026-11-15')
  assert.equal(fresh.name, 'Bedeng A')
  assert.equal(simulationOf(fresh).planted, true)
  assert.equal(simulationOf(fresh).mode, 'journey')
  assert.equal(simulationOf(fresh).growthHours, 0)
  const older = createSlotSession('cabai', 'Bedeng A', '2026-10-31', '2026-11-15')
  assert.ok(simulationOf(older).growthHours > 12 * 24, `a plant 15 days old has grown about that long (${simulationOf(older).growthHours} h)`)
  assert.ok(older.data.now_h > fresh.data.now_h)
})

test('a plant planted tomorrow is a day-zero plant, and a very old one is simulated for at most the cap', () => {
  assert.equal(simulationOf(createSlotSession('bawang', 'B', '2026-11-20', '2026-11-15')).growthHours, 0)
  const ancient = createSlotSession('bawang', 'B', '2020-01-01', '2026-11-15')
  const capped = createSlotSession('bawang', 'B', '2026-09-16', '2026-11-15')
  assert.equal(ancient.data.now_h, capped.data.now_h, `${MAX_BACKFILL_DAYS} days is the most that is simulated`)
})

test('an orchid slot session ages too, and still withholds advice', () => {
  const session = createSlotSession('anggrek', 'Anggrek ruang tamu', '2026-10-06', '2026-11-15')
  assert.ok(simulationOf(session).growthHours > 0)
  assert.equal(evaluate(session.data).decision, 'KALIBRASI_LOKAL')
  assert.equal(speciesOfCrop(session.data.profile.crop), 'anggrek')
})
