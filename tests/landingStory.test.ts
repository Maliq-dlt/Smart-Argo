import { evaluate } from '../src/lib/agronomyEngine.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { landingExamples, storyExamples, trendPath } from '../src/lib/landingStory.ts'

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

test('Pilihan tanaman memakai profilnya sendiri tanpa mengubah skenario atau keputusan engine', () => {
  const cabai = storyExamples('cabai'), bawang = storyExamples('bawang')
  assert.equal(cabai[0].decision.decision, 'PERIKSA_SEBELUM_PERGI')
  assert.equal(bawang[0].decision.decision, 'AMATI')
  assert.deepEqual(cabai[0].data.samples, bawang[0].data.samples)
  for (const [examples, crop] of [[cabai, 'Cabai'], [bawang, 'Bawang merah']] as const) {
    for (const example of examples) {
      assert.equal(example.data.profile.crop, crop)
      assert.equal(example.decision.decision, evaluate(example.data).decision)
    }
    assert.equal(examples[1].decision.decision, 'PERIKSA_DRAINASE')
  }
  cabai[1].data.profile.crop = 'mutated copy'
  assert.equal(storyExamples('cabai')[1].data.profile.crop, 'Cabai')
})
