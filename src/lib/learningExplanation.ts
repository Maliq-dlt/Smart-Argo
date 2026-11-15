/** Words for a plant that has no curated profile. The numbers come from `observation.ts`; this file only phrases them, and only
 * within what the evidence says. At level 0 there is nothing to explain beyond what has been recorded, so no model is ever asked.
 * At level 1 a model may rephrase (prompt `smart-agro.explain.v2`), but its text is accepted only if it keeps to the evidence:
 * no dose, no number that is not in it, no claim about what is best for the species, and it names where the facts come from.
 * Anything else falls back to the template below. The demo has no model endpoint, so there the template is what shows. */
import type { Thresholds } from './observation.ts'

export const LEARNING_PROMPT_VERSION = 'smart-agro.explain.v2'
/** What a reader is always told about these facts. */
export const ORIGIN_LABEL = 'Berdasarkan pola pot Anda, bukan standar tanaman.'

export interface LearningEvidence {
  speciesName: string
  level: 0 | 1
  days: number; readings: number; waterings: number; inspections: number
  healthy: [number, number] | null
  /** Moisture points lost per hour in daylight. */
  dryingPerHour: number | null
  /** Moisture points gained after a watering. */
  waterRise: number | null
  missing: { days: number; inspections: number; waterings: number }
}
export interface LearningText { text: string; label: string; source: 'rules' | 'ai' }
export type Rejection = 'invalid_json' | 'length' | 'dose' | 'number' | 'claim' | 'label' | 'link' | 'markup'

const id = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
const plural = (n: number, one: string) => `${n} ${one}`

/** The plain account of what has been seen, and (at level 1) what the pot's own pattern is. */
export function learningTemplate(e: LearningEvidence): LearningText {
  if (e.level === 0) {
    const lacking = [e.missing.days > 0 && `${plural(e.missing.days, 'hari')} lagi`, e.missing.inspections > 0 && `${plural(e.missing.inspections, 'pengecekan')} lagi`, e.missing.waterings > 0 && `${plural(e.missing.waterings, 'siraman terukur')} lagi`].filter(Boolean)
    return { source: 'rules', label: ORIGIN_LABEL, text: `Smart Agro belum punya acuan untuk ${e.speciesName}, jadi belum memberi saran siram. Ia merekam bacaan, siraman, dan pengecekan Anda: ${e.days} hari, ${e.readings} bacaan, ${e.waterings} siraman terukur, ${e.inspections} pengecekan.${lacking.length ? ` Masih perlu ${lacking.join(', ')}.` : ''}` }
  }
  const parts = [
    e.healthy && `Pada saat Anda menilai tanaman sehat, kelembapan media berkisar ${e.healthy[0]} sampai ${e.healthy[1]}.`,
    e.dryingPerHour !== null && `Media mengering sekitar ${id(e.dryingPerHour)} poin per jam pada siang hari.`,
    e.waterRise !== null && `Satu siraman menaikkannya sekitar ${id(e.waterRise)} poin.`,
  ].filter(Boolean)
  return { source: 'rules', label: ORIGIN_LABEL, text: `${parts.length ? parts.join(' ') : 'Belum ada pola yang cukup jelas untuk dicatat.'} Ini pola pot Anda, bukan standar tanaman.` }
}

/** The prompt of version v2: the evidence and the limits, nothing about the owner. */
export function learningPrompt(e: LearningEvidence): string {
  return [
    `Versi: ${LEARNING_PROMPT_VERSION}`,
    'Tugas: tulis satu paragraf pendek berbahasa Indonesia yang merangkum pola pot ini dari bukti di bawah.',
    'Aturan: pakai hanya angka yang ada di bukti; jangan menyebut dosis atau takaran; jangan menyebut apa yang optimal, ideal, atau dibutuhkan spesies; jangan memberi tautan atau markup; sebut bahwa ini pola pot pengguna, bukan standar tanaman.',
    'Keluaran: JSON {"explanation": "..."} saja.',
    `<evidence>${JSON.stringify(e)}</evidence>`,
  ].join('\n')
}

