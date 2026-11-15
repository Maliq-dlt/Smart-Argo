/** Pure helpers behind the dashboard: moisture zones, the sky period, growth-phase steps and short "ago" labels. (The sun and moon are drawn by the pot stage, `components/plantScene/sky.ts`.) */
import { curated, type CuratedId } from './species.ts'

export type Zone = 'dry' | 'ok' | 'wet'
export const zoneOf = (value: number, low: number, wet: number): Zone => value < low ? 'dry' : value > wet ? 'wet' : 'ok'
export const ZONE_NAME: Record<Zone, string> = { dry: 'kering', ok: 'ideal', wet: 'basah' }

export type SkyPeriod = 'pagi' | 'siang' | 'sore' | 'malam'
/** Same boundaries as `scenePeriod` in simulation.ts (a test keeps them equal). */
export const skyPeriod = (hour: number): SkyPeriod => hour < 5 || hour >= 19 ? 'malam' : hour < 10 ? 'pagi' : hour < 16 ? 'siang' : 'sore'

/** The journey's phases for a curated species, from the catalog (species.ts); `phaseAt` in agronomyEngine.ts reads the same table. */
export function phaseSteps(id: CuratedId) {
  const { phases, maxDay } = curated(id)
  return { names: phases.map(p => p.name), starts: phases.map(p => p.start), total: maxDay }
}
export const phaseIndex = (day: number, id: CuratedId) => phaseSteps(id).starts.reduce((index, start, i) => day >= start ? i : index, 0)

/** "30 m", "1 j 30 m", "2 hr 3 j": how long before now a reading was taken. */
export function agoLabel(hours: number) {
  const minutes = Math.round(hours * 60)
  if (minutes < 60) return `${minutes} m`
  if (minutes < 1440) { const h = Math.floor(minutes / 60), m = minutes % 60; return m ? `${h} j ${m} m` : `${h} j` }
  const d = Math.floor(minutes / 1440), h = Math.round((minutes % 1440) / 60)
  return h ? `${d} hr ${h} j` : `${d} hr`
}
