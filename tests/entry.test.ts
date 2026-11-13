import assert from 'node:assert/strict'
import test from 'node:test'
import { entryView, isSimulatorHash } from '../src/lib/siteRoute.ts'

const base = { configured: true, ready: true, signedIn: false, guest: false, hash: '#statistik' }

test('without a backend everyone enters as a guest', () => {
  assert.equal(entryView({ ...base, configured: false }), 'app')
  assert.equal(entryView({ ...base, configured: false, hash: '#masuk' }), 'app')
})

test('waits for the stored session before choosing', () => assert.equal(entryView({ ...base, ready: false }), 'loading'))

test('a visitor who has not chosen sees the gate, also on a deep link', () => {
  assert.equal(entryView(base), 'gate')
  assert.equal(entryView({ ...base, hash: '#ekosistem' }), 'gate')
})

test('guests use the app until they ask to sign in', () => {
  assert.equal(entryView({ ...base, guest: true }), 'app')
  assert.equal(entryView({ ...base, guest: true, hash: '#profil' }), 'app')
  assert.equal(entryView({ ...base, guest: true, hash: '#masuk' }), 'gate')
})

test('signed-in people never see the gate', () => assert.equal(entryView({ ...base, signedIn: true, hash: '#masuk' }), 'app'))

test('gate and profile are simulator routes', () => {
  assert.equal(isSimulatorHash('#masuk'), true)
  assert.equal(isSimulatorHash('#profil'), true)
})
