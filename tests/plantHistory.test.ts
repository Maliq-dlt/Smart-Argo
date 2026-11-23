import assert from 'node:assert/strict'
import test from 'node:test'
import type { Sample } from '../src/lib/agronomyEngine.ts'
import { healthyDays, journal, weekShare } from '../src/lib/plantHistory.ts'
import type { LogEntry } from '../src/lib/sessionStore.ts'

// SYNTHETIC session: hour 0 is local midnight of Friday 20 Nov 2026 in UTC+7; now = Sunday 22 Nov 06:00.
const clock = { startedAtMs: Date.UTC(2026, 10, 20) - 7 * 3_600_000, offsetMinutes: 420 }
const now = 54
const reading = (t_h: number, moisture: number, valid = true): Sample => ({ t_h, moisture, temp_c: 28, ph: null, valid })
const every = (from: number, to: number, moisture: (t: number) => number) =>
  Array.from({ length: Math.round((to - from) * 2) + 1 }, (_, i) => reading(from + i / 2, moisture(from + i / 2)))

test('healthyDays counts the hours each local day spent in the band, from the first reading to now', () => {
  // Friday: in the band 06:00–11:30 (12 readings = 6 h) of 18 observed hours; Saturday all day; Sunday so far.
  const samples = [...every(6, 23.5, t => t < 12 ? 50 : 30), ...every(24, 47.5, () => 50), ...every(48, 54, () => 50)]
  const days = healthyDays(samples, [40, 70], clock, now)
  assert.deepEqual(days.map(d => [d.date, d.weekday, d.hours, d.span, d.level, d.today]), [
    ['20/11/2026', 4, 6, 18, 2, false],
    ['21/11/2026', 5, 24, 24, 4, false],
    ['22/11/2026', 6, 6, 6, 4, true], // 13 readings at 06:00 sharp, capped at the 6 observed hours
  ])
  assert.equal(weekShare(days), 75) // 36 of 48 observed hours
})

test('a day with no valid reading has no level, and the calendar stops at the asked number of days', () => {
  const samples = [reading(30, 50, false), reading(50, 20)]
  const days = healthyDays(samples, [40, 70], clock, now)
  assert.deepEqual(days.map(d => d.level), [null, 0])
  assert.equal(healthyDays(every(0, 54, () => 50), [40, 70], clock, now, 2).length, 2)
  assert.deepEqual(healthyDays([], [40, 70], clock, now), [])
  assert.equal(weekShare([]), null)
})

test('journal lists what the person did, newest first, by local day, first sentence only', () => {
  const log = (id: number, time: string, message: string, kind: LogEntry['kind'] = 'action'): LogEntry => ({ id, time, kind, message })
  const days = journal([
    log(1, '06:30:00', 'Pengecekan: Sehat.'),
    log(2, '30:00:00', 'Pemupukan dicatat pengguna. Jadwal dihitung ulang.'),
    log(3, '30:00:00', 'AMATI', 'rule'),
    log(4, '50:15:00', 'Siram 150 mL dicatat. Model latihan menerapkan respons pada sampel berikutnya.'),
  ], clock, now)
  assert.deepEqual(days.map(d => [d.label, d.entries.map(e => [e.time, e.text, e.kind])]), [
    ['Hari ini', [['02:15', 'Siram 150 mL dicatat', 'water']]],
    ['Kemarin', [['06:00', 'Pemupukan dicatat pengguna', 'feed']]],
    ['Jumat, 20 Nov', [['06:30', 'Pengecekan: Sehat', 'check']]],
  ])
  assert.equal(journal([log(1, '01:00:00', 'Siram 1 mL dicatat.'), log(2, '02:00:00', 'Siram 2 mL dicatat.')], clock, now, 1)[0].entries.length, 1)
})
