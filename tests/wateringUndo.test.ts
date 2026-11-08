import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { addSample, evaluate, type PotCase } from '../src/lib/agronomyEngine.ts'
import { advanceSimulation, canUndoWater, createJourney, plantSeed, recordFertilizer, simulationOf, undoWaterSimulation, waterSimulation } from '../src/lib/simulation.ts'
import { createSession, exportSession, importSession, parseSession } from '../src/lib/sessionStore.ts'
import { careEvents } from '../src/lib/chartData.ts'

const cases: PotCase[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))

test('Membatalkan siraman pending memulihkan data tanpa menghapus catatan pupuk atau riwayat', () => {
  const before = plantSeed(createJourney(cases[0]))
  const watered = waterSimulation(before, 150)
  assert.equal(canUndoWater(watered), true)
  assert.deepEqual(watered.data.samples, before.data.samples)
  const fed = recordFertilizer(watered)
  const undone = undoWaterSimulation(fed)
  assert.deepEqual(undone.data, before.data)
  assert.equal(simulationOf(undone).pendingWater, 0)
  assert.equal(simulationOf(undone).lastFedAt, simulationOf(fed).lastFedAt)
  assert.equal(canUndoWater(undone), false)
  assert.equal(undoWaterSimulation(undone), undone)
  assert.match(undone.logs.find(log => log.id === simulationOf(watered).waterUndo!.logId)!.message, /dibatalkan/)
  assert.equal(careEvents(undone.logs, undone.data).filter(event => event.kind === 'water').length, 0)
  assert.deepEqual(advanceSimulation(undone).data, advanceSimulation(before).data)
  assert.equal(canUndoWater(watered), true, 'Input tidak dimutasi')
})

test('Inverse siraman bertahan setelah ekspor/impor dan tidak bisa diterapkan setelah sampel berikutnya', () => {
  const before = plantSeed(createJourney(cases[0]))
  const pending = importSession(exportSession(waterSimulation(before, 150)), 'Dipulihkan')
  assert.equal(canUndoWater(pending), true)
  assert.deepEqual(undoWaterSimulation(pending).data, before.data)
  const processed = advanceSimulation(pending)
  assert.equal(canUndoWater(processed), false)
  assert.equal(simulationOf(processed).waterUndo, undefined)
  assert.equal(undoWaterSimulation(processed), processed)
  const manual = waterSimulation(createSession(cases[0], 'Eksperimen manual'), 75)
  assert.equal(simulationOf(manual).pendingWater, 0, 'Manual tidak menciptakan respons sensor')
  assert.deepEqual(evaluate(undoWaterSimulation(manual).data), evaluate(cases[0]))
  assert.equal(canUndoWater({ ...manual, data: addSample(manual.data, manual.reading) }), false)
})

test('Pembatalan terakhir memulihkan siraman sebelumnya termasuk batas respons model', () => {
  const before = plantSeed(createJourney(cases[0]))
  const first = waterSimulation(before, 800)
  const second = waterSimulation(first, 150)
  assert.equal(simulationOf(second).pendingWater, 100)
  const undone = undoWaterSimulation(second)
  assert.deepEqual(undone.data.watering, first.data.watering)
  assert.equal(simulationOf(undone).pendingWater, simulationOf(first).pendingWater)
  assert.equal(careEvents(undone.logs, undone.data).filter(event => event.kind === 'water').length, 1)
})

test('Metadata inverse impor divalidasi sebelum bisa memulihkan data', () => {
  const pending = waterSimulation(plantSeed(createJourney(cases[0])), 150)
  for (const change of [{ pendingWater: Infinity }, { logId: -1 }, { at_h: 1 }, { watering: { t_h: 0, volume_ml: 0 } }, { logId: 999 }]) {
    const invalid = structuredClone(pending)
    Object.assign(invalid.simulation!.waterUndo!, change)
    assert.throws(() => parseSession(invalid))
  }
})