const numbersOf = (e: LearningEvidence) => {
  const values: number[] = [e.days, e.readings, e.waterings, e.inspections, e.missing.days, e.missing.inspections, e.missing.waterings]
  if (e.healthy) values.push(...e.healthy)
  if (e.dryingPerHour !== null) values.push(e.dryingPerHour)
  if (e.waterRise !== null) values.push(e.waterRise)
  return new Set(values.map(v => Math.round(v * 100) / 100))
}
const DOSE = /(\d+(?:[.,]\d+)?\s*(?:ml|mL|l|liter|gram|g|kg|sdm|sdt|sendok|tetes)\b)|\b(?:dosis|takaran)\b/i
const CLAIM = /\b(?:optimal|ideal|membutuhkan|memerlukan|dibutuhkan|seharusnya)\b|(?<!bukan )standar (?:tanaman|spesies|anggrek|peoni)|untuk (?:spesies|jenis) (?:ini|tersebut)/i

/** Why a text may not be shown, or null when it keeps to the evidence. Used for the model's text and, as a guard, for the template.
 * ponytail: a number passes when it equals any number of the evidence, even one meant for another fact; tell the two apart when a
 * model's text is shown to people and a wrong pairing becomes likely. "bukan standar tanaman" is the denial and is allowed. */
export function rejectLearningText(text: string, e: LearningEvidence): Rejection | null {
  if (text.length < 40 || text.length > 600) return 'length'
  if (/https?:\/\/|www\./i.test(text)) return 'link'
  if (/[<>`*#[\]{}]/.test(text)) return 'markup'
  if (DOSE.test(text)) return 'dose'
  if (CLAIM.test(text)) return 'claim'
  const allowed = numbersOf(e)
  for (const token of text.match(/\d+(?:[.,]\d+)?/g) ?? []) if (!allowed.has(Math.round(Number(token.replace(',', '.')) * 100) / 100)) return 'number'
  if (!/pola pot Anda/i.test(text)) return 'label'
  return null
}

/** Parses and checks a model's answer: JSON with an `explanation` that keeps to the evidence. */
export function checkLearningText(raw: string, e: LearningEvidence): { explanation: string } | Rejection {
  let parsed: unknown
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { return 'invalid_json' }
  const explanation = typeof parsed === 'object' && parsed !== null ? (parsed as { explanation?: unknown }).explanation : undefined
  if (typeof explanation !== 'string') return 'invalid_json'
  return rejectLearningText(explanation, e) ?? { explanation: explanation.trim() }
}

/** The explanation to show. Level 0 is the template and never reaches a model. Level 1 asks the model if there is one and
 * keeps its text only when it passes the check; any failure, refusal or error shows the template instead. */
export async function explainLearning(e: LearningEvidence, ask?: (prompt: string) => Promise<string>): Promise<LearningText> {
  const template = learningTemplate(e)
  if (e.level === 0 || !ask) return template
  try {
    const checked = checkLearningText(await ask(learningPrompt(e)), e)
    return typeof checked === 'string' ? template : { source: 'ai', label: ORIGIN_LABEL, text: checked.explanation }
  } catch { return template }
}

/** Builds the evidence from what `observation.ts` computed. */
export function learningEvidence(speciesName: string, level: 0 | 1, observed: { days: number; readings: number; waterings: number; inspections: number },
  facts: { healthy: [number, number] | null; dryingPerHour: number | null; waterRise: number | null }, th: Thresholds): LearningEvidence {
  return { speciesName, level, ...observed, ...facts, missing: {
    days: Math.max(0, th.days - observed.days), inspections: Math.max(0, th.inspections - observed.inspections), waterings: Math.max(0, th.waterings - observed.waterings) } }
}
