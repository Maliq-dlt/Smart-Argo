import type { PotCase, Sample } from './agronomyEngine.ts'
import type { LogEntry } from './sessionStore.ts'

export type Metric = 'moisture' | 'temp_c' | 'ph'
export const METRICS = {
  moisture: { label: 'Kelembapan', unit: 'poin', min: 0, max: 100 },
  temp_c: { label: 'Suhu', unit: '°C', min: -20, max: 60 },
  ph: { label: 'pH', unit: 'pH', min: 0, max: 14 },
} as const

/** Never imply continuity through invalid, unmeasured, or missing-hour samples. */
export function chartSegments(rows: Sample[], metric: Metric): Sample[][] {
  const segments: Sample[][] = []
  let current: Sample[] = []
  for (const row of rows) {
    if (!row.valid || row[metric] === null) { current = []; continue }
    if (!current.length || row.t_h - current.at(-1)!.t_h > 1) {
      current = []; segments.push(current)
    }
    current.push(row)
  }
  return segments
}

/** Descriptive statistics use measured, valid samples only; missing pH is never zero. */
export function summarizeSamples(rows: Sample[], metric: Metric) {
  const spec = METRICS[metric]
  const values = rows.filter(r => r.valid && r[metric] !== null).map(r => r[metric]!)
  const failed = rows.filter(r => !r.valid).length
  const missing = rows.length - failed - values.length
  const mean = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null
  const bins = Array.from({ length: 5 }, (_, i) => ({
    low: spec.min + (spec.max - spec.min) * i / 5,
    high: spec.min + (spec.max - spec.min) * (i + 1) / 5, count: 0,
  }))
  for (const v of values) bins[Math.min(4, Math.max(0, Math.floor((v - spec.min) / (spec.max - spec.min) * 5)))].count++
  const days = new Map<number, { hour: number; min: number; max: number; sum: number; count: number }>()
  for (const r of rows) {
    if (!r.valid || r[metric] === null) continue
    const hour = Math.floor(r.t_h / 24) * 24, v = r[metric]!
    const day = days.get(hour) ?? { hour, min: v, max: v, sum: 0, count: 0 }
    day.min = Math.min(day.min, v); day.max = Math.max(day.max, v); day.sum += v; day.count++
    days.set(hour, day)
  }
  return { count: values.length, failed, missing, mean, min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null, bins, days: [...days.values()].slice(-7) }
}

export interface CareEvent { t_h: number; kind: 'water' | 'feed' | 'plant'; label: string; message: string }

// ponytail: existing log messages identify care; add typed events when care persistence changes.
export function careEvents(logs: readonly LogEntry[], data: PotCase): CareEvent[] {
  const events: CareEvent[] = []
  logs.forEach(log => {
    const time = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(log.time)
    if (!time) return
    const hour = +time[1] + +time[2] / 60 + +time[3] / 3600
    if (!Number.isFinite(hour) || hour > data.now_h) return
    const water = log.kind === 'action' ? /^(?:Siram|Penyiraman) \d+(?:\.\d+)? mL dicatat\./.exec(log.message) : null
    const kind = water ? 'water' : log.kind === 'action' && log.message.startsWith('Pemupukan dicatat pengguna.') ? 'feed' :
      log.kind === 'system' && log.message.startsWith('Bibit ditanam pukul ') ? 'plant' : null
    if (kind) events.push({ t_h: hour, kind,
      label: water ? water[0].replace(' dicatat.', '') : kind === 'feed' ? 'Pupuk dicatat' : 'Bibit ditanam', message: log.message })
  })
  const water = data.watering
  if (water && !events.some(event => event.kind === 'water' && Math.abs(event.t_h - water.t_h) < 1 / 3600)) {
    events.push({ t_h: water.t_h, kind: 'water', label: `Siram ${water.volume_ml} mL`, message: 'Siraman tercatat dalam data sesi. Volume bukan saran dosis.' })
  }
  return events.sort((a, b) => a.t_h - b.t_h)
}
