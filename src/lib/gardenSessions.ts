/** Simulator sessions for the plants of a garden. A curated species opens the scenario of the paper; a learning species has no
 * validated profile, so its session says so (`validated: false` makes the engine hold back watering advice) and uses the same
 * synthetic readings. Nothing here is a measurement: the readings are the simulator's. */
import scenarios from './scenarios.json' with { type: 'json' }
import { daysBetween } from './garden.ts'
import { createSession, type Session } from './sessionStore.ts'
import { advanceSimulation, createJourney, plantSeed, simulationOf, waterSimulation } from './simulation.ts'
import { curated, isCuratedId, speciesById, type SpeciesId } from './species.ts'

/** A plant older than this is simulated for this long and no longer: the history is synthetic anyway. */
export const MAX_BACKFILL_DAYS = 60
/** Moisture at which the imagined gardener waters; it keeps the media in the comfortable band. */
const WATER_BELOW = 58

/** A scenario opened as a running session, as the simulator has always done it. */
export function loadScenario(index: number): Session {
  const session = createSession(scenarios[index], scenarios[index].name, String(index), index === 7 ? 25 : 42)
  return { ...session, simulation: { ...simulationOf(session), source: 'auto' as const, rate: 12 } }
}

/** The session a species starts from. */
export function loadSpeciesScenario(id: SpeciesId): Session {
  if (isCuratedId(id)) return loadScenario(curated(id).scenario)
  const species = speciesById(id), base = scenarios[0]
  const profile = { ...base.profile, crop: species.name, media: 'Kulit kayu', phase: species.phases[0].name, validated: false, ph_validated: false }
  const session = createSession({ ...base, name: `${species.name} (belajar)`, profile }, `${species.name} (belajar)`, '0', 0)
  return { ...session, simulation: { ...simulationOf(session), source: 'auto' as const, rate: 12 } }
}

/** A planted journey for a slot, aged to the day it was planted. The plant is assumed well kept (watered whenever the media
 * has dried a little), so a plant that went in a month ago looks a month old rather than stunted. A sample is half an hour. */
export function createSlotSession(id: SpeciesId, name: string, plantedOn: string, today: string): Session {
  let session = plantSeed({ ...createJourney(loadSpeciesScenario(id).data), name })
  const days = Math.min(MAX_BACKFILL_DAYS, Math.max(0, daysBetween(plantedOn, today)))
  for (let half = 0; half < days * 2; half++) {
    if (session.data.samples.at(-1)!.moisture < WATER_BELOW) session = waterSimulation(session, 150)
    session = advanceSimulation(session, 24) // half a day
  }
  return session
}
