import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseAt } from '../src/lib/agronomyEngine.ts'
import { agoLabel, phaseIndex, phaseSteps, skyPeriod, zoneOf } from '../src/lib/dashboardFacts.ts'
import { scenePeriod } from '../src/lib/simulation.ts'

test('zones split at the profile thresholds: below low is dry, above wet is wet, the limits themselves are ideal', () => {
  assert.equal(zoneOf(38.9, 39, 88), 'dry')
  assert.equal(zoneOf(39, 39, 88), 'ok')
  assert.equal(zoneOf(88, 39, 88), 'ok')
  assert.equal(zoneOf(88.1, 39, 88), 'wet')
})

test('the sky period uses the same boundaries as the simulator scene for every hour', () => {
  for (let hour = 0; hour < 24; hour++) {
    const elapsed = (hour - 6 + 24) % 24 // with no clock, clockHour is (6 + elapsed) % 24
    assert.equal(skyPeriod(hour), scenePeriod(elapsed).toLowerCase(), `hour ${hour}`)
  }
})

test('phase steps agree with phaseAt on both sides of every boundary, for chili and shallot', () => {
  for (const id of ['cabai', 'bawang'] as const) {
    const { names, starts, total } = phaseSteps(id)
    for (let day = 0; day <= total; day++) assert.equal(names[phaseIndex(day, id)], phaseAt(day, id), `${id} day ${day}`)
    assert.equal(starts.length, names.length)
  }
})

test('ago labels stay short at every scale', () => {
  assert.equal(agoLabel(.5), '30 m')
  assert.equal(agoLabel(1.5), '1 j 30 m')
  assert.equal(agoLabel(3), '3 j')
  assert.equal(agoLabel(51), '2 hr 3 j')
})
