import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CURATED_IDS, PLANTABLE, SPECIES, curated, isCuratedId, phaseRanges, plantNickname, plantTag, sceneOf, searchSpecies, speciesById, speciesOfCrop } from '../src/lib/species.ts'

const scenarios: { profile: { crop: string } }[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))

test('every species has a unique positive integer code that fits a Postgres integer with a plant number', () => {
  const codes = SPECIES.map(s => s.speciesId)
  for (const code of codes) assert.ok(Number.isInteger(code) && code >= 1 && code <= 2146, `speciesId ${code}`)
  assert.equal(new Set(codes).size, codes.length)
  assert.equal(new Set(SPECIES.map(s => s.id)).size, SPECIES.length)
  assert.ok(2146 * 1_000_000 + 999_999 <= 2_147_483_647)
})

test('two species are curated from the paper and two are learning-only', () => {
  assert.deepEqual(SPECIES.filter(s => s.tier === 'kurasi').map(s => s.id), ['cabai', 'bawang'])
  assert.deepEqual(SPECIES.filter(s => s.tier === 'belajar').map(s => s.id), ['anggrek', 'peoni'])
  assert.deepEqual([...CURATED_IDS], ['cabai', 'bawang'])
})

test('curated agronomy matches the numbers the simulator used before the catalog', () => {
  const chili = curated('cabai'), shallot = curated('bawang')
  assert.equal(chili.name, 'Cabai')
  assert.equal(shallot.name, 'Bawang merah')
  assert.deepEqual([chili.scenario, chili.growthDays, chili.maxDay], [0, 62, 90])
  assert.deepEqual([shallot.scenario, shallot.growthDays, shallot.maxDay], [7, 48, 65])
  assert.deepEqual(chili.phases.map(p => [p.name, p.start]), [['Awal tanam', 0], ['Vegetatif', 1], ['Berbunga', 31], ['Berbuah', 56]])
  assert.deepEqual(shallot.phases.map(p => [p.name, p.start]), [['Awal tanam', 0], ['Vegetatif', 1], ['Pembentukan umbi', 26], ['Pematangan umbi', 51]])
})

test('a curated species opens the scenario whose profile names it', () => {
  for (const id of CURATED_IDS) assert.equal(speciesOfCrop(scenarios[curated(id).scenario].profile.crop), id)
})

test('sessions name their crop in free text: "bawang" is the shallot, "anggrek" and "peoni" are the learning species, anything else is chili', () => {
  for (const text of ['Bawang merah', 'BAWANG', 'bawang', 'Bawang merah (varietas Bima)']) assert.equal(speciesOfCrop(text), 'bawang', text)
  for (const text of ['Anggrek bulan', 'ANGGREK', 'Anggrek (belajar)']) assert.equal(speciesOfCrop(text), 'anggrek', text)
  assert.equal(speciesOfCrop('Peoni merah'), 'peoni')
  for (const text of ['Cabai', '', 'Synthetic test crop', 'Tomat']) assert.equal(speciesOfCrop(text), 'cabai', text)
})

test('every species has a journey: curated ones their phases, learning ones only "Mengamati"', () => {
  for (const species of SPECIES) {
    assert.ok(species.maxDay > 0 && species.growthDays > 0 && species.growthDays <= species.maxDay, species.id)
    assert.equal(species.phases[0].start, 0, species.id)
    assert.equal(speciesById(species.id), species)
  }
  for (const id of ['anggrek', 'peoni'] as const) assert.deepEqual(speciesById(id).phases.map(p => p.name), ['Mengamati'], id)
  assert.deepEqual(phaseRanges('anggrek'), [['0–180', 'Mengamati']])
})

test('only species with a drawing can be planted, and an undrawn one still has a scene to fall back on', () => {
  assert.deepEqual(PLANTABLE.map(s => s.id), ['cabai', 'bawang', 'anggrek'])
  assert.deepEqual(['cabai', 'bawang', 'anggrek', 'peoni'].map(id => sceneOf(id as never)), ['cabai', 'bawang', 'anggrek', 'anggrek'])
})

test('search finds a plant by its name, an alias or its Latin name, ignoring case and accents, best match first', () => {
  const ids = (query: string) => searchSpecies(query).map(s => s.id)
  assert.deepEqual(ids(''), ['cabai', 'bawang', 'anggrek', 'peoni'])
  assert.deepEqual(ids('   '), ['cabai', 'bawang', 'anggrek', 'peoni'])
  assert.deepEqual(ids('cab'), ['cabai'])
  assert.deepEqual(ids('CABE'), ['cabai'])
  assert.deepEqual(ids('lombok'), ['cabai'])
  assert.deepEqual(ids('bawang'), ['bawang'])
  assert.deepEqual(ids('shallot'), ['bawang'])
  assert.deepEqual(ids('merah'), ['cabai', 'bawang'], 'a word of an alias or a name counts')
  assert.deepEqual(ids('Phalaenopsis'), ['anggrek'])
  assert.deepEqual(ids('paeonia'), ['peoni'])
  assert.deepEqual(ids('bulan anggrek'), ['anggrek'], 'word order does not matter')
  assert.deepEqual(ids('capsicum annuum'), ['cabai'])
  assert.deepEqual(ids('xyz'), [])
  assert.deepEqual(ids('Cabaí'), ['cabai'], 'an accent on a typed letter does not stop a match')
  assert.deepEqual(ids('cabai   merah'), ['cabai'])
})

test('a plant with no name given is called by its species and its number', () => {
  assert.equal(plantNickname(speciesById('cabai'), 3), 'Cabai 3')
  assert.equal(plantNickname(speciesById('bawang'), 1), 'Bawang merah 1')
})

test('a plant tag is its species letters and its number, and no two species share letters', () => {
  const tags = SPECIES.map(s => s.tag)
  for (const tag of tags) assert.match(tag, /^[A-Z]{2}$/)
  assert.equal(new Set(tags).size, tags.length)
  assert.equal(plantTag(speciesById('cabai'), 12), 'CB-12')
  assert.equal(plantTag(speciesById('bawang'), 1), 'BM-1')
})

test('only own catalog ids count as curated, never inherited object keys', () => {
  assert.equal(isCuratedId('cabai'), true)
  assert.equal(isCuratedId('bawang'), true)
  for (const value of ['anggrek', 'peoni', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', 42, null, undefined, {}]) assert.equal(isCuratedId(value), false, String(value))
})

test('phase ranges read "0", then "first–last" with an en dash, ending at the last day of the journey', () => {
  assert.deepEqual(phaseRanges('cabai'), [['0', 'Awal tanam'], ['1–30', 'Vegetatif'], ['31–55', 'Berbunga'], ['56–90', 'Berbuah']])
  assert.deepEqual(phaseRanges('bawang'), [['0', 'Awal tanam'], ['1–25', 'Vegetatif'], ['26–50', 'Pembentukan umbi'], ['51–65', 'Pematangan umbi']])
})
