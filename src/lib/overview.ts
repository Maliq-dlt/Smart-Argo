// Ringkasan: one status per plant, what leads the page, and the sentence above it. Pure, so the page and its tests
// read the same answers. The numbers come from each plant's own session (evaluate) until the server's my_overview.
import type { DecisionCode } from './agronomyEngine'
import { speciesByCode, type SpeciesId } from './species.ts'

export type Tone = 'ok' | 'dry' | 'soon' | 'wet' | 'hot' | 'check' | 'learn' | 'idle'
export interface PlantStatus { tone: Tone; word: string; attention: boolean }
export interface OverviewPlant {
  id: string; name: string; tag: string | null; place: string | null; species: SpeciesId
  moisture: number | null; status: PlantStatus; etaH: number | null; day: number; planted: boolean; hour: number
  slotId: string | null; sessionId: string | null
  unitId?: string | null; bandSource?: BandSource; outlook?: WateringOutlook | null; live?: boolean
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

const statusVerb = (p: OverviewPlant) => p.live && p.status.tone === 'idle' ? 'belum memiliki perangkat' : p.live && p.status.tone === 'wet' ? 'di atas pita kelembapan' : VERB[p.status.tone]

export function headline(plants: OverviewPlant[]): string {
  if (plants.length === 1) return `${plants[0].name} ${statusVerb(plants[0])}.`
  const dry = plants.filter(p => p.status.tone === 'dry'), other = plants.filter(p => p.status.attention && p.status.tone !== 'dry')
  if (dry.length === 1 && !other.length) return `${dry[0].name} perlu disiram.`
  if (dry.length > 1) return `${dry.length} tanaman perlu disiram.`
  if (other.length === 1 && !dry.length) return `${other[0].name} ${statusVerb(other[0])}.`
  if (dry.length + other.length > 0) return `${dry.length + other.length} tanaman perlu perhatian.`
  return plants.every(p => p.status.tone === 'ok' || p.status.tone === 'soon') ? 'Semua tanaman baik.' : 'Tidak ada yang perlu dilakukan sekarang.'
}

/** The calm ones, counted: "5 baik · 2 sedang dipelajari". Empty for a single plant (its card says it all). */
export function summaryLine(plants: OverviewPlant[]): string {
  if (plants.length < 2) return ''
  const ok = plants.filter(p => p.status.tone === 'ok' || p.status.tone === 'soon').length
  const learn = plants.filter(p => p.status.tone === 'learn').length, idle = plants.filter(p => p.status.tone === 'idle' && !p.live).length
  const noDevice = plants.filter(p => p.live && p.status.tone === 'idle').length
  return [ok && `${ok} baik`, learn && `${learn} sedang dipelajari`, idle && `${idle} belum ditanam`, noDevice && `${noDevice} belum memiliki perangkat`].filter(Boolean).join(' · ')
}

/** Hours from now: 0–0 when it is already dry; the engine's projection ±25 % within the next day; else none. */
export function wateringWindow(p: OverviewPlant): { from: number; to: number } | null {
  if (p.status.tone === 'dry') return { from: 0, to: 0 }
  if (p.live) {
    if (p.outlook?.state !== 'window' || !p.outlook.from || !p.outlook.to) return null
    const from = (Date.parse(p.outlook.from) - Date.now()) / 3600000, to = (Date.parse(p.outlook.to) - Date.now()) / 3600000
    return to < 0 || from > 24 ? null : { from: Math.max(0, from), to: Math.min(24, to) }
  }
  if (p.etaH === null || p.etaH > 24) return null
  const half = (h: number) => Math.round(h * 2) / 2
  return { from: half(p.etaH * .75), to: half(p.etaH * 1.25) }
}

export type BandSource = 'profile' | 'own_pattern' | null
export interface WateringOutlook { state: 'window' | 'below' | 'waiting' | 'learning'; from: string | null; to: string | null; band_source: BandSource }
export const bandSourceLabel = (source: BandSource) => source === 'profile' ? 'Profil kurasi untuk pot ini' : source === 'own_pattern' ? 'Berdasarkan pola pot Anda' : 'Pola pot ini masih dipelajari'
export const careTime = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
export const outlookLabel = (outlook: WateringOutlook | null | undefined) => outlook?.state === 'below' ? 'Periksa media, waktunya menyiram' : outlook?.state === 'window' && outlook.from && outlook.to ? `Siram sekitar ${careTime(outlook.from)} - ${careTime(outlook.to)} WIB` : outlook?.state === 'learning' ? 'Pola pot ini masih dipelajari' : 'Data belum cukup untuk memperkirakan siram'
export function careRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Jawaban perawatan tidak valid.')
  return value as Record<string, unknown>
}
export function careAnswer(value: unknown) {
  const answer = careRecord(value)
  if (answer.ok !== true) throw new Error('Data perawatan belum tersedia. Coba muat ulang.')
  return answer
}
const sourceOf = (value: unknown): BandSource => { if (value === null || value === undefined) return null; if (value === 'profile' || value === 'own_pattern') return value; throw new Error('Sumber pita tidak valid.') }
export function parseOutlook(value: unknown): WateringOutlook | null {
  if (value === null) return null
  const item = careRecord(value)
  if (!['window', 'below', 'waiting', 'learning'].includes(String(item.state))) throw new Error('Perkiraan siram tidak valid.')
  const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
  const from = date(item.from), to = date(item.to)
  if (item.state === 'window' && (!from || !to || Date.parse(to) < Date.parse(from))) throw new Error('Jendela siram tidak valid.')
  return { state: item.state as WateringOutlook['state'], from, to, band_source: sourceOf(item.band_source) }
}
const SERVER_STATUS: Record<string, PlantStatus> = {
  below: { tone: 'dry', word: 'Perlu disiram', attention: true }, ok: { tone: 'ok', word: 'Baik', attention: false },
  above: { tone: 'wet', word: 'Di atas pita', attention: true }, learning: { tone: 'learn', word: 'Sedang belajar', attention: false },
  no_device: { tone: 'idle', word: 'Belum ada perangkat', attention: false }, no_reading: { tone: 'check', word: 'Bacaan belum tersedia', attention: true },
}
export function parseCarePlants(value: unknown): OverviewPlant[] {
  const answer = careAnswer(value)
  if (!Array.isArray(answer.plants)) throw new Error('Daftar tanaman tidak valid.')
  return answer.plants.map(value => {
    const p = careRecord(value), status = Object.hasOwn(SERVER_STATUS, String(p.state)) ? SERVER_STATUS[String(p.state)] : null
    const species = typeof p.species_id === 'number' ? speciesByCode(p.species_id)?.id : undefined
    if (typeof p.slot_id !== 'string' || typeof p.name !== 'string' || !status || !species || (p.unit_id !== null && typeof p.unit_id !== 'string') || (p.moisture !== null && (typeof p.moisture !== 'number' || !Number.isFinite(p.moisture)))) throw new Error('Data tanaman tidak valid.')
    const outlook = parseOutlook(p.outlook), from = outlook?.from && Date.parse(outlook.from), to = outlook?.to && Date.parse(outlook.to)
    return { id: p.slot_id, slotId: p.slot_id, unitId: p.unit_id as string | null, name: p.name, tag: typeof p.tag === 'string' ? p.tag : null, place: typeof p.place === 'string' ? p.place : null,
      species,
      moisture: p.moisture as number | null, status, bandSource: sourceOf(p.band_source), outlook, live: true,
      etaH: from && to ? Math.max(0, ((from + to) / 2 - Date.now()) / 3600000) : null, day: 0, planted: true, hour: 10, sessionId: null }
  })
}
export const ALERT_KINDS = { soil_dry: 'Media kering', battery_low: 'Baterai rendah', device_silent: 'Perangkat tidak mengirim', soil_hot: 'Media terlalu panas' } as const
export type AlertKind = keyof typeof ALERT_KINDS
export interface AlertPreferences { email_enabled: boolean; kinds: AlertKind[] }
export function parseAlertPreferences(value: unknown): AlertPreferences {
  const p = careAnswer(value)
  if (typeof p.email_enabled !== 'boolean' || !Array.isArray(p.kinds) || p.kinds.some(k => typeof k !== 'string' || !Object.hasOwn(ALERT_KINDS, k))) throw new Error('Preferensi peringatan tidak valid.')
  return { email_enabled: p.email_enabled, kinds: p.kinds as AlertKind[] }
}

export function parseUnitHealth(value: unknown) {
  const health = careAnswer(value)
  for (const key of ['battery', 'upload_gaps', 'energy_days']) {
    const items = health[key]
    if (!Array.isArray(items)) throw new Error('Riwayat perangkat tidak valid.')
    items.forEach(careRecord)
  }
  if (!Array.isArray(health.packets) || health.packets.some(p => typeof p !== 'string' || !Number.isFinite(Date.parse(p)))) throw new Error('Waktu kiriman tidak valid.')
  if (health.calibration !== null) careRecord(health.calibration)
  return health
}
