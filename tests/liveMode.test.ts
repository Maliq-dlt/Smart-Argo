import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { appMode, features, featuresOf, parseAppMode } from '../src/lib/appMode.ts'

test('only the exact word "live" makes the live app; everything else is the demo the project has always had', () => {
  assert.equal(parseAppMode('live'), 'live')
  for (const raw of ['demo', '', undefined, null, 'Live', 'LIVE', ' live', 'live ', 'production', 'true', 1, true, {}, []]) assert.equal(parseAppMode(raw), 'demo', String(raw))
})

test('live shows none of the stand-ins and the demo shows all of them', () => {
  assert.deepEqual(featuresOf('live'), { guest: false, playground: false, simulatedWeather: false, demoGarden: false })
  assert.deepEqual(featuresOf('demo'), { guest: true, playground: true, simulatedWeather: true, demoGarden: true })
})

test('a build with no mode set is the demo', () => {
  assert.equal(appMode, 'demo')
  assert.deepEqual(features, featuresOf('demo'))
})

test('the live build is its own script and takes its mode from a file in the repository, not from a visitor', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['build:live'], /build --mode live(?: |$)/)
  assert.match(pkg.scripts['build:live'], /--env-file=\.env\.cloud --env-file=\.env\.live(?: |$)/)
  assert.match(pkg.scripts['build:live'], /tsc --noEmit/)
  const file = readFileSync(new URL('../.env.live', import.meta.url), 'utf8')
  assert.match(file, /^VITE_APP_MODE=live$/m)
  assert.match(file, /^VITE_SIGN_IN_REQUIRED=true$/m)
  const values = file.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.deepEqual(values.sort(), ['VITE_APP_MODE=live', 'VITE_SIGN_IN_REQUIRED=true'], 'flags only: no URL, key or secret in the committed file')
  assert.match(pkg.scripts['test:backend'], /garden\.integration\.mjs/, 'the server side of the garden is part of the backend checks')
})
