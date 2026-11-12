import { evaluate, median, RULES, type Decision, type PotCase } from './agronomyEngine.ts'
import { calculateSolarBatterySizing } from './miroProductEngine.ts'
import { storyExamples, type StoryCrop } from './landingStory.ts'

export type Condition = 'dry' | 'wet'
export const crops: { id: StoryCrop; name: string }[] = [{ id: 'cabai', name: 'Cabai' }, { id: 'bawang', name: 'Bawang merah' }]
export const conditions: { id: Condition; name: string }[] = [{ id: 'dry', name: 'Cepat mengering' }, { id: 'wet', name: 'Basah menetap' }]

export const formatNumber = (value: number, digits = 1) => value.toLocaleString('id-ID', { maximumFractionDigits: digits })
export const hours = (value: number) => `${formatNumber(value)} jam`

export function pickCase(crop: StoryCrop, condition: Condition) {
  const [dry, wet] = storyExamples(crop)
  return condition === 'dry' ? dry : wet
}

/** What the engine would say after each reading, using only the readings received so far. */
export function decisionsOverTime(data: PotCase): Decision[] {
  return data.samples.map((sample, index) => evaluate({ ...data, samples: data.samples.slice(0, index + 1), now_h: sample.t_h }))
}

export function ruleOf(decision: Decision) {
  const rule = RULES.find(([code]) => code === decision.decision)!
  return { label: rule[1], criterion: rule[2] }
}

export function thresholds(data: PotCase) {
  return { dry: median(data.profile.needs_water), wet: Math.min(100, median(data.profile.drained) + 10) }
}

/** Share of the root zone drawn as dried from the top: 0 when wet, rising as the index falls. */
export const dryShare = (moisture: number) => Math.min(1, Math.max(0, (90 - moisture) / 90))

/** The solar sizing shown on the landing uses the ecosystem workspace defaults. */
export const solarInput = {
  modes: [
    { name: 'Tidur / siaga', powerW: 0.15, hoursPerDay: 22 },
    { name: 'Ukur & kirim', powerW: 1.8, hoursPerDay: 2 },
  ],
  autonomyDays: 3, usableDepthOfDischarge: 0.8, batteryPathEfficiency: 0.9,
  peakSunHours: 4.2, solarSystemEfficiency: 0.75, batteryNominalVoltageV: 12, currentSocPct: 86,
}
export const solarSizing = () => calculateSolarBatterySizing(solarInput)

/** Engine sentences use a decimal point; the landing reads Indonesian decimals ("1,3 jam"). */
export const localeText = (text: string) => text.replace(/(\d)\.(\d)/g, '$1,$2')
