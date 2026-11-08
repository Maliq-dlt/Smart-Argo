import { evaluate, parseCase, type Sample } from './agronomyEngine.ts'
import scenarios from './scenarios.json' with { type: 'json' }

// ponytail: two built-in cases tell this story; add choices only when another decision needs explaining.
export const landingExamples = [
  { index: 0, label: 'Cepat mengering' },
  { index: 2, label: 'Basah menetap' },
].map(({ index, label }) => {
  const data = parseCase(scenarios[index])
  return { label, data, reading: data.samples.at(-1)!, decision: evaluate(data) }
})

export function trendPath(samples: readonly Sample[]) {
  if (!samples.length) return ''
  const start = samples[0].t_h
  const duration = samples.at(-1)!.t_h - start || 1
  return samples.map((sample, i) => `${i ? 'L' : 'M'}${(8 + (sample.t_h - start) / duration * 384).toFixed(1)} ${(80 - sample.moisture * .72).toFixed(1)}`).join(' ')
}

export type StoryCrop = 'cabai' | 'bawang'

export const storyPlants = [
  { id: 'cabai' as const, name: 'Cabai', latin: 'Capsicum annuum', description: 'Daun merimbun. Buah memanjang. Kenali ritme tanaman yang akrab di dapurmu.' },
  { id: 'bawang' as const, name: 'Bawang', latin: 'Allium cepa', description: 'Daun menjulang. Umbi berlapis. Tanaman berbeda, cara membaca yang berbeda.' },
]

export function storyExamples(crop: StoryCrop) {
  const dry = parseCase(scenarios[crop === 'bawang' ? 7 : 0])
  const wet = { ...landingExamples[1].data, profile: { ...dry.profile } }
  return [dry, wet].map(data => ({ data, reading: data.samples.at(-1)!, decision: evaluate(data) }))
}
