import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { THRESHOLDS } from '../src/lib/observation.ts'
import { SPECIES } from '../src/lib/species.ts'

// The species catalogue and the learning thresholds live in TypeScript, Kotlin and SQL. Nothing generates one from
// another, so this test is what keeps the three copies from drifting apart.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const kotlinCatalog = read('android/app/src/main/java/id/smartagro/app/SpeciesCatalog.kt')
const kotlinObservation = read('android/app/src/main/java/id/smartagro/app/Observation.kt')
const speciesSql = read('supabase/migrations/20261115100000_garden_sites_cycles.sql')
const overviewSql = read('supabase/migrations/20261123050000_care_reading_continuity.sql')

interface Row { speciesId: number; tag: string; name: string; tier: string }
const ts: Row[] = SPECIES.map(({ speciesId, tag, name, tier }) => ({ speciesId, tag, name, tier }))
  .sort((a, b) => a.speciesId - b.speciesId)

test('species ids, tags, names and tiers agree in TypeScript, Kotlin and SQL', () => {
  const kotlin: Row[] = [...kotlinCatalog.matchAll(
    /speciesId = (\d+),\s*tag = "([A-Z]+)",\s*name = "([^"]+)",[\s\S]*?tier = "(\w+)"/g,
  )].map(m => ({ speciesId: Number(m[1]), tag: m[2], name: m[3], tier: m[4] }))
  assert.deepEqual(kotlin, ts, 'SpeciesCatalog.kt')

  const insert = speciesSql.match(/INSERT INTO public\.plant_species\(species_id, name, tier\) VALUES([^;]+);/)
  assert.ok(insert, 'plant_species seed not found')
  const sql = [...insert[1].matchAll(/\((\d+),'([^']+)','(\w+)'\)/g)]
    .map(m => ({ speciesId: Number(m[1]), name: m[2], tier: m[3] }))
  assert.deepEqual(sql, ts.map(({ speciesId, name, tier }) => ({ speciesId, name, tier })), 'plant_species seed')

  // my_overview builds the tag by indexing this array with species_id, so the order is the species code.
  const tags = overviewSql.match(/\(ARRAY\[([^\]]+)\]\)\[c\.species_id\]/)
  assert.ok(tags, 'tag array not found in my_overview')
  assert.deepEqual(tags[1].split(',').map(t => t.trim().replace(/'/g, '')), ts.map(r => r.tag), 'my_overview tags')
})

test('learning thresholds agree in TypeScript, Kotlin and SQL', () => {
  assert.deepEqual(THRESHOLDS, { days: 7, inspections: 3, waterings: 2 })
  const kotlin = kotlinObservation.match(
    /class ObservationThresholds\(val days: Int = (\d+), val inspections: Int = (\d+), val waterings: Int = (\d+)\)/,
  )
  assert.ok(kotlin, 'ObservationThresholds not found')
  assert.deepEqual(kotlin.slice(1).map(Number), [THRESHOLDS.days, THRESHOLDS.inspections, THRESHOLDS.waterings], 'Observation.kt')

  const band = overviewSql.match(/CREATE OR REPLACE FUNCTION public\.care_band\([\s\S]*?\$\$;/)?.[0]
  assert.ok(band, 'care_band not found')
  assert.match(band, new RegExp(`>=interval '${THRESHOLDS.days} days'`), 'care_band days')
  assert.match(band, new RegExp(`WHERE kind='inspection'\\)>=${THRESHOLDS.inspections}\\b`), 'care_band inspections')
  assert.match(band, new RegExp(`a\\.at<=w\\.at\\+interval '3 hours'\\)\\)>=${THRESHOLDS.waterings}\\b`), 'care_band waterings')
})
