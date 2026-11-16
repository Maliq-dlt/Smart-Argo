import { readFileSync, writeFileSync } from 'node:fs'
import { evaluate } from '../../src/lib/agronomyEngine.ts'

// Frozen, explicitly synthetic examples from the web; the Android app never presents these as device data.
const source = JSON.parse(readFileSync(new URL('../../src/lib/scenarios.json', import.meta.url), 'utf8'))
const snapshots = source.map((scenario) => ({ ...scenario, result: evaluate(scenario) }))
writeFileSync(new URL('../app/src/main/assets/demo-scenarios.json', import.meta.url), JSON.stringify(snapshots, null, 2) + '\n')
console.log(`${snapshots.length} scenario snapshots generated from the existing web rule engine.`)
