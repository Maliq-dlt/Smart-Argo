import assert from 'node:assert/strict'
import test from 'node:test'
import { phaseAt } from '../src/lib/agronomyEngine.ts'
import { agoLabel, orbit, phaseIndex, phaseSteps, skyOrbits, skyPeriod, zoneOf } from '../src/lib/dashboardFacts.ts'
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

test('the sun is up between 06 and 18 and the moon between 18 and 06, never both at full opacity', () => {
  assert.equal(skyOrbits(12).sun.opacity, 1)
  assert.equal(skyOrbits(12).moon.opacity, 0)
  assert.equal(skyOrbits(0).moon.opacity, 1)
  assert.equal(skyOrbits(0).sun.opacity, 0)
  assert.ok(orbit(6).y < orbit(0).y, 'noon is higher than sunrise')
})

test('phase steps agree with phaseAt on both sides of every boundary, for chili and shallot', () => {
  for (const onion of [false, true]) {
    const { names, starts, total } = phaseSteps(onion)
    for (let day = 0; day <= total; day++) assert.equal(names[phaseIndex(day, onion)], phaseAt(day, onion), `${onion ? 'shallot' : 'chili'} day ${day}`)
    assert.equal(starts.length, names.length)
  }
})

test('ago labels stay short at every scale', () => {
  assert.equal(agoLabel(.5), '30 m')
  assert.equal(agoLabel(1.5), '1 j 30 m')
  assert.equal(agoLabel(3), '3 j')
  assert.equal(agoLabel(51), '2 hr 3 j')
})
