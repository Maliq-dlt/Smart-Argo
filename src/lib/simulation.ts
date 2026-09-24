import { addSample, evaluate, phaseAt, recordWatering, type PotCase } from './agronomyEngine.ts'
import { createSession, sessionTime, type Session, type LogEntry } from './sessionStore.ts'
import { clockTime, localHour, type SessionClock } from './sessionClock.ts'

export interface SimulationState {
  mode: 'journey' | 'experiment'; source: 'auto' | 'random' | 'manual'; planted: boolean
  seed: number; growthHours: number; pendingWater: number; rate: number; pauseOnCare: boolean
  feedEveryDays: number; lastFedAt: number
}
export const simulationOf = (s: Session): SimulationState => s.simulation ?? {
  mode: 'experiment', source: 'manual', planted: true, seed: 137,
  growthHours: 0, pendingWater: 0, rate: 1, pauseOnCare: false, feedEveryDays: 0, lastFedAt: 0,
}
export const clockHour = (elapsed: number, clock?: SessionClock) => clock ? localHour(clock, elapsed) : (6 + elapsed) % 24
export const worldTime = (elapsed: number, clock?: SessionClock) => clock ? clockTime(clock, elapsed) : sessionTime(clockHour(elapsed)).slice(0, 5)
export const daylight = (elapsed: number, clock?: SessionClock) => Math.max(0, Math.sin((clockHour(elapsed, clock) - 6) * Math.PI / 12))
// One recorded sample per tick. Rates retain compatibility with saved sessions.
export const sampleIntervalMs = (rate: number) => 6000 / rate
export function skyAt(elapsed: number, clock?: SessionClock) {
  const h = clockHour(elapsed, clock)
  const orbit = (hour: number) => {
    const p = Math.max(0, Math.min(1, hour / 12))
    return { x: 6 + p * 88, y: 152 - Math.sin(p * Math.PI) * 126,
      opacity: hour < 0 || hour > 12 ? 0 : Math.min(1, hour * 2, (12 - hour) * 2) }
  }
  return { sun: orbit(h - 6), moon: orbit((h + 6) % 24),
    light: Math.max(0, Math.min(1, (Math.sin((h - 6) * Math.PI / 12) + .14) / .45)) }
}
export const scenePeriod = (elapsed: number, clock?: SessionClock) => {
  const h = clockHour(elapsed, clock)
  return h < 5 || h >= 19 ? 'Malam' : h < 10 ? 'Pagi' : h < 16 ? 'Siang' : 'Sore'
}
export const feedingDue = (s: Session) => {
  const sim = simulationOf(s)
  return sim.mode === 'journey' && sim.planted && sim.feedEveryDays > 0 && s.data.now_h - sim.lastFedAt >= sim.feedEveryDays * 24
}
const attention = (s: Session) => {
  const code = evaluate(s.data).decision
  return `${['AMATI', 'PERIKSA_SEBELUM_PERGI'].includes(code) ? '' : code}${feedingDue(s) ? ':pupuk' : ''}`
}
export const simulationStopReason = (s: Session) => {
  const sim = simulationOf(s)
  if (!sim.planted) return 'Tanam bibit untuk memulai waktu.'
  if (s.data.samples.length >= 10000) return 'Batas 10.000 sampel tercapai. Ekspor sesi atau mulai pot baru.'
  if (sim.mode === 'journey' && s.data.now_h >= (s.data.profile.crop.toLowerCase().includes('bawang') ? 65 : 90) * 24) return 'Perjalanan selesai. Mulai pot baru untuk melanjutkan.'
  return sim.source === 'manual' ? 'Mode manual: waktu maju saat Tambah sampel ditekan.' : ''
}
export const simulationStopped = (s: Session) => Boolean(simulationStopReason(s))

export function logEvent(s: Session, message: string, kind: LogEntry['kind'] = 'action'): Session {
  const entry = { id: (s.logs.at(-1)?.id ?? 0) + 1, time: sessionTime(s.data.now_h), kind, message }
  return { ...s, updatedAt: Date.now(), logs: [...s.logs, entry].slice(-500) }
}

export function createJourney(profileCase: PotCase): Session {
  const s = createSession({ profile: structuredClone(profileCase.profile), now_h: 0,
    samples: [{ t_h: 0, moisture: 72, temp_c: 24, ph: 6.2, valid: true }] }, `Perjalanan ${profileCase.profile.crop.toLowerCase()}`)
  return { ...s, logs: [], simulation: { ...simulationOf(s), mode: 'journey', source: 'auto', planted: false, rate: 12 } }
}

export function plantSeed(s: Session): Session {
  if (simulationOf(s).planted) return s
  const next = { ...s, clock: { ...s.clock, startedAtMs: Date.now() }, simulation: { ...simulationOf(s), planted: true } }
  return logEvent(next, `Bibit ditanam pukul ${clockTime(next.clock, 0)}. Perjalanan dimulai dari HST 0.`, 'system')
}

