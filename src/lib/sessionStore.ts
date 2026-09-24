import { evaluate, parseCase, type PotCase, type Sample } from './agronomyEngine.ts'
import type { SimulationState } from './simulation.ts'
import { defaultClock, parseClock, type SessionClock } from './sessionClock.ts'
import { parseTelemetry, type DeviceSnapshot } from './telemetry.ts'

export interface LogEntry { id: number; time: string; kind: 'data' | 'action' | 'rule' | 'system' | 'fault'; message: string }
export type Reading = Omit<Sample, 't_h'>
export interface Session {
  id: string; name: string; updatedAt: number; data: PotCase; day: number; speed: number
  reading: Reading; freshPh: boolean; volume: string; scenario: string; logs: LogEntry[]
  simulation?: SimulationState
  clock: SessionClock
  deviceSnapshot?: DeviceSnapshot
}
export interface SessionBook { version: 1; activeId: string; sessions: Session[] }
export const STORAGE_KEY = 'smart-agro.sessions.v1'
export const sessionTime = (hour: number) => {
  const ms = Math.round(hour * 3_600_000)
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
}

export function createSession(input: unknown, name: string, scenario = 'custom', day = 0): Session {
  const data = structuredClone(parseCase(input)), last = data.samples.at(-1)!
  const now = Date.now()
  return { id: crypto.randomUUID(), name: name.slice(0, 120), updatedAt: now, clock: defaultClock(data.now_h, now), data, day, speed: 1,
    reading: { moisture: last.moisture, temp_c: last.temp_c, ph: last.ph ?? 6.2, valid: true },
    freshPh: false, volume: '150', scenario,
    logs: [
      { id: 0, time: sessionTime(data.now_h), kind: 'system', message: `${data.profile.crop} / ${data.profile.media}. ${data.samples.length} sampel sintetis dimuat.` },
      { id: 1, time: sessionTime(data.now_h), kind: 'rule', message: evaluate(data).decision },
    ] }
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Format simpanan sesi tidak valid.')
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Teks simpanan sesi tidak valid.')
}
export function parseSession(input: unknown): Session {
  object(input); text(input.id, 100); text(input.name, 120); text(input.scenario, 20)
  const data = parseCase(input.data)
  if (typeof input.updatedAt !== 'number' || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0 || input.updatedAt > 8.64e15)
    throw new Error('Waktu penyimpanan tidak valid.')
  const clock = parseClock(input.clock === undefined ? defaultClock(data.now_h, input.updatedAt) : input.clock, data.now_h)
  if (input.deviceSnapshot !== undefined) {
    object(input.deviceSnapshot)
    parseTelemetry(input.deviceSnapshot.packet)
    if (typeof input.deviceSnapshot.importedAt !== 'number' || !Number.isSafeInteger(input.deviceSnapshot.importedAt) || input.deviceSnapshot.importedAt < 0 || input.deviceSnapshot.importedAt > 8.64e15) throw new Error('Waktu impor paket tidak valid.')
  }
  const maxDay = data.profile.crop.toLowerCase().includes('bawang') ? 65 : 90
  if (typeof input.day !== 'number' || !Number.isInteger(input.day) || input.day < 0 || input.day > maxDay || ![1, 2, 5, 10].includes(input.speed as number))
    throw new Error('Posisi ilustrasi tidak valid.')
  object(input.reading)
  parseCase({ profile: data.profile, samples: [{ ...input.reading, t_h: 0 }], now_h: 0 })
  if (typeof input.freshPh !== 'boolean' || typeof input.volume !== 'string' || input.volume.length > 20)
    throw new Error('Draf masukan tidak valid.')
  if (input.simulation !== undefined) {
    object(input.simulation)
    const sim = input.simulation
    if (!['journey', 'experiment'].includes(sim.mode as string) || !['auto', 'random', 'manual'].includes(sim.source as string) ||
      typeof sim.planted !== 'boolean' || typeof sim.pauseOnCare !== 'boolean' || ![1, 12, 48].includes(sim.rate as number)) throw new Error('Mode simulasi tidak valid.')
    for (const [key, max] of [['seed', 4294967295], ['growthHours', data.now_h], ['pendingWater', 100], ['feedEveryDays', 90], ['lastFedAt', data.now_h]] as const) {
      const v = sim[key]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error(`Simulasi ${key} tidak valid.`)
    }
    if (!Number.isInteger(sim.seed) || !Number.isInteger(sim.feedEveryDays)) throw new Error('Jadwal atau seed simulasi tidak valid.')
  }
  if (!Array.isArray(input.logs) || input.logs.length > 500) throw new Error('Log sesi tidak valid.')
  for (const log of input.logs) {
    object(log); text(log.time, 40); text(log.message, 2000)
    if (typeof log.id !== 'number' || !Number.isSafeInteger(log.id) || log.id < 0 || !['data', 'action', 'rule', 'system', 'fault'].includes(log.kind as string))
      throw new Error('Entri log tidak valid.')
  }
  return { ...input, clock } as unknown as Session
}

export function parseBook(input: unknown): SessionBook {
  object(input)
  if (input.version !== 1) throw new Error('Versi simpanan tidak didukung. Data lama tidak ditimpa.')
  if (!Array.isArray(input.sessions) || !input.sessions.length) throw new Error('Daftar sesi kosong atau tidak valid.')
  const sessions = input.sessions.map(parseSession)
  const ids = sessions.map(s => s.id)
  if (new Set(ids).size !== ids.length || !ids.includes(input.activeId as string)) throw new Error('Identitas sesi tidak valid.')
  return { version: 1, activeId: input.activeId as string, sessions }
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export function readBook(storage: Storage): { book: SessionBook | null; raw: string | null } {
  const raw = storage.getItem(STORAGE_KEY)
  return { book: raw === null ? null : parseBook(JSON.parse(raw)), raw }
}

// ponytail: localStorage stores complete local sessions; use IndexedDB when observed size/latency warrants it.
export function saveBook(storage: Storage, book: SessionBook, expectedRaw: string | null): string {
  if (storage.getItem(STORAGE_KEY) !== expectedRaw)
    throw new Error('Simpanan berubah di tab lain. Ekspor perubahan tab ini, lalu muat ulang agar tidak menimpa data.')
  const raw = JSON.stringify(book)
  if (raw !== expectedRaw) storage.setItem(STORAGE_KEY, raw)
  return raw
}

export function appendSession(book: SessionBook, session: Session, activate = true): SessionBook {
  return { ...book, activeId: activate ? session.id : book.activeId, sessions: [...book.sessions, session] }
}

export function exportSession(session: Session) {
  const { data, logs, ...state } = session
  return { source: 'simulasi_sintetis', version: 2, device_id: 'AGRO-NODE-01', hst_illustration: session.day,
    input: data, output: evaluate(data), logs, session: state }
}

export function importSession(input: unknown, name: string): Session {
  object(input)
  if ('version' in input && input.version !== 1 && input.version !== 2) throw new Error('Versi ekspor sesi tidak didukung.')
  if ('session' in input) {
    object(input.session)
    const saved = parseSession({ ...input.session, data: input.input, logs: input.logs })
    return { ...structuredClone(saved), id: crypto.randomUUID(), updatedAt: Date.now() }
  }
  const session = createSession('input' in input ? input.input : input, name)
  if ('hst_illustration' in input) {
    const candidate = { ...session, day: input.hst_illustration, logs: input.logs ?? session.logs }
    return parseSession(candidate)
  }
  return session
}
