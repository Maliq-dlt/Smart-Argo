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
