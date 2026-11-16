/** Writes to the garden a signed-in person keeps on the server (supabase/migrations/20261115100000). Each write carries its own
 * request id, so a repeated click or a retried request is one pot or one plant, never two. Reading is `gardenFromServer`. */
import type { Location, Outcome, Placement } from './garden.ts'

export type GardenRpc = (name: 'my_garden' | 'add_my_site' | 'plant_in_my_slot' | 'switch_my_plant', body?: unknown) => Promise<Record<string, unknown>>
export interface NewSite {
  kind: 'pot' | 'garden'; name: string; placement: Placement; location?: Location
  /** One per slot, in order; a personal pot has exactly one, named like the pot. */
  zones: { name: string; plant?: { speciesId: number; plantedOn: string; nickname?: string } }[]
}

/** Makes the pot or garden, then plants each zone that has a plant. A plant that is refused stops here and throws; the site and
 * the slots planted before it stay, and the empty slot can be planted with "Ganti tanaman". */
export async function addSiteOnServer(rpc: GardenRpc, site: NewSite): Promise<void> {
  const made = await rpc('add_my_site', {
    p_request_id: crypto.randomUUID(), p_name: site.name, p_kind: site.kind, p_placement: site.placement,
    p_latitude: site.location?.lat ?? null, p_longitude: site.location?.lon ?? null, p_zones: site.kind === 'garden' ? site.zones.map(z => z.name) : null,
  })
  const ids = made.slot_ids
  if (!Array.isArray(ids) || ids.length !== site.zones.length || !ids.every(id => typeof id === 'string')) throw new Error('Jawaban server untuk pot baru tidak lengkap. Muat ulang halaman.')
  for (const [i, zone] of site.zones.entries()) if (zone.plant)
    await rpc('plant_in_my_slot', { p_request_id: crypto.randomUUID(), p_slot_id: ids[i], p_species_id: zone.plant.speciesId, p_planted_on: zone.plant.plantedOn, p_nickname: zone.plant.nickname ?? null })
}

/** Closes the plant growing in a slot with its outcome and starts another, in one step on the server. `unchanged` in the answer
 * means that species was already planted there that day. */
export const switchOnServer = (rpc: GardenRpc, slotId: string, change: { speciesId: number; outcome: Outcome; nickname?: string }, on: string) =>
  rpc('switch_my_plant', { p_request_id: crypto.randomUUID(), p_slot_id: slotId, p_species_id: change.speciesId, p_on: on, p_outcome: change.outcome, p_nickname: change.nickname ?? null })

const GARDEN_TEXT: Record<string, string> = {
  limit_reached: 'Batas kebun tercapai: paling banyak 20 pot dan kebun, 60 slot, 300 tanaman per akun, dan 30 tanaman baru per hari.',
  slot_unavailable: 'Pot atau zona itu tidak ada di akun Anda. Muat ulang halaman.',
}
/** The sentence to show for a failed garden write: the garden's own wording for its codes, otherwise the account client's. */
export function gardenErrorText(err: unknown) {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && Object.hasOwn(GARDEN_TEXT, code) ? GARDEN_TEXT[code] : err instanceof Error ? err.message : 'Kebun tidak dapat disimpan. Coba lagi.'
}
