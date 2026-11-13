/* Mascot expression from the rule decision (docs/diagram/v2/SPESIFIKASI.md §6). The face is an interface metaphor,
 * not a measured plant emotion, and the same data always gives the same face. */
import type { DecisionCode } from './agronomyEngine.ts'

export type Mood = 'unknown' | 'calm' | 'care' | 'alert'

const DATA = new Set<DecisionCode>(['KALIBRASI_LOKAL', 'PULIHKAN_DATA', 'PERIKSA_SENSOR'])
const CARE = new Set<DecisionCode>(['PERIKSA_MEDIA_KERING', 'PERIKSA_SIRAMAN', 'PERIKSA_SEBELUM_PERGI'])
const SEVERITY: Record<Exclude<Mood, 'unknown'>, number> = { calm: 0, care: 1, alert: 2 }

/** Data that cannot be judged → waiting; nothing confirmed → calm; dry or watering checks → care; heat,
 * drainage or pH re-measure → alert. */
export function moodFor(decision: DecisionCode): Mood {
  if (DATA.has(decision)) return 'unknown'
  if (decision === 'AMATI') return 'calm'
  return CARE.has(decision) ? 'care' : 'alert'
}

/** Anti-flicker: a worse condition shows at once, an easing one only once two evaluations in a row agree.
 * Data quality always wins, so missing or invalid readings are never hidden behind an older face. */
export function settledMood(current: DecisionCode, previous: DecisionCode | null): Mood {
  const now = moodFor(current)
  if (now === 'unknown' || previous === null) return now
  const before = moodFor(previous)
  if (before === 'unknown') return now
  return SEVERITY[before] > SEVERITY[now] ? before : now
}
