import assert from 'node:assert/strict'
import test from 'node:test'
import { addPersonalPot, demoGarden, emptyGarden } from '../src/lib/garden.ts'
import { gardenKey, readGarden, saveGarden } from '../src/lib/gardenStore.ts'

const memory = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } } }

test('a scope with nothing stored is an empty garden, not an error', () => {
  assert.deepEqual(readGarden(memory(), 'guest'), { book: emptyGarden(), damaged: false })
})

test('a saved garden comes back as it was', () => {
  const storage = memory(), book = demoGarden('2026-11-15')
  assert.equal(saveGarden(storage, 'guest', book), true)
  assert.deepEqual(readGarden(storage, 'guest'), { book, damaged: false })
})

test('every account has its own garden on the same browser', () => {
  const storage = memory(), mine = addPersonalPot(emptyGarden(), { name: 'Punya saya', placement: 'indoor' })
  saveGarden(storage, 'akun-a', mine)
  assert.deepEqual(readGarden(storage, 'akun-b').book, emptyGarden())
  assert.deepEqual(readGarden(storage, 'guest').book, emptyGarden())
  assert.equal(readGarden(storage, 'akun-a').book.sites[0].name, 'Punya saya')
  assert.notEqual(gardenKey('akun-a'), gardenKey('akun-b'))
  assert.ok(gardenKey('akun-a').startsWith('smart-agro.garden.v1.'))
})

test('a damaged garden is reported and kept aside, so the empty one that replaces it cannot erase it', () => {
  const storage = memory()
  for (const raw of ['{not json', '{"sites":[],"slots":[]}', JSON.stringify({ ...demoGarden('2026-11-15'), activeSlotId: 'z99' })]) {
    storage.data.clear()
    storage.data.set(gardenKey('guest'), raw)
    const read = readGarden(storage, 'guest')
    assert.deepEqual(read, { book: emptyGarden(), damaged: true })
    assert.equal(storage.data.get(`${gardenKey('guest')}.damaged`), raw, 'the unreadable text survives')
  }
})

test('blocked storage never throws: reads are empty and writes say they failed', () => {
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(readGarden(blocked, 'guest'), { book: emptyGarden(), damaged: false })
  assert.equal(saveGarden(blocked, 'guest', emptyGarden()), false)
  const full = { getItem: () => 'not json', setItem: () => { throw new Error('quota') } }
  assert.deepEqual(readGarden(full, 'guest'), { book: emptyGarden(), damaged: true }, 'also when the copy aside cannot be made')
})
