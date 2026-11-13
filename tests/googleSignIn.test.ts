import assert from 'node:assert/strict'
import test from 'node:test'
import { oauthReturn, pkceChallenge, pkceVerifier } from '../src/lib/productAccountClient.ts'

test('PKCE S256 challenge matches RFC 7636 appendix B', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('PKCE verifier is 43 unreserved characters and never repeats', () => {
  const a = pkceVerifier(), b = pkceVerifier()
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
})

test('OAuth return reads the code or the provider error, and ignores unrelated queries', () => {
  assert.deepEqual(oauthReturn('?code=4c1f2a7e-2b8f-4f41-9d6e-0b3c2a1f9e77'), { code: '4c1f2a7e-2b8f-4f41-9d6e-0b3c2a1f9e77' })
  assert.deepEqual(oauthReturn('?error=access_denied&error_description=User+cancelled'), { error: 'User cancelled' })
  assert.equal(oauthReturn('?serial=SA-1'), null)
  assert.equal(oauthReturn('?code=' + 'x'.repeat(600)), null, 'oversized code is rejected')
  assert.equal(oauthReturn('?code=a%20b'), null, 'code with whitespace is rejected')
})
