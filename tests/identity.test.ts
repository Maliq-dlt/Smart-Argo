import assert from 'node:assert/strict'
import test from 'node:test'
import { identityFromClaims } from '../src/lib/identity.ts'

const claims = (meta: Record<string, unknown>, app: Record<string, unknown> = {}) => ({ email: 'a@x.test', user_metadata: meta, app_metadata: app })

test('the name the person chose wins over the Google name', () => {
  assert.equal(identityFromClaims(claims({ display_name: 'Nama Saya', full_name: 'Nama Google' })).name, 'Nama Saya')
})

test('a forged display_name falls back to the provider name, then the email local part', () => {
  for (const bad of ['x'.repeat(10000), 42, 'Tani‮gnos']) {
    assert.equal(identityFromClaims(claims({ display_name: bad, full_name: 'Nama Google' })).name, 'Nama Google')
    assert.equal(identityFromClaims(claims({ display_name: bad })).name, 'a')
  }
})

test('Google sign-in and a valid saved pot are read; an invalid pot is ignored', () => {
  const pot = { name: 'P', crop: 'cabai', device: false }
  const ok = identityFromClaims(claims({ pot }, { providers: ['google'] }))
  assert.equal(ok.google, true)
  assert.deepEqual(ok.pot, pot)
  assert.equal(identityFromClaims(claims({ pot: { ...pot, crop: 'x' } })).pot, null)
})
