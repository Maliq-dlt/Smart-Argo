/** The plant catalog: one place that says which plants Smart Agro knows and, for the two curated from the paper, how
 * their journey runs. It replaces the `onion` flag and the `'cabai' | 'bawang'` literals that used to be repeated
 * across the engine, the simulator and the dashboard. Data only, no imports, so tests and the browser load it alike.
 *
 * Ids of the curated species stay `cabai` and `bawang`: those strings are already stored in account tokens and saved
 * sessions, so nothing needs an alias or a migration. */
export type CuratedId = 'cabai' | 'bawang'
export type SpeciesId = CuratedId | 'anggrek' | 'peoni'
/** `start` is the first day (HST) of the phase. */
export interface Phase { name: string; start: number }
export interface Species {
  id: SpeciesId
  /** Permanent integer behind the future plant code (`speciesId * 1_000_000 + plant number`, spec section 11): never
   * reuse or renumber one once a code has been issued. Capped at 2146 so a code still fits a Postgres integer. */
  speciesId: number
  name: string
  category: 'sayur_buah' | 'hias' | 'perkebunan'
  form: 'semak' | 'roset' | 'umbi'
  /** `kurasi`: a validated profile exists (the paper). `belajar`: the plant is observed and learned from, no profile. */
  tier: 'kurasi' | 'belajar'
}
/** A curated species also carries what the simulator needs: the scenario it opens (scenarios.json), how many days its
 * illustration takes to reach full size, the last day of the journey, and its reference phases. */
export interface Curated extends Species { id: CuratedId; tier: 'kurasi'; scenario: number; growthDays: number; maxDay: number; phases: readonly Phase[] }

const CURATED: Record<CuratedId, Curated> = {
  cabai: {
    id: 'cabai', speciesId: 1, name: 'Cabai', category: 'sayur_buah', form: 'semak', tier: 'kurasi',
    scenario: 0, growthDays: 62, maxDay: 90,
    phases: [{ name: 'Awal tanam', start: 0 }, { name: 'Vegetatif', start: 1 }, { name: 'Berbunga', start: 31 }, { name: 'Berbuah', start: 56 }],
  },
  bawang: {
    id: 'bawang', speciesId: 2, name: 'Bawang merah', category: 'sayur_buah', form: 'umbi', tier: 'kurasi',
    scenario: 7, growthDays: 48, maxDay: 65,
    phases: [{ name: 'Awal tanam', start: 0 }, { name: 'Vegetatif', start: 1 }, { name: 'Pembentukan umbi', start: 26 }, { name: 'Pematangan umbi', start: 51 }],
  },
}
export const CURATED_IDS: readonly CuratedId[] = ['cabai', 'bawang']
export const SPECIES: readonly Species[] = [
  CURATED.cabai,
  CURATED.bawang,
  { id: 'anggrek', speciesId: 3, name: 'Anggrek bulan', category: 'hias', form: 'roset', tier: 'belajar' },
  { id: 'peoni', speciesId: 4, name: 'Peoni', category: 'hias', form: 'semak', tier: 'belajar' },
]

export const curated = (id: CuratedId): Curated => CURATED[id]
/** Token metadata is written by its owner, so an inherited key like "constructor" must not pass: use the list, not `in`. */
export const isCuratedId = (value: unknown): value is CuratedId => CURATED_IDS.includes(value as CuratedId)
/** Saved sessions carry the crop as free text (scenarios.json `profile.crop`), not an id. Same rule the simulator
 * always used: "bawang" anywhere selects the shallot, everything else is chili.
 * ponytail: only two curated species exist; when Fase 4 stores the species id inside the session, read it from there. */
export const speciesOfCrop = (crop: string): CuratedId => crop.toLowerCase().includes('bawang') ? 'bawang' : 'cabai'
/** "0", "1–30", … for the phase guide: each phase runs to the day before the next starts, the last to `maxDay`. */
export function phaseRanges(id: CuratedId): [range: string, name: string][] {
  const { phases, maxDay } = CURATED[id]
  return phases.map((phase, i) => {
    const last = i + 1 < phases.length ? phases[i + 1].start - 1 : maxDay
    return [last === phase.start ? `${phase.start}` : `${phase.start}–${last}`, phase.name]
  })
}
