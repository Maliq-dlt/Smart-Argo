import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CURATED_IDS, SPECIES, curated, isCuratedId, phaseRanges, speciesOfCrop } from '../src/lib/species.ts'

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

test('old sessions name their crop in free text; only "bawang" selects the shallot, anything else is chili', () => {
  for (const text of ['Bawang merah', 'BAWANG', 'bawang', 'Bawang merah (varietas Bima)']) assert.equal(speciesOfCrop(text), 'bawang', text)
  for (const text of ['Cabai', '', 'Synthetic test crop', 'anggrek']) assert.equal(speciesOfCrop(text), 'cabai', text)
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
