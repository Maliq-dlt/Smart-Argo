import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductAccountClient } from '../src/lib/productAccountClient.ts'

// Operator and curator writes answer step_up_required when the last authenticator code is older than five minutes
// (privileged_write_gate). The client asks for a code, verifies it, and repeats the call once; other calls do not.
const factor = '0b7f6c2e-4d1a-4c3b-8e9f-1a2b3c4d5e6f'
const fresh = () => ({ access_token: `a.${Math.random().toString(36).slice(2)}.s`, refresh_token: 'r1', expires_in: 3600 })

function setup(rpcAnswers: Array<{ status: number; body: unknown }>) {
  const calls: string[] = []
  Object.assign(globalThis, { sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} } })
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url), 'http://x').pathname
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (path.startsWith('/rest/v1/rpc/')) { const next = rpcAnswers.shift()!; return json(next.status, next.body) }
    if (path === '/auth/v1/user') return json(200, { factors: [{ id: factor, status: 'verified', factor_type: 'totp' }] })
    if (path.endsWith('/challenge')) return json(200, { id: 'challenge-1' })
    if (path.endsWith('/verify')) return json(200, fresh())
    return json(404, {})
  }) as typeof fetch
  const client = new ProductAccountClient()
  client.session = { access_token: 'a.old.s', refresh_token: 'r0', expires_at: Date.now() / 1000 + 3600 }
  return { client, calls }
}
const stepUpAnswer = { status: 200, body: { ok: false, code: 'step_up_required', message: 'Confirm with a fresh authenticator code.' } }

test('a privileged write asks for a code, verifies it and repeats once', async () => {
  const { client, calls } = setup([stepUpAnswer, { status: 200, body: { ok: true, policy_id: 'p' } }])
  let asked = 0
  client.stepUp = async () => { asked++; return '123456' }
  const result = await client.rpc('operator_set_reward_policy', { p: 1 })
  assert.equal(result.ok, true)
  assert.equal(asked, 1)
  assert.deepEqual(calls.filter(c => c.includes('/rpc/') || c.includes('/factors/')).map(c => c.split(' ')[1].replace(factor, 'F')),
    ['/rest/v1/rpc/operator_set_reward_policy', '/auth/v1/factors/F/challenge', '/auth/v1/factors/F/verify', '/rest/v1/rpc/operator_set_reward_policy'])
})

test('cancelling the code leaves the write undone, in the app\'s words', async () => {
  const { client } = setup([stepUpAnswer])
  client.stepUp = async () => null
  await assert.rejects(client.rpc('operator_set_reward_policy'), /Masukkan kode 2FA terbaru/)
})

test('only an explicit session verdict signs out; an error without a code keeps the session', async () => {
  const { client } = setup([{ status: 200, body: { ok: false, message: 'odd' } }, { status: 200, body: { ok: false, code: 'unauthorized', message: 'Active session required.' } }])
  await assert.rejects(client.rpc('my_units'))
  assert.notEqual(client.session, null)
  await assert.rejects(client.rpc('my_units'))
  assert.equal(client.session, null)
})

test('ordinary calls keep their own handling (rewards asks inline)', async () => {
  const { client } = setup([stepUpAnswer])
  let asked = 0
  client.stepUp = async () => { asked++; return '123456' }
  await assert.rejects(client.rpc('reserve_my_reward'), (err: { code?: string }) => err.code === 'step_up_required')
  assert.equal(asked, 0)
})
