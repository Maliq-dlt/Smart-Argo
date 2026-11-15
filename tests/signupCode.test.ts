import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductAccountClient } from '../src/lib/productAccountClient.ts'

// Sign-up verifies the email with a six-digit code (Auth /verify), can send it again (/resend), and the person can
// rename themselves (user metadata). Auth is stubbed; the paths and bodies are what the real GoTrue expects.
const fresh = () => ({ access_token: `a.${Math.random().toString(36).slice(2)}.s`, refresh_token: 'r1', expires_in: 3600 })
type Call = { method: string; path: string; body: Record<string, unknown> }

function stub(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = []
  Object.assign(globalThis, { sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} } })
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', path: new URL(String(url), 'http://x').pathname + new URL(String(url), 'http://x').search, body: init?.body ? JSON.parse(String(init.body)) : {} }
    calls.push(call)
    const { status = 200, body } = answer(call)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return calls
}

test('sign-up sends the cleaned display name as user metadata, and nothing when there is none', async () => {
  const calls = stub(() => ({ body: { id: 'u' } }))
  assert.equal(await new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, undefined, '  Maliq  Athaya '), 'confirm')
  assert.deepEqual(calls[0].body.data, { display_name: 'Maliq Athaya' })
  await new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, undefined, '  ')
  assert.equal(calls[1].body.data, undefined)
})

test('the pasted code is cleaned, sent to /verify as a signup token, and opens the session', async () => {
  const calls = stub(() => ({ body: fresh() }))
  assert.equal(await new ProductAccountClient().verifySignupCode('tani@example.test', '482 915'), 'ok')
  assert.equal(calls[0].path, '/auth/v1/verify')
  assert.deepEqual(calls[0].body, { type: 'signup', email: 'tani@example.test', token: '482915' })
})

test('a verified code for an account with an authenticator waits for the second factor', async () => {
  stub(() => ({ body: { ...fresh(), user: { factors: [{ status: 'verified' }] } } }))
  assert.equal(await new ProductAccountClient().verifySignupCode('tani@example.test', '482915'), 'mfa')
})

test('a code that is not six digits never reaches the network', async () => {
  const calls = stub(() => ({ body: fresh() }))
  await assert.rejects(new ProductAccountClient().verifySignupCode('tani@example.test', '12345'), /6 angka/)
  assert.equal(calls.length, 0)
})

test('an expired or wrong code comes back with the server wording the gate recognises', async () => {
  stub(() => ({ status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } }))
  await assert.rejects(new ProductAccountClient().verifySignupCode('tani@example.test', '482915'), /expired or is invalid/)
})

test('send again asks Auth to resend the signup email', async () => {
  const calls = stub(() => ({ body: {} }))
  await new ProductAccountClient().resendSignupCode('tani@example.test')
  assert.equal(calls[0].path, '/auth/v1/resend')
  assert.deepEqual(calls[0].body, { type: 'signup', email: 'tani@example.test' })
})

test('renaming validates first, saves display_name, then refreshes the token so it carries the name', async () => {
  const calls = stub(call => ({ body: call.path.startsWith('/auth/v1/token') ? fresh() : { id: 'u' } }))
  const client = new ProductAccountClient()
  client.session = { access_token: 'a.old.s', refresh_token: 'r0', expires_at: Date.now() / 1000 + 3600 } as typeof client.session
  await assert.rejects(client.updateDisplayName('  '), /1–40/)
  assert.equal(calls.length, 0)
  assert.equal(await client.updateDisplayName(' Maliq '), 'Maliq')
  assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), ['PUT /auth/v1/user', 'POST /auth/v1/token?grant_type=refresh_token'])
  assert.deepEqual(calls[0].body, { data: { display_name: 'Maliq' } })
})
// Auth hides whether an address is taken: a repeated sign-up for a confirmed email answers 200 with a user that has
// no identities (and sends no email), so the form would wait forever for a code that never comes. The client says so.
test('a sign-up for a confirmed email (Auth answers a user without identities) is refused as already registered', async () => {
  stub(() => ({ body: { id: 'u', email: 'tani@example.test', identities: [] } }))
  await assert.rejects(new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, undefined, 'Maliq'),
    (err: Error & { code?: string }) => err.code === 'email_exists' && /sudah terdaftar/.test(err.message))
})
test('a new or still unconfirmed address (identities present) goes on to the code step', async () => {
  stub(() => ({ body: { id: 'u', identities: [{ provider: 'email' }] } }))
  assert.equal(await new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, undefined, 'Maliq'), 'confirm')
})
test('the local Auth (auto-confirm) rejects a repeated sign-up outright; that gets the same code and wording', async () => {
  stub(() => ({ status: 422, body: { code: 422, error_code: 'user_already_exists', msg: 'User already registered' } }))
  await assert.rejects(new ProductAccountClient().authenticate('tani@example.test', 'x'.repeat(12), true, undefined, 'Maliq'),
    (err: Error & { code?: string }) => err.code === 'email_exists' && /sudah terdaftar/.test(err.message))
})
