export interface SessionClock { startedAtMs: number; offsetMinutes: number | null }
export const hourMs = 3_600_000
export const defaultClock = (now_h: number, savedAt: number): SessionClock => ({ startedAtMs: savedAt - now_h * hourMs, offsetMinutes: null })
export function parseClock(value: unknown, now_h: number): SessionClock {
  if (!value || typeof value !== 'object') throw new Error('Acuan waktu sesi tidak valid.')
  const c = value as SessionClock
  if (!Number.isFinite(c.startedAtMs) || Math.abs(c.startedAtMs) + now_h * hourMs > 8.63e15 ||
    (c.offsetMinutes !== null && (!Number.isInteger(c.offsetMinutes) || c.offsetMinutes < -720 || c.offsetMinutes > 840 || c.offsetMinutes % 15)))
    throw new Error('Waktu harus valid; offset UTC −12:00 hingga +14:00 dalam kelipatan 15 menit.')
  return { startedAtMs: c.startedAtMs, offsetMinutes: c.offsetMinutes }
}
export const instantAt = (clock: SessionClock, hour: number) => clock.startedAtMs + Math.round(hour * hourMs)
export const offsetAt = (clock: SessionClock, hour: number) => clock.offsetMinutes ?? -new Date(instantAt(clock, hour)).getTimezoneOffset()
const localDate = (clock: SessionClock, hour: number) => new Date(instantAt(clock, hour) + offsetAt(clock, hour) * 60_000)
const two = (n: number) => String(n).padStart(2, '0')
export function utcLabel(clock: SessionClock, hour: number) {
  const offset = offsetAt(clock, hour), abs = Math.abs(offset)
  return `UTC${offset >= 0 ? '+' : '−'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
}
export function clockTime(clock: SessionClock, hour: number) {
  const d = localDate(clock, hour)
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
}
export function clockDate(clock: SessionClock, hour: number) {
  const d = localDate(clock, hour)
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
export function localHour(clock: SessionClock, hour: number) {
  const d = localDate(clock, hour)
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
}
export function logClock(clock: SessionClock, elapsedText: string) {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(elapsedText)
  if (!m || +m[2] > 59 || +m[3] > 59) return elapsedText
  const hour = +m[1] + +m[2] / 60 + +m[3] / 3600
  return Math.abs(instantAt(clock, hour)) > 8.64e15 ? elapsedText : `${clockDate(clock, hour)} ${clockTime(clock, hour)}`
}
