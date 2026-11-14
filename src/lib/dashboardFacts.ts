/** Pure helpers behind the dashboard: moisture zones, the sky's sun and moon, growth-phase steps and short "ago" labels. */

export type Zone = 'dry' | 'ok' | 'wet'
export const zoneOf = (value: number, low: number, wet: number): Zone => value < low ? 'dry' : value > wet ? 'wet' : 'ok'
export const ZONE_NAME: Record<Zone, string> = { dry: 'kering', ok: 'ideal', wet: 'basah' }

export type SkyPeriod = 'pagi' | 'siang' | 'sore' | 'malam'
/** Same boundaries as `scenePeriod` in simulation.ts (a test keeps them equal). */
export const skyPeriod = (hour: number): SkyPeriod => hour < 5 || hour >= 19 ? 'malam' : hour < 10 ? 'pagi' : hour < 16 ? 'siang' : 'sore'

/** A body along an arc, in percent of the stage. `hours` is time since it rose; it is visible for 12 hours. */
export function orbit(hours: number) {
  const p = Math.min(1, Math.max(0, hours / 12))
  return { x: 28 + p * 68, y: 78 - Math.sin(p * Math.PI) * 60, opacity: hours < 0 || hours > 12 ? 0 : Math.min(1, hours * 2, (12 - hours) * 2) }
}
export const skyOrbits = (hour: number) => ({ sun: orbit(hour - 6), moon: orbit((hour + 6) % 24) })

/** The journey's phases, matching `phaseAt` in agronomyEngine.ts (chili 0/≤30/≤55/after, 90 days; shallot 0/≤25/≤50/after, 65 days). */
export function phaseSteps(onion: boolean) {
  return onion
    ? { names: ['Awal tanam', 'Vegetatif', 'Pembentukan umbi', 'Pematangan umbi'], starts: [0, 1, 26, 51], total: 65 }
    : { names: ['Awal tanam', 'Vegetatif', 'Berbunga', 'Berbuah'], starts: [0, 1, 31, 56], total: 90 }
}
export const phaseIndex = (day: number, onion: boolean) => phaseSteps(onion).starts.reduce((index, start, i) => day >= start ? i : index, 0)

/** "30 m", "1 j 30 m", "2 hr 3 j": how long before now a reading was taken. */
export function agoLabel(hours: number) {
  const minutes = Math.round(hours * 60)
  if (minutes < 60) return `${minutes} m`
  if (minutes < 1440) { const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h} j ${m} m` : `${h} j` }
  const d = Math.floor(minutes / 1440), h = Math.round((minutes % 1440) / 60)
  return h ? `${d} hr ${h} j` : `${d} hr`
}
