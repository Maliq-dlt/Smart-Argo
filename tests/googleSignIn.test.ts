import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductAccountClient, oauthReturn, pkceChallenge, pkceVerifier } from '../src/lib/productAccountClient.ts'

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
  assert.deepEqual(oauthReturn('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { error: 'Email link is invalid or has expired' }, 'a fragment error from an expired link')
})

test('email sign-up asks Auth for a PKCE confirmation link back to the app, never tokens in the URL', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ id: 'new-user' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    assert.equal(await new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, 'https://app.example/#statistik'), 'confirm')
    assert.ok(calls[0].url.endsWith('/auth/v1/signup?redirect_to=https%3A%2F%2Fapp.example%2F%23statistik'), calls[0].url)
    assert.equal(calls[0].body.code_challenge_method, 's256')
    assert.match(String(calls[0].body.code_challenge), /^[A-Za-z0-9_-]{43}$/)
  } finally { globalThis.fetch = original }
})
