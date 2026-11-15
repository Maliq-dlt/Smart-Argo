import { emptyGarden, parseGarden, type GardenBook } from './garden.ts'

/** The garden of one person on this device. The scope is the account id, or `guest`, so a second account on the same browser
 * never sees the first one's pots. */
export const gardenKey = (scope: string) => `smart-agro.garden.v1.${scope}`
type Reader = Pick<Storage, 'getItem' | 'setItem'>

/** Reads the garden of a scope. A missing one is empty. A damaged one is kept aside under `<key>.damaged` (never overwritten
 * by the empty book that replaces it) and reported, so the person can be told instead of silently losing their pots. */
export function readGarden(storage: Reader, scope: string): { book: GardenBook; damaged: boolean } {
  const key = gardenKey(scope)
  let raw: string | null
  try { raw = storage.getItem(key) } catch { return { book: emptyGarden(), damaged: false } }
  if (raw === null) return { book: emptyGarden(), damaged: false }
  try { return { book: parseGarden(JSON.parse(raw)), damaged: false } } catch {
    try { storage.setItem(`${key}.damaged`, raw) } catch { /* nothing more can be done */ }
    return { book: emptyGarden(), damaged: true }
  }
}

/** True when the garden was stored. */
export function saveGarden(storage: Reader, scope: string, book: GardenBook): boolean {
  try { storage.setItem(gardenKey(scope), JSON.stringify(book)); return true } catch { return false }
}

/** The browser's storage, or a stand-in that reads nothing and refuses writes where storage is blocked (private windows, some embeds). */
export function browserStorage(): Reader {
  try { return window.localStorage } catch { return { getItem: () => null, setItem: () => { throw new Error('storage blocked') } } }
}