// ponytail: these bounded dynamics are a teaching model; replace with calibrated measurements for agronomic prediction.
export function advanceSimulation(session: Session, steps = 1): Session {
  if (!Number.isInteger(steps) || steps < 1 || steps > 48) throw new Error('Langkah waktu harus 1–48 sampel.')
  let s = session
  for (let i = 0; i < steps && !simulationStopped(s); i++) {
    const before = s
    let sim = { ...simulationOf(s) }
    const previous = s.data.samples.at(-1)!, now = s.data.now_h + .5
    const random = () => { sim.seed = (Math.imul(1664525, sim.seed) + 1013904223) >>> 0; return sim.seed / 4294967296 }
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
    const round = (n: number) => Math.round(n * 10) / 10
    const moisture = round(clamp(previous.moisture - (.35 + daylight(now, s.clock) * .65) + sim.pendingWater + (sim.source === 'random' ? (random() - .5) * 8 : 0), 0, 100))
    const temp_c = round(clamp(25 + 5 * Math.cos((clockHour(now, s.clock) - 14) * Math.PI / 12) + (random() - .5) * (sim.source === 'random' ? 8 : .6), -20, 60))
    const ph = Math.floor(now / 24) > Math.floor(s.data.now_h / 24) ? round(6.2 + (random() - .5) * .4) : null
    const oldResult = evaluate(s.data)
    const wasFeedingDue = feedingDue(s)
    const onion = s.data.profile.crop.toLowerCase().includes('bawang')
    const oldPhase = phaseAt(Math.floor(sim.growthHours / 24), onion)
    const data = addSample(s.data, { moisture, temp_c, ph, valid: true })
    const comfortable = moisture >= oldResult.evidence.low && moisture < oldResult.evidence.wet && temp_c < data.profile.hot_c
    sim = { ...sim, pendingWater: 0, growthHours: sim.growthHours + (sim.mode === 'journey' ? (comfortable ? .5 : .1) : 0) }
    const oldDay = s.day
    s = { ...s, data, simulation: sim, day: sim.mode === 'journey' ? Math.floor(now / 24) : s.day,
      reading: { moisture, temp_c, ph: ph ?? s.reading.ph, valid: true }, freshPh: false, scenario: 'custom', updatedAt: Date.now() }
    const result = evaluate(data)
    if (result.decision !== oldResult.decision) s = logEvent(s, `${result.action}. ${result.reason}`, 'rule')
    if (s.day !== oldDay && sim.mode === 'journey') s = logEvent(s, `HST ${s.day}: kelembapan ${moisture}, suhu ${temp_c} °C. ${comfortable ? 'Kondisi mendukung perkembangan dalam model latihan.' : 'Perkembangan dalam model melambat; periksa kondisi media.'}`, 'system')
    if (sim.mode === 'journey' && phaseAt(s.day, onion) !== phaseAt(oldDay, onion)) s = logEvent(s, `Acuan HST ${s.day}: ${phaseAt(s.day, onion)}. Cocokkan dengan varietas dan pengamatan; fase ini tidak dideteksi sensor.`, 'system')
    const newPhase = phaseAt(Math.floor(sim.growthHours / 24), onion)
    if (sim.mode === 'journey' && newPhase !== oldPhase) s = logEvent(s, `Fase model beralih: ${newPhase}.`, 'system')
    if (!wasFeedingDue && feedingDue(s)) s = logEvent(s, 'Pengingat jadwal pupuk pribadi tiba. Periksa rencana perawatan sebelum bertindak; ini bukan deteksi kebutuhan pupuk.', 'system')
    if (shouldPause(s, before)) break
  }
  if (s === session) return s
  return logEvent(s, `${s.data.samples.length - session.data.samples.length} sampel ${simulationOf(s).source === 'random' ? 'acak' : 'otomatis'} ditambahkan. Jam sensor ${sessionTime(s.data.now_h)}.`, 'data')
}

export function waterSimulation(s: Session, volume: number): Session {
  const sim = simulationOf(s)
  if (!sim.planted) throw new Error('Tanam bibit terlebih dahulu.')
  const data = recordWatering(s.data, volume)
  return logEvent({ ...s, data, simulation: { ...sim, pendingWater: Math.min(100, sim.pendingWater + volume / 8) } },
    `Siram ${volume} mL dicatat. Model latihan menerapkan respons pada sampel berikutnya.`)
}

export function recordFertilizer(s: Session): Session {
  const sim = simulationOf(s)
  if (!sim.planted) throw new Error('Tanam bibit terlebih dahulu.')
  return logEvent({ ...s, simulation: { ...sim, lastFedAt: s.data.now_h } }, 'Pemupukan dicatat pengguna. Jadwal dihitung ulang; tidak ada deteksi unsur hara, dosis, atau perubahan sensor yang diasumsikan.')
}

// Resuming acknowledges the current alert; only a new condition pauses again.
export const shouldPause = (s: Session, previous?: Session) => simulationStopped(s) ||
  (simulationOf(s).pauseOnCare && Boolean(attention(s)) && (!previous || attention(s) !== attention(previous)))
