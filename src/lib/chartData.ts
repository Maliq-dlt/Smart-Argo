import type { Sample } from './agronomyEngine.ts'

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
