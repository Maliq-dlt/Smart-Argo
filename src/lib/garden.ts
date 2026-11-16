/** Where a person's plants live: sites (a personal pot or a garden), the slots in them (a pot has one, a garden has a zone
 * each) and the cycles that have grown in each slot. Pure and immutable: every function returns a new book, so the app can
 * keep it in React state and the same code can later validate what a server sends back.
 *
 * A *cycle* is one plant's time in a slot, from planting to the day it is replaced or finished. Replacing a plant closes
 * the cycle (it keeps its dates and outcome) and opens another; nothing of the old one is rewritten. */
import { SPECIES, plantNickname } from './species.ts'
import type { Placement } from './weather.ts'

export type { Placement }
export type Outcome = 'berhasil' | 'gagal' | 'dihentikan'
export interface Site { id: string; name: string; kind: 'pot' | 'garden'; placement: Placement; location?: { lat: number; lon: number } }
export interface Cycle { id: string; speciesId: number; plantNo: number; nickname: string; plantedOn: string; endedOn?: string; outcome?: Outcome }
export interface Slot { id: string; siteId: string; name: string; sessionId: string | null; cycles: Cycle[] }
export interface GardenBook { sites: Site[]; slots: Slot[]; activeSlotId: string | null; nextPlantNo: Record<number, number> }
export interface PlantInput { speciesId: number; plantedOn: string; nickname?: string }
export interface Location { lat: number; lon: number }

export const PLACEMENTS: readonly Placement[] = ['indoor', 'outdoor', 'rooftop']
const OUTCOMES: readonly Outcome[] = ['berhasil', 'gagal', 'dihentikan']
const MAX_SITES = 20, MAX_SLOTS = 60, MAX_CYCLES = 100, MAX_NAME = 60, MAX_ZONES = 12, MAX_PLANT_NO = 999_999, MAX_SPECIES_ID = 2146

export const emptyGarden = (): GardenBook => ({ sites: [], slots: [], activeSlotId: null, nextPlantNo: {} })

/** The integer a plant is known by: its species times a million plus its number. */
export function plantCode(speciesId: number, plantNo: number): number {
  if (!Number.isInteger(speciesId) || speciesId < 1 || speciesId > MAX_SPECIES_ID) throw new RangeError(`speciesId harus bilangan bulat 1..${MAX_SPECIES_ID}`)
  if (!Number.isInteger(plantNo) || plantNo < 1 || plantNo > MAX_PLANT_NO) throw new RangeError(`plantNo harus bilangan bulat 1..${MAX_PLANT_NO}`)
  return speciesId * 1_000_000 + plantNo
}

const isDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().startsWith(x)
/** The date `days` before (or, when negative, after) an ISO date, in UTC so a time zone never shifts it. */
export const shiftDate = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
/** Whole days from one ISO date to a later one. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const species = (speciesId: number) => {
  const found = SPECIES.find(s => s.speciesId === speciesId)
  if (!found) throw new RangeError(`Spesies ${speciesId} tidak ada di katalog`)
  return found
}
const name = (raw: unknown, what: string) => {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (!text || text.length > MAX_NAME) throw new RangeError(`${what} harus 1..${MAX_NAME} karakter`)
  return text
}
const place = (location: unknown): Location | undefined => {
  if (location === undefined) return undefined
  const { lat, lon } = (location ?? {}) as Partial<Location>
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new RangeError('Lokasi harus lat -90..90 dan lon -180..180')
  return { lat, lon }
}
/** The smallest `prefix + number` that no one in `taken` uses, so ids stay short, unique and the same on every run. */
const uid = (prefix: string, taken: string[]) => { let n = 1; while (taken.includes(`${prefix}${n}`)) n++; return `${prefix}${n}` }
const findSlot = (book: GardenBook, slotId: string) => {
  const slot = book.slots.find(s => s.id === slotId)
  if (!slot) throw new RangeError(`Slot ${slotId} tidak ada`)
  return slot
}
const replaceSlot = (book: GardenBook, slot: Slot): GardenBook => ({ ...book, slots: book.slots.map(s => s.id === slot.id ? slot : s) })

export const activeCycle = (slot: Slot): Cycle | undefined => slot.cycles.find(c => c.endedOn === undefined)

