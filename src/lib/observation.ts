/** What a plant without a curated profile lets us learn from its own pot: how long it has been watched, what the person
 * checked, how the media dries by day and how it answers a watering. Plain arithmetic on the readings, the same output for the
 * same input; no model is involved and nothing here claims what is good for the species. Times are session hours (the hours
 * the readings carry), not clock times. */

export type InspectionState = 'sehat' | 'biasa' | 'bermasalah'
/** A look at the plant by its owner at session hour `t_h`. */
export interface Inspection { t_h: number; state: InspectionState; note?: string }
/** The part of a sensor sample this module reads. */
export interface ReadingPoint { t_h: number; moisture: number; valid: boolean }
export interface Thresholds { days: number; inspections: number; waterings: number }
/** Enough to say something about the pot itself: a week, three checks, two waterings whose effect was seen. */
export const THRESHOLDS: Thresholds = { days: 7, inspections: 3, waterings: 2 }
export interface Observation { days: number; readings: number; waterings: number; inspections: Inspection[] }

const BEFORE_H = 2, AFTER_H = 3, HEALTHY_WINDOW_H = 6, MIN_HEALTHY_READINGS = 3
const DAY_FROM = 8, DAY_TO = 16, MAX_GAP_H = 1.5, MIN_PAIRS = 2, RISE_TOLERANCE = 0.5
/** With no clock given, session hour 0 is 06:00, as in the simulator. */
const defaultHourOf = (t_h: number) => ((6 + t_h) % 24 + 24) % 24

const usable = (samples: ReadingPoint[]) => samples.filter(p => p.valid && Number.isFinite(p.t_h) && Number.isFinite(p.moisture)).sort((a, b) => a.t_h - b.t_h)
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/** Session hours of the waterings a session logged: the lines that record one ("Siram 150 mL dicatat…"), not a cancelled
 * one, whose line is rewritten. */
export function wateringTimes(logs: { kind: string; time: string; message: string }[]): number[] {
  return logs.filter(log => log.kind === 'action' && /^Siram \d/.test(log.message)).map(log => {
    const [h, m, s] = log.time.split(':').map(Number)
    return h + m / 60 + s / 3600
  }).filter(Number.isFinite).sort((a, b) => a - b)
}

/** Waterings with a reading just before (within two hours) and one just after (within three), with the rise between them:
 * the highest reading after, minus the last reading before. */
export function measuredWaterings(samples: ReadingPoint[], wateringAt: number[]): { at: number; delta: number }[] {
  const points = usable(samples), out: { at: number; delta: number }[] = []
  for (const at of wateringAt) {
    const before = points.filter(p => p.t_h <= at && p.t_h >= at - BEFORE_H).at(-1)
    const after = points.filter(p => p.t_h > at && p.t_h <= at + AFTER_H)
    if (before && after.length) out.push({ at, delta: Math.max(...after.map(p => p.moisture)) - before.moisture })
  }
  return out
}
/** The mean rise in moisture points after a watering, or null when none of them was measured. */
export function waterResponse(samples: ReadingPoint[], wateringAt: number[]): number | null {
  const measured = measuredWaterings(samples, wateringAt)
  return measured.length ? round(mean(measured.map(m => m.delta)), 1) : null
}

/** Moisture points lost per hour between consecutive readings taken in daylight, or null with fewer than two such pairs. A pair
 * with a rise in it (a watering, a jump) is not drying and is left out, as are gaps longer than an hour and a half. */
export function dryingRate(samples: ReadingPoint[], hourOf: (t_h: number) => number = defaultHourOf): number | null {
  const points = usable(samples), rates: number[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dt = b.t_h - a.t_h
    if (dt <= 0 || dt > MAX_GAP_H || b.moisture > a.moisture + RISE_TOLERANCE) continue
    const ha = hourOf(a.t_h), hb = hourOf(b.t_h)
    if (ha < DAY_FROM || ha > DAY_TO || hb < DAY_FROM || hb > DAY_TO) continue
    rates.push((a.moisture - b.moisture) / dt)
  }
  return rates.length >= MIN_PAIRS ? round(mean(rates), 2) : null
}

/** The range of moisture readings in the six hours after any check that found the plant "sehat", rounded outward to whole
 * points, or null when those hours hold fewer than three readings. It describes this pot on days its owner found it well. */
export function healthyMoistureRange(samples: ReadingPoint[], inspections: Inspection[]): [number, number] | null {
  const points = usable(samples), found = new Set<ReadingPoint>()
  for (const check of inspections) if (check.state === 'sehat') for (const p of points) if (p.t_h >= check.t_h && p.t_h <= check.t_h + HEALTHY_WINDOW_H) found.add(p)
  if (found.size < MIN_HEALTHY_READINGS) return null
  const values = [...found].map(p => p.moisture)
  return [Math.floor(Math.min(...values)), Math.ceil(Math.max(...values))]
}

/** What has been seen so far: whole days from the first reading to the last, how many readings, how many waterings had their
 * effect measured, and the checks. */
export function observe(samples: ReadingPoint[], inspections: Inspection[], wateringAt: number[]): Observation {
  const points = usable(samples)
  return {
    days: points.length >= 2 ? Math.floor((points[points.length - 1].t_h - points[0].t_h) / 24) : 0,
    readings: points.length, waterings: measuredWaterings(points, wateringAt).length, inspections: [...inspections],
  }
}

/** Level 1 (the pot's own pattern) once every threshold is met; otherwise level 0 (only watching). */
export function evidenceLevel(o: Observation, th: Thresholds = THRESHOLDS): 0 | 1 {
  return o.days >= th.days && o.inspections.length >= th.inspections && o.waterings >= th.waterings ? 1 : 0
}
/** How much is still missing for each threshold. */
export function remaining(o: Observation, th: Thresholds = THRESHOLDS): { days: number; inspections: number; waterings: number } {
  return { days: Math.max(0, th.days - o.days), inspections: Math.max(0, th.inspections - o.inspections.length), waterings: Math.max(0, th.waterings - o.waterings) }
}
