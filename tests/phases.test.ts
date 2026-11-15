import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { phaseAt } from '../src/lib/agronomyEngine.ts'
import { phaseIndex, phaseSteps } from '../src/lib/dashboardFacts.ts'
import { CURATED_IDS, curated, speciesOfCrop } from '../src/lib/species.ts'

// The functions exactly as they were before the species catalog (agronomyEngine.ts and dashboardFacts.ts at ecbbdf2).
// The catalog replaced the `onion` flag; these oracles prove the journey did not change by a single day.
const legacyPhaseAt = (day: number, onion: boolean) => {
  if (day === 0) return 'Awal tanam'
  if (onion) return day <= 25 ? 'Vegetatif' : day <= 50 ? 'Pembentukan umbi' : 'Pematangan umbi'
  return day <= 30 ? 'Vegetatif' : day <= 55 ? 'Berbunga' : 'Berbuah'
}
const legacySteps = (onion: boolean) => onion
  ? { names: ['Awal tanam', 'Vegetatif', 'Pembentukan umbi', 'Pematangan umbi'], starts: [0, 1, 26, 51], total: 65 }
  : { names: ['Awal tanam', 'Vegetatif', 'Berbunga', 'Berbuah'], starts: [0, 1, 31, 56], total: 90 }
const legacyIndex = (day: number, onion: boolean) => legacySteps(onion).starts.reduce((index, start, i) => day >= start ? i : index, 0)
const legacyOnion = { cabai: false, bawang: true } as const

test('phaseAt gives the pre-catalog phase on every day, including the boundaries and days past the journey', () => {
  for (const id of CURATED_IDS) for (let day = 0; day <= 100; day++) assert.equal(phaseAt(day, id), legacyPhaseAt(day, legacyOnion[id]), `${id} day ${day}`)
})

test('the boundary days land in the phase they always did', () => {
  assert.deepEqual([0, 1, 30, 31, 55, 56, 90, 100].map(d => phaseAt(d, 'cabai')), ['Awal tanam', 'Vegetatif', 'Vegetatif', 'Berbunga', 'Berbunga', 'Berbuah', 'Berbuah', 'Berbuah'])
  assert.deepEqual([0, 1, 25, 26, 50, 51, 65, 100].map(d => phaseAt(d, 'bawang')), ['Awal tanam', 'Vegetatif', 'Vegetatif', 'Pembentukan umbi', 'Pembentukan umbi', 'Pematangan umbi', 'Pematangan umbi', 'Pematangan umbi'])
})

test('phaseSteps and phaseIndex equal the pre-catalog dashboard helpers', () => {
  for (const id of CURATED_IDS) {
    assert.deepEqual(phaseSteps(id), legacySteps(legacyOnion[id]), id)
    for (let day = 0; day <= 100; day++) assert.equal(phaseIndex(day, id), legacyIndex(day, legacyOnion[id]), `${id} day ${day}`)
  }
})

test('the last day of the journey follows the crop named in saved sessions, as the old "bawang" check did', () => {
  const scenarios: { profile: { crop: string } }[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))
  for (const { profile } of scenarios) assert.equal(curated(speciesOfCrop(profile.crop)).maxDay, profile.crop.toLowerCase().includes('bawang') ? 65 : 90, profile.crop)
})