/** Opens a cycle in a slot that has no active one. */
function open(book: GardenBook, slot: Slot, input: PlantInput): GardenBook {
  const sp = species(input.speciesId)
  if (!isDate(input.plantedOn)) throw new RangeError('Tanggal tanam harus berbentuk YYYY-MM-DD')
  if (activeCycle(slot)) throw new RangeError('Slot masih berisi tanaman; gunakan switchPlant')
  if (slot.cycles.length >= MAX_CYCLES) throw new RangeError('Riwayat slot penuh')
  const plantNo = book.nextPlantNo[sp.speciesId] ?? 1
  plantCode(sp.speciesId, plantNo) // refuses a number past the code's range
  const cycle: Cycle = { id: uid('c', book.slots.flatMap(s => s.cycles.map(c => c.id))), speciesId: sp.speciesId, plantNo, nickname: input.nickname?.trim() ? name(input.nickname, 'Nama panggilan') : plantNickname(sp, plantNo), plantedOn: input.plantedOn }
  return { ...replaceSlot(book, { ...slot, cycles: [...slot.cycles, cycle] }), nextPlantNo: { ...book.nextPlantNo, [sp.speciesId]: plantNo + 1 } }
}

export function plantInSlot(book: GardenBook, slotId: string, speciesId: number, plantedOn: string, nickname?: string): GardenBook {
  return open(book, findSlot(book, slotId), { speciesId, plantedOn, nickname })
}

/** Replaces the plant in a slot. The active cycle ends on `on` with `outcome` (stopped, unless said otherwise) and a new one
 * starts the same day; earlier cycles are never touched. Asking for the species already growing there that day changes nothing. */
export function switchPlant(book: GardenBook, slotId: string, speciesId: number, on: string, outcome: Outcome = 'dihentikan', nickname?: string): GardenBook {
  const slot = findSlot(book, slotId), active = activeCycle(slot)
  if (!OUTCOMES.includes(outcome)) throw new RangeError('Hasil siklus tidak dikenal')
  if (!active) return open(book, slot, { speciesId, plantedOn: on, nickname })
  if (active.speciesId === speciesId && active.plantedOn === on) return book
  if (!isDate(on) || on < active.plantedOn) throw new RangeError('Tanggal ganti tidak boleh sebelum tanggal tanam')
  const closed: Slot = { ...slot, cycles: slot.cycles.map(c => c === active ? { ...c, endedOn: on, outcome } : c) }
  return open(replaceSlot(book, closed), closed, { speciesId, plantedOn: on, nickname })
}

function addSite(book: GardenBook, kind: Site['kind'], input: { name: string; placement: Placement; location?: Location }): { book: GardenBook; site: Site } {
  if (book.sites.length >= MAX_SITES) throw new RangeError('Jumlah pot dan kebun sudah di batas')
  if (!PLACEMENTS.includes(input.placement)) throw new RangeError('Penempatan tidak dikenal')
  const location = input.placement === 'indoor' ? undefined : place(input.location) // an indoor place has no weather to look up
  const site: Site = { id: uid('s', book.sites.map(s => s.id)), name: name(input.name, 'Nama'), kind, placement: input.placement, ...(location && { location }) }
  return { book: { ...book, sites: [...book.sites, site] }, site }
}
function addSlotTo(book: GardenBook, site: Site, slotName: string, plant?: PlantInput): { book: GardenBook; slot: Slot } {
  if (book.slots.length >= MAX_SLOTS) throw new RangeError('Jumlah slot sudah di batas')
  const slot: Slot = { id: uid('z', book.slots.map(s => s.id)), siteId: site.id, name: name(slotName, 'Nama slot'), sessionId: null, cycles: [] }
  let next: GardenBook = { ...book, slots: [...book.slots, slot], activeSlotId: book.activeSlotId ?? slot.id }
  if (plant) next = open(next, slot, plant)
  return { book: next, slot }
}

