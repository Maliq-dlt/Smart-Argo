import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate } from '../src/lib/agronomyEngine.ts'
import { decisionsOverTime, dryShare, pickCase, solarSizing, thresholds } from '../src/lib/landingNarrative.ts'

test('Cerita landing hanya memakai bacaan yang sudah diterima pada setiap langkah', () => {
  const { data, decision } = pickCase('cabai', 'dry')
  const steps = decisionsOverTime(data)
  assert.equal(steps.length, data.samples.length)
  assert.deepEqual(steps.slice(0, -1).map(step => step.decision), Array(data.samples.length - 1).fill('AMATI'))
  assert.equal(steps.at(-1)!.decision, decision.decision)
  assert.equal(steps.at(-1)!.decision, 'PERIKSA_SEBELUM_PERGI')
  assert.equal(steps.at(-1)!.evidence.eta_h, 1.33)
})

test('Bacaan yang sama memberi saran berbeda untuk profil cabai dan bawang', () => {
  const cabai = pickCase('cabai', 'dry'), bawang = pickCase('bawang', 'dry')
  assert.deepEqual(cabai.data.samples, bawang.data.samples)
  assert.deepEqual(thresholds(cabai.data), { dry: 39, wet: 88 })
  assert.deepEqual(thresholds(bawang.data), { dry: 28, wet: 81 })
  assert.notEqual(cabai.decision.decision, bawang.decision.decision)
  for (const crop of ['cabai', 'bawang'] as const)
    assert.equal(pickCase(crop, 'wet').decision.decision, evaluate(pickCase(crop, 'wet').data).decision)
})

test('Lapisan kering dan hitungan surya tetap dalam batas', () => {
  assert.equal(dryShare(95), 0)
  assert.equal(dryShare(-5), 1)
  assert(dryShare(55) > dryShare(85))
  const solar = solarSizing()
  assert.equal(solar.dailyEnergyWh.toFixed(1), '6.9')
  assert.equal(solar.powerPolicy, 'normal')
  assert(solar.minBatteryWh > solar.dailyEnergyWh * 3)
})

test('Tanya mesinnya: bacaan stabil tiga jam memberi saran dari profil tanaman yang dipilih', async () => {
  const { askEngine } = await import('../src/lib/landingNarrative.ts')
  assert.equal(askEngine('cabai', 25).decision, 'PERIKSA_MEDIA_KERING')
  assert.equal(askEngine('cabai', 55).decision, 'AMATI')
  assert.equal(askEngine('cabai', 92).decision, 'PERIKSA_DRAINASE')
  // The same reading means different things for different crops: 33 is dry for chili (39), not for shallot (28).
  assert.equal(askEngine('cabai', 33).decision, 'PERIKSA_MEDIA_KERING')
  assert.equal(askEngine('bawang', 33).decision, 'AMATI')
  assert.equal(askEngine('bawang', 33).evidence.moisture, 33)
})
