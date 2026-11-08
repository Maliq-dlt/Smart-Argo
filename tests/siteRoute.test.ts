import assert from 'node:assert/strict'
import test from 'node:test'
import { isSimulatorHash } from '../src/lib/siteRoute.ts'

test('Landing dan anchor cerita terpisah dari halaman simulator dan ekosistem', () => {
  for (const hash of ['', '#', '#cerita', '#landing-main', '#tidak-dikenal']) assert.equal(isSimulatorHash(hash), false, hash)
  for (const hash of ['#statistik', '#simulasi', '#bandingkan', '#perangkat', '#terminal', '#ekosistem']) assert.equal(isSimulatorHash(hash), true, hash)
})
