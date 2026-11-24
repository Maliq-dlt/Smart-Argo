import test from 'node:test'
import assert from 'node:assert/strict'
import { createMfaRecoveryHandler } from '../supabase/functions/mfa-recovery/handler.ts'

// A recovery is only done when the other sessions are signed out too (2026-11-24): someone who took the old
// authenticator may hold one. A failed sign-out answers 503 so the user retries with the same code (the database keeps
// a ten-minute retry window, and removing a factor that is already gone counts as done).
const id = '550e8400-e29b-41d4-a716-446655440000', factor = '550e8400-e29b-41d4-a716-446655440001'
const handler = createMfaRecoveryHandler({ url: 'http://localhost', serviceKey: 'test-only-service', appOrigin: 'http://allowed' })
const request = () => new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer caller.token.value', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ABCD-EFGH' }) })

async function recover(logout: number, removal = 204) {
  const calls: string[] = [], original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id }))
    if (url.endsWith('/rpc/consume_recovery_code')) return new Response(JSON.stringify({ ok: true, factor_ids: [factor] }))
    if (url.includes('/factors/')) return new Response(null, { status: removal })
    if (url.includes('/logout')) return new Response(null, { status: logout })
    throw new Error(`unexpected ${url}`)
  }
  try { const response = await handler(request()); return { status: response.status, body: await response.json(), calls } } finally { globalThis.fetch = original }
}

test('recovery removes the factors and signs the other sessions out', async () => {
  const { status, body, calls } = await recover(204)
  assert.equal(status, 200); assert.deepEqual(body, { ok: true, removed: 1 })
  assert.deepEqual(calls, ['GET /auth/v1/user', 'POST /rest/v1/rpc/consume_recovery_code', `DELETE /auth/v1/admin/users/${id}/factors/${factor}`, 'POST /auth/v1/logout'])
})

test('a failed sign-out of the other sessions is not reported as a finished recovery', async () => {
  const { status, body } = await recover(500)
  assert.equal(status, 503)
  assert.equal(body.code, 'service_unavailable')
  assert.match(body.message, /same code/)
})

test('a retry after a partial recovery finds the factor already gone and finishes', async () => {
  const { status } = await recover(204, 404)
  assert.equal(status, 200)
})
