// Ringkasan: one status per plant, what leads the page, and the sentence above it. Pure, so the page and its tests
// read the same answers. The numbers come from each plant's own session (evaluate) until the server's my_overview.
import type { DecisionCode } from './agronomyEngine'
import type { SpeciesId } from './species'

export type Tone = 'ok' | 'dry' | 'soon' | 'wet' | 'hot' | 'check' | 'learn' | 'idle'
export interface PlantStatus { tone: Tone; word: string; attention: boolean }
export interface OverviewPlant {
  id: string; name: string; tag: string | null; place: string | null; species: SpeciesId
  moisture: number | null; status: PlantStatus; etaH: number | null; day: number; planted: boolean; hour: number
  slotId: string | null; sessionId: string | null
}

const BY_DECISION: Partial<Record<DecisionCode, PlantStatus>> = {
  PERIKSA_MEDIA_KERING: { tone: 'dry', word: 'Perlu disiram', attention: true },
  PERIKSA_PANAS: { tone: 'hot', word: 'Terlalu panas', attention: true },
  PERIKSA_DRAINASE: { tone: 'wet', word: 'Terlalu basah', attention: true },
  PERIKSA_SENSOR: { tone: 'check', word: 'Periksa sensor', attention: true },
  PULIHKAN_DATA: { tone: 'check', word: 'Periksa pembacaan', attention: true },
  KALIBRASI_LOKAL: { tone: 'check', word: 'Perlu acuan lokal', attention: true },
  UKUR_ULANG_PH: { tone: 'check', word: 'Ukur ulang pH', attention: true },
  PERIKSA_SIRAMAN: { tone: 'ok', word: 'Menunggu respons siram', attention: false },
  PERIKSA_SEBELUM_PERGI: { tone: 'soon', word: 'Siram sebentar lagi', attention: false },
}

export function statusOf(decision: DecisionCode | null, { learning, planted }: { learning: boolean; planted: boolean }): PlantStatus {
  if (!planted) return { tone: 'idle', word: 'Belum ditanam', attention: false }
  // A plant without a curated profile is watched, not advised (Fase 5), and its session is never validated, so the engine
  // always asks for a local reference: only a broken reading (sensor, stale data) still asks for attention.
  if (learning) return decision === 'PERIKSA_SENSOR' || decision === 'PULIHKAN_DATA' ? BY_DECISION[decision]! : { tone: 'learn', word: 'Sedang belajar', attention: false }
  return (decision && BY_DECISION[decision]) || { tone: 'ok', word: 'Baik', attention: false }
}

// Dry first (the one thing a person can fix in a minute), then other alarms, then by how soon water is due.
const RANK: Record<Tone, number> = { dry: 0, hot: 1, wet: 1, check: 1, soon: 2, ok: 3, learn: 4, idle: 5 }
const byUrgency = (a: OverviewPlant, b: OverviewPlant) => RANK[a.status.tone] - RANK[b.status.tone] || (a.etaH ?? Infinity) - (b.etaH ?? Infinity)

/** What leads the page: one plant alone; else up to three that need attention; else the one due soonest. */
export function arrange(plants: OverviewPlant[]): { mode: 'single' | 'attention' | 'next'; featured: OverviewPlant[]; rest: OverviewPlant[] } {
  const sorted = [...plants].sort(byUrgency)
  if (sorted.length <= 1) return { mode: 'single', featured: sorted, rest: [] }
  const attention = sorted.filter(p => p.status.attention).slice(0, 3)
  if (attention.length) return { mode: 'attention', featured: attention, rest: sorted.filter(p => !attention.includes(p)) }
  return { mode: 'next', featured: sorted.slice(0, 1), rest: sorted.slice(1) }
}

const VERB: Record<Tone, string> = { dry: 'perlu disiram', hot: 'kepanasan', wet: 'terlalu basah', check: 'perlu diperiksa', soon: 'perlu disiram sebentar lagi', ok: 'baik', learn: 'sedang dipelajari', idle: 'belum ditanam' }

export function headline(plants: OverviewPlant[]): string {
  if (plants.length === 1) return `${plants[0].name} ${VERB[plants[0].status.tone]}.`
  const dry = plants.filter(p => p.status.tone === 'dry'), other = plants.filter(p => p.status.attention && p.status.tone !== 'dry')
  if (dry.length === 1 && !other.length) return `${dry[0].name} perlu disiram.`
  if (dry.length > 1) return `${dry.length} tanaman perlu disiram.`
  if (other.length === 1 && !dry.length) return `${other[0].name} ${VERB[other[0].status.tone]}.`
  if (dry.length + other.length > 0) return `${dry.length + other.length} tanaman perlu perhatian.`
  return plants.every(p => p.status.tone === 'ok' || p.status.tone === 'soon') ? 'Semua tanaman baik.' : 'Tidak ada yang perlu dilakukan sekarang.'
}

/** The calm ones, counted: "5 baik · 2 sedang dipelajari". Empty for a single plant (its card says it all). */
export function summaryLine(plants: OverviewPlant[]): string {
  if (plants.length < 2) return ''
  const ok = plants.filter(p => p.status.tone === 'ok' || p.status.tone === 'soon').length
  const learn = plants.filter(p => p.status.tone === 'learn').length, idle = plants.filter(p => p.status.tone === 'idle').length
  return [ok && `${ok} baik`, learn && `${learn} sedang dipelajari`, idle && `${idle} belum ditanam`].filter(Boolean).join(' · ')
}

/** Hours from now: 0–0 when it is already dry; the engine's projection ±25 % within the next day; else none. */
export function wateringWindow(p: OverviewPlant): { from: number; to: number } | null {
  if (p.status.tone === 'dry') return { from: 0, to: 0 }
  if (p.etaH === null || p.etaH > 24) return null
  const half = (h: number) => Math.round(h * 2) / 2
  return { from: half(p.etaH * .75), to: half(p.etaH * 1.25) }
}
