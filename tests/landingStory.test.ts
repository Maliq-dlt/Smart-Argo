import assert from 'node:assert/strict'
import test from 'node:test'
import { landingExamples, trendPath } from '../src/lib/landingStory.ts'

test('Landing memakai dua skenario bawaan dengan keputusan dan bukti yang sesuai', () => {
  assert.deepEqual(landingExamples.map(item => item.decision.decision), ['PERIKSA_SEBELUM_PERGI', 'PERIKSA_DRAINASE'])
  assert.deepEqual(landingExamples.map(item => item.reading.moisture), [55, 95])
  for (const { data, decision } of landingExamples) {
    assert.equal(decision.decision, data.expected)
    assert.equal(data.samples.at(-1)!.t_h, data.now_h)
    assert(decision.action.length > 0 && decision.reason.length > 0)
  }
})

test('Grafik mengikuti waktu pengamatan, termasuk jeda tidak seragam dan batas indeks', () => {
  const samples = [5, 6, 8].map((t_h, i) => ({ t_h, moisture: i * 50, temp_c: 27, ph: null, valid: true }))
  const coords = trendPath(samples).match(/[-\d.]+/g)!.map(Number)
  assert.deepEqual(coords, [8, 80, 136, 44, 392, 8])
  assert.equal(trendPath([]), '')
  assert.equal(trendPath(samples.slice(0, 1)), 'M8.0 80.0')
})
