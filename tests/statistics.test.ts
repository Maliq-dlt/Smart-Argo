import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeSamples } from '../src/lib/chartData.ts'
import { skyAt, sampleIntervalMs } from '../src/lib/simulation.ts'
import type { Sample } from '../src/lib/agronomyEngine.ts'

test('Statistik mengecualikan gagal dan pH kosong, dengan batas histogram inklusif terakhir', () => {
  const rows: Sample[] = [
    { t_h: 0, moisture: 0, temp_c: -20, ph: 0, valid: true },
    { t_h: .5, moisture: 20, temp_c: 0, ph: null, valid: true },
    { t_h: 1, moisture: 80, temp_c: 60, ph: 14, valid: false },
    { t_h: 24, moisture: 100, temp_c: 60, ph: 14, valid: true },
  ]
  const moisture = summarizeSamples(rows, 'moisture')
  assert.equal(moisture.mean, 40)
  assert.deepEqual(moisture.bins.map(b => b.count), [1, 1, 0, 0, 1])
  assert.equal(moisture.days.length, 2)
  assert.deepEqual(moisture.days[0], { hour: 0, min: 0, max: 20, sum: 20, count: 2 })
  const ph = summarizeSamples(rows, 'ph')
  assert.equal(ph.mean, 7); assert.equal(ph.count, 2)
  assert.equal(ph.failed, 1); assert.equal(ph.missing, 1)
  assert.equal(ph.count + ph.failed + ph.missing, rows.length)
  const empty = summarizeSamples([], 'ph')
  assert.equal(empty.mean, null); assert.equal(empty.min, null); assert.equal(empty.max, null)
  assert.deepEqual(empty.days, [])
  assert.equal(summarizeSamples([rows[2]], 'ph').mean, null)
})

test('Matahari dan bulan melintasi timur–barat, malam gelap, interval tetap satu sampel', () => {
  assert.ok(skyAt(1).sun.x < skyAt(6).sun.x && skyAt(6).sun.x < skyAt(11).sun.x)
  assert.ok(skyAt(6).sun.y < skyAt(1).sun.y)
  assert.ok(skyAt(13).moon.x < skyAt(18).moon.x && skyAt(18).moon.x < skyAt(23).moon.x)
  assert.equal(skyAt(6).light, 1); assert.equal(skyAt(18).light, 0)
  assert.equal(skyAt(18).sun.opacity, 0); assert.equal(skyAt(6).moon.opacity, 0)
  assert.deepEqual(skyAt(0), skyAt(24))
  for (let t = 0; t <= 24; t += .1) {
    const sky = skyAt(t)
    assert.ok(sky.light >= 0 && sky.light <= 1)
    for (const orb of [sky.sun, sky.moon]) assert.ok(orb.x >= 6 && orb.x <= 94 && orb.opacity >= 0 && orb.opacity <= 1)
  }
  assert.deepEqual([1, 12, 48].map(sampleIntervalMs), [6000, 500, 125])
})
