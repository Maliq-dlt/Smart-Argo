/** The plant catalog: one place that says which plants Smart Agro knows and, for the two curated from the paper, how
 * their journey runs. It replaces the `onion` flag and the `'cabai' | 'bawang'` literals that used to be repeated
 * across the engine, the simulator and the dashboard. Data only, no imports, so tests and the browser load it alike.
 *
 * Ids of the curated species stay `cabai` and `bawang`: those strings are already stored in account tokens and saved
 * sessions, so nothing needs an alias or a migration. */
export type CuratedId = 'cabai' | 'bawang'
export type SpeciesId = CuratedId | 'anggrek' | 'peoni'
/** The pots the stage can draw (components/plantScene/plants.ts). */
export type SceneId = 'cabai' | 'bawang' | 'anggrek'
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
  /** Other names people type when they look for it, and its Latin name; both only feed `searchSpecies`. */
  aliases: readonly string[]
  latin: string
  /** Which drawing shows it, or null while it has none (it cannot be planted in the app until it does). */
  scene: SceneId | null
  /** Days its illustration takes to reach full size, the last day of the journey, and its reference phases. A learning
   * species has no validated phases: it is only "Mengamati" until a profile is curated. */
  growthDays: number
  maxDay: number
  phases: readonly Phase[]
}
/** A curated species also carries the scenario it opens (scenarios.json). */
export interface Curated extends Species { id: CuratedId; tier: 'kurasi'; scenario: number }

const LEARNING_PHASES: readonly Phase[] = [{ name: 'Mengamati', start: 0 }]
const CURATED: Record<CuratedId, Curated> = {
  cabai: {
    id: 'cabai', speciesId: 1, name: 'Cabai', category: 'sayur_buah', form: 'semak', tier: 'kurasi',
    aliases: ['cabe', 'lombok', 'cabai rawit', 'cabai merah'], latin: 'Capsicum annuum', scene: 'cabai',
    scenario: 0, growthDays: 62, maxDay: 90,
    phases: [{ name: 'Awal tanam', start: 0 }, { name: 'Vegetatif', start: 1 }, { name: 'Berbunga', start: 31 }, { name: 'Berbuah', start: 56 }],
  },
  bawang: {
    id: 'bawang', speciesId: 2, name: 'Bawang merah', category: 'sayur_buah', form: 'umbi', tier: 'kurasi',
    aliases: ['bawang', 'shallot', 'brambang'], latin: 'Allium cepa var. aggregatum', scene: 'bawang',
    scenario: 7, growthDays: 48, maxDay: 65,
    phases: [{ name: 'Awal tanam', start: 0 }, { name: 'Vegetatif', start: 1 }, { name: 'Pembentukan umbi', start: 26 }, { name: 'Pematangan umbi', start: 51 }],
  },
}
export const CURATED_IDS: readonly CuratedId[] = ['cabai', 'bawang']
export const SPECIES: readonly Species[] = [
  CURATED.cabai,
  CURATED.bawang,
  { id: 'anggrek', speciesId: 3, name: 'Anggrek bulan', category: 'hias', form: 'roset', tier: 'belajar', aliases: ['anggrek', 'orchid', 'phalaenopsis'], latin: 'Phalaenopsis amabilis', scene: 'anggrek', growthDays: 120, maxDay: 180, phases: LEARNING_PHASES },
  { id: 'peoni', speciesId: 4, name: 'Peoni', category: 'hias', form: 'semak', tier: 'belajar', aliases: ['peony', 'paeonia', 'mawar cina'], latin: 'Paeonia lactiflora', scene: null, growthDays: 120, maxDay: 180, phases: LEARNING_PHASES },
]
const BY_ID = new Map<string, Species>(SPECIES.map(species => [species.id, species]))
/** Any species of the catalog by its id. */
export const speciesById = (id: SpeciesId): Species => BY_ID.get(id) as Species
/** A species by the integer that is part of its plants' codes (`speciesId`), or undefined for a number that is not in the catalog. */
export const speciesByCode = (code: number): Species | undefined => SPECIES.find(species => species.speciesId === code)
/** The species a visitor can plant: those the stage can draw. */
export const PLANTABLE: readonly Species[] = SPECIES.filter(species => species.scene !== null)
/** The drawing for a species; an undrawn one is shown as the orchid, the plainest pot. */
export const sceneOf = (id: SpeciesId): SceneId => speciesById(id).scene ?? 'anggrek'

export const curated = (id: CuratedId): Curated => CURATED[id]
/** Token metadata is written by its owner, so an inherited key like "constructor" must not pass: use the list, not `in`. */
export const isCuratedId = (value: unknown): value is CuratedId => CURATED_IDS.includes(value as CuratedId)
/** Saved sessions carry the crop as free text (`profile.crop`), not an id. "bawang" anywhere selects the shallot, a name
 * with "anggrek" or "peoni" selects that learning species, and everything else is chili, as it always was.
 * ponytail: a session does not store its species id yet; read the crop text until a third curated species needs more. */
export function speciesOfCrop(crop: string): SpeciesId {
  const text = crop.toLowerCase()
  return text.includes('bawang') ? 'bawang' : text.includes('anggrek') ? 'anggrek' : text.includes('peoni') ? 'peoni' : 'cabai'
}
/** "0", "1–30", … for the phase guide: each phase runs to the day before the next starts, the last to `maxDay`. */
export function phaseRanges(id: SpeciesId): [range: string, name: string][] {
  const { phases, maxDay } = speciesById(id)
  return phases.map((phase, i) => {
    const last = i + 1 < phases.length ? phases[i + 1].start - 1 : maxDay
    return [last === phase.start ? `${phase.start}` : `${phase.start}–${last}`, phase.name]
  })
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
/** Species whose name, alias or Latin name contains every word typed (accents and case ignored). The best matches come
 * first (the name starts with the query, then an alias does); an empty query lists the whole catalog. */
export function searchSpecies(query: string): Species[] {
  const q = fold(query), words = q.split(/\s+/).filter(Boolean)
  if (!words.length) return [...SPECIES]
  const rank = (species: Species) => fold(species.name).startsWith(q) ? 0 : species.aliases.some(alias => fold(alias).startsWith(q)) ? 1 : 2
  return SPECIES.filter(species => { const hay = fold([species.name, ...species.aliases, species.latin].join(' ')); return words.every(word => hay.includes(word)) })
    .map((species, order) => ({ species, order, rank: rank(species) })).sort((a, b) => a.rank - b.rank || a.order - b.order).map(entry => entry.species)
}
/** "Cabai 3": the name a plant gets when its owner gives none. */
export const plantNickname = (species: Species, ordinal: number) => `${species.name} ${ordinal}`
