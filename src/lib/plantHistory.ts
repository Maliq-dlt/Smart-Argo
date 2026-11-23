// The plant page's Riwayat beside the chart: hours a day the soil spent in the healthy band (Kalender) and what was
// done to the plant (Jurnal). Read from the session alone; pure, so the page and its tests read the same answers.
import type { Sample } from './agronomyEngine.ts'
import { clockDate, clockTime, localHour, type SessionClock } from './sessionClock.ts'
import type { LogEntry } from './sessionStore.ts'

export interface CalendarDay {
  /** dd/mm/yyyy in the session's time zone. */ date: string
  /** 0 = Monday … 6 = Sunday. */ weekday: number
  /** Hours in the band, and hours of the day that were observed (less than 24 on the first day and today). */ hours: number; span: number
  /** 0 = none of the day, 4 = (nearly) all of it; null = no valid reading that day. */ level: 0 | 1 | 2 | 3 | 4 | null
  today: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const WEEKDAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const parts = (date: string) => date.split('/').map(Number) as [number, number, number]
const weekdayOf = (date: string) => { const [d, m, y] = parts(date); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 }
/** "21 Nov" from dd/mm/yyyy. */
export const shortDate = (date: string) => { const [d, m] = parts(date); return `${d} ${MONTHS[m - 1]}` }

/** One entry per local day, oldest first, from the first sample's day to today (at most `days` of them). */
export function healthyDays(samples: Sample[], band: readonly [number, number], clock: SessionClock, now: number, days = 35): CalendarDay[] {
  if (!samples.length) return []
  const todayStart = now - localHour(clock, now), out: CalendarDay[] = []
  for (let start = todayStart, n = 0; n < days && start + 24 > samples[0].t_h; start -= 24, n++) {
    const valid = samples.filter(s => s.valid && s.t_h >= start && s.t_h < start + 24)
    const span = Math.max(0, Math.min(start + 24, now) - Math.max(start, samples[0].t_h))
    // ponytail: each reading stands for the 30 minutes until the next one (the device's cadence); weigh by the real gap
    // if irregular manual sessions ever need an exact count.
    const hours = Math.min(span, valid.filter(s => s.moisture >= band[0] && s.moisture <= band[1]).length / 2)
    const level = !valid.length ? null : hours === 0 ? 0 : Math.min(4, 1 + Math.floor(hours / Math.max(span, .5) * 4 - 1e-9)) as 1 | 2 | 3 | 4
    const date = clockDate(clock, start + 12) // noon: never on the edge of a rounded millisecond
    out.unshift({ date, weekday: weekdayOf(date), hours, span, level, today: n === 0 })
  }
  return out
}

/** Share of the observed hours of the last seven days spent in the band, or null before any were observed. */
export function weekShare(days: CalendarDay[]): number | null {
  const week = days.slice(-7).filter(d => d.level !== null), span = week.reduce((s, d) => s + d.span, 0)
  return span > 0 ? Math.round(week.reduce((s, d) => s + d.hours, 0) / span * 100) : null
}

export type JournalKind = 'water' | 'feed' | 'check' | 'other'
export interface JournalEntry { id: number; time: string; text: string; kind: JournalKind }
export interface JournalDay { date: string; label: string; entries: JournalEntry[] }

const elapsed = (text: string) => { const m = /^(\d+):(\d{2}):(\d{2})$/.exec(text); return m ? +m[1] + +m[2] / 60 + +m[3] / 3600 : null }
const kindOf = (message: string): JournalKind => /^Siram/.test(message) ? 'water' : /^Pemupukan/.test(message) ? 'feed' : /^Pengecekan/.test(message) ? 'check' : 'other'

/** What the person did (the session's "action" log), newest first, grouped by local day; only the first sentence of each. */
export function journal(logs: LogEntry[], clock: SessionClock, now: number, limit = 40): JournalDay[] {
  const today = clockDate(clock, now), yesterday = clockDate(clock, now - 24), out: JournalDay[] = []
  for (const log of [...logs].reverse()) {
    if (log.kind !== 'action') continue
    const hour = elapsed(log.time)
    if (hour === null) continue
    const date = clockDate(clock, hour), text = log.message.split(/(?<=\.)\s/)[0].replace(/\.$/, '')
    let day = out.at(-1)
    if (day?.date !== date) out.push(day = { date, label: date === today ? 'Hari ini' : date === yesterday ? 'Kemarin' : `${WEEKDAYS[weekdayOf(date)]}, ${shortDate(date)}`, entries: [] })
    day.entries.push({ id: log.id, time: clockTime(clock, hour).slice(0, 5), text, kind: kindOf(log.message) })
    if (out.reduce((s, d) => s + d.entries.length, 0) >= limit) break
  }
  return out
}
