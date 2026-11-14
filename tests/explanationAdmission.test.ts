import test from 'node:test'
import assert from 'node:assert/strict'
import { createUnitExplanationHandler } from '../supabase/functions/unit-explanation/handler.ts'

const id = '00000000-0000-4000-8000-000000000001'
const context = { ok: true, unit_id: id, device_id: id, ownership_id: id, profile_version_id: id, device_status: 'active', registry_status: 'active', evaluated_at: new Date().toISOString(), profile: null, packets: [] }
const token = 'a.' + Buffer.from(JSON.stringify({ sub: id, session_id: id })).toString('base64url') + '.c'
const request = () => new Request('http://127.0.0.1', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ unit_id: id, device_id: id, request_id: id, question: '' }) })

for (const [name, admission, status] of [
  ['stored retry returns without another inference', { ok: true, duplicate: true, snapshot: { id } }, 200],
  ['pending duplicate cannot start another inference', { ok: false, code: 'request_pending' }, 409],
  ['quota rejection happens before inference', { ok: false, code: 'rate_limited' }, 429],
] as const) {
  test(name, async () => {
    const original = globalThis.fetch, order: string[] = []
    let calls = 0
    // Isolated transport at the real handler boundary; no database or paid AI call.
    globalThis.fetch = async input => {
      const path = new URL(String(input)).pathname
      order.push(path)
      return new Response(JSON.stringify(path.endsWith('/user') ? { id } : path.endsWith('/reserve_unit_explanation') ? admission : path.endsWith('/unit_explanation_context') ? context : { ok: true, duplicate: true, snapshot: { id } }))
    }
    try {
      const handler = createUnitExplanationHandler({ url: 'http://127.0.0.1', serviceKey: 'test-only', appOrigin: 'http://127.0.0.1', explainer: async () => { calls++; return { status: 'failed', reason: 'test-only' } } })
      const response = await handler(request())
      assert.equal(calls, 0, 'No AI work before successful admission of a new attempt')
      assert.equal(response.status, status)
      assert.equal(order.includes('/rest/v1/rpc/unit_explanation_context'), false, 'Duplicate/rejected requests need no evidence load')
      assert.deepEqual(await response.json(), admission)
    } finally { globalThis.fetch = original }
  })
}