/** A personal pot is one site with one slot of the same name. */
export function addPersonalPot(book: GardenBook, input: { name: string; placement: Placement; location?: Location; plant?: PlantInput }): GardenBook {
  const added = addSite(book, 'pot', input)
  const { book: next, slot } = addSlotTo(added.book, added.site, input.name, input.plant)
  return { ...next, activeSlotId: slot.id }
}
/** A garden is one site with a slot for each zone, each optionally planted. */
export function addGarden(book: GardenBook, input: { name: string; placement: Placement; location?: Location; zones: { name: string; plant?: PlantInput }[] }): GardenBook {
  if (input.zones.length < 1 || input.zones.length > MAX_ZONES) throw new RangeError(`Kebun perlu 1..${MAX_ZONES} zona`)
  const added = addSite(book, 'garden', input)
  let next = added.book, first: string | null = null
  for (const zone of input.zones) { const result = addSlotTo(next, added.site, zone.name, zone.plant); next = result.book; first ??= result.slot.id }
  return { ...next, activeSlotId: first }
}
/** One more zone in a garden; a personal pot has only its one slot. */
export function addSlot(book: GardenBook, siteId: string, slotName: string): GardenBook {
  const site = book.sites.find(s => s.id === siteId)
  if (!site) throw new RangeError(`Situs ${siteId} tidak ada`)
  if (site.kind === 'pot') throw new RangeError('Pot pribadi hanya punya satu slot')
  return addSlotTo(book, site, slotName).book
}
export function bindSession(book: GardenBook, slotId: string, sessionId: string): GardenBook {
  return replaceSlot(book, { ...findSlot(book, slotId), sessionId })
}
export function setActiveSlot(book: GardenBook, slotId: string): GardenBook {
  findSlot(book, slotId)
  return { ...book, activeSlotId: slotId }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const text = (x: unknown, max = MAX_NAME) => { if (typeof x !== 'string' || !x.trim() || x.length > max) throw new Error('Teks kebun tidak valid'); return x }
const integer = (x: unknown, low: number, high: number) => { if (typeof x !== 'number' || !Number.isInteger(x) || x < low || x > high) throw new Error('Angka kebun tidak valid'); return x }

/** Reads what the browser stored (or, later, what a server returns). Anything damaged throws, so the caller keeps the old
 * data aside instead of treating a broken book as an empty one. */
export function parseGarden(raw: unknown): GardenBook {
  if (!isRecord(raw) || !Array.isArray(raw.sites) || !Array.isArray(raw.slots) || !isRecord(raw.nextPlantNo)) throw new Error('Format kebun tidak valid')
  if (raw.sites.length > MAX_SITES || raw.slots.length > MAX_SLOTS) throw new Error('Kebun terlalu besar')
  const sites: Site[] = raw.sites.map(item => {
    if (!isRecord(item) || (item.kind !== 'pot' && item.kind !== 'garden') || !PLACEMENTS.includes(item.placement as Placement)) throw new Error('Situs tidak valid')
    const location = item.location === undefined ? undefined : place(item.location)
    return { id: text(item.id, 40), name: text(item.name), kind: item.kind, placement: item.placement as Placement, ...(location && { location }) }
  })
  const slots: Slot[] = raw.slots.map(item => {
    if (!isRecord(item) || !Array.isArray(item.cycles) || item.cycles.length > MAX_CYCLES || (item.sessionId !== null && typeof item.sessionId !== 'string')) throw new Error('Slot tidak valid')
    const cycles: Cycle[] = item.cycles.map(c => {
      if (!isRecord(c) || !isDate(c.plantedOn) || (c.endedOn !== undefined && (!isDate(c.endedOn) || c.endedOn < c.plantedOn))) throw new Error('Siklus tidak valid')
      if ((c.endedOn === undefined) !== (c.outcome === undefined) || (c.outcome !== undefined && !OUTCOMES.includes(c.outcome as Outcome))) throw new Error('Hasil siklus tidak valid')
      const speciesId = integer(c.speciesId, 1, MAX_SPECIES_ID), plantNo = integer(c.plantNo, 1, MAX_PLANT_NO)
      return { id: text(c.id, 40), speciesId, plantNo, nickname: text(c.nickname), plantedOn: c.plantedOn, ...(c.endedOn !== undefined && { endedOn: c.endedOn, outcome: c.outcome as Outcome }) }
    })
    if (cycles.filter(c => c.endedOn === undefined).length > 1) throw new Error('Slot punya lebih dari satu tanaman aktif')
    return { id: text(item.id, 40), siteId: text(item.siteId, 40), name: text(item.name), sessionId: item.sessionId === null ? null : text(item.sessionId, 100), cycles }
  })
  const unique = (ids: string[]) => new Set(ids).size === ids.length
  if (!unique(sites.map(s => s.id)) || !unique(slots.map(s => s.id)) || !unique(slots.flatMap(s => s.cycles.map(c => c.id)))) throw new Error('Id kebun ganda')
  if (slots.some(s => !sites.some(site => site.id === s.siteId))) throw new Error('Slot menunjuk situs yang tidak ada')
  const nextPlantNo: Record<number, number> = {}
  for (const [key, value] of Object.entries(raw.nextPlantNo)) {
    const id = integer(Number(key), 1, MAX_SPECIES_ID), next = integer(value, 1, MAX_PLANT_NO + 1)
    if (slots.some(s => s.cycles.some(c => c.speciesId === id && c.plantNo >= next))) throw new Error('Penghitung nomor tanaman mundur')
    nextPlantNo[id] = next
  }
  for (const s of slots) for (const c of s.cycles) if ((nextPlantNo[c.speciesId] ?? 1) <= c.plantNo) throw new Error('Penghitung nomor tanaman hilang')
  const activeSlotId = raw.activeSlotId === null || raw.activeSlotId === undefined ? null : text(raw.activeSlotId, 40)
  if (activeSlotId !== null && !slots.some(s => s.id === activeSlotId)) throw new Error('Slot aktif tidak ada')
  return { sites, slots, activeSlotId, nextPlantNo }
}

/** The garden the server keeps for an account (`my_garden()`), as the app's book. Sites, slots and plants are the server's; which
 * session a slot opens and which slot is chosen belong to this device and are carried over from `local` by slot id. The answer is
 * checked by `parseGarden` like stored data, so a broken one throws instead of showing an empty garden. */
export function gardenFromServer(answer: unknown, local: GardenBook): GardenBook {
  if (!isRecord(answer) || !Array.isArray(answer.sites) || !Array.isArray(answer.slots) || !Array.isArray(answer.cycles)) throw new Error('Format kebun server tidak valid')
  const cycles = answer.cycles.filter(isRecord), nextPlantNo: Record<number, number> = {}
  for (const c of cycles) if (typeof c.species_id === 'number' && typeof c.plant_no === 'number') nextPlantNo[c.species_id] = Math.max(nextPlantNo[c.species_id] ?? 1, c.plant_no + 1)
  if (cycles.length !== answer.cycles.length) throw new Error('Siklus server tidak valid')
  const slotIds = answer.slots.map(z => isRecord(z) ? z.id : null)
  const chosen = slotIds.includes(local.activeSlotId) ? local.activeSlotId : slotIds[0] ?? null
  return parseGarden({
    sites: answer.sites.map(s => isRecord(s) ? { id: s.id, name: s.name, kind: s.kind, placement: s.placement, ...(s.latitude != null && { location: { lat: s.latitude, lon: s.longitude } }) } : s),
    slots: answer.slots.map(z => isRecord(z) ? {
      id: z.id, siteId: z.site_id, name: z.name, sessionId: local.slots.find(old => old.id === z.id)?.sessionId ?? null,
      cycles: cycles.filter(c => c.slot_id === z.id).map(c => ({ id: c.id, speciesId: c.species_id, plantNo: c.plant_no, nickname: c.nickname, plantedOn: c.planted_on, ...(c.ended_on != null && { endedOn: c.ended_on, outcome: c.outcome }) })),
    } : z),
    activeSlotId: chosen, nextPlantNo,
  })
}

/** What a presentation shows: an orchid in a pot indoors, and a garden of two zones outdoors. `today` is passed in so the
 * dates (and the tests) do not depend on the clock. */
export function demoGarden(today: string): GardenBook {
  let book = addPersonalPot(emptyGarden(), { name: 'Anggrek ruang tamu', placement: 'indoor', plant: { speciesId: 3, plantedOn: shiftDate(today, 40) } })
  book = addGarden(book, { name: 'Kebun belakang', placement: 'outdoor', zones: [
    { name: 'Bedeng A', plant: { speciesId: 1, plantedOn: shiftDate(today, 24) } },
    { name: 'Bedeng B', plant: { speciesId: 2, plantedOn: shiftDate(today, 16) } },
  ] })
  return setActiveSlot(book, book.slots[0].id)
}
