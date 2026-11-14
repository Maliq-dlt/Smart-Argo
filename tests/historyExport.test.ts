import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistoryExportHandler } from '../supabase/functions/history-export/handler.ts'

const id = '550e8400-e29b-41d4-a716-446655440000', from = '2026-11-01T00:00:00.000Z', to = '2026-11-02T00:00:00.000Z'
const snapshot = '2026-11-14T00:00:00+00:00'
const handler = createHistoryExportHandler({ url: 'http://localhost', serviceKey: 'test-only-service', appOrigin: 'http://allowed' })
const request = (body: unknown = { unit_id: id, from, to }, headers = {}) => new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer caller.token.value', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const reading = (overrides = {}) => ({ id, unit_id: id, device_id: id, packet_id: id, boot_id: id, sensor_id: 'soil_temperature', source: 'device', quality_status: 'ok', value_nullable: -10, error_message: null, measured_at: from, received_at: from, clock_status: 'synced', sequence: 1, ...overrides })
const page = (readings: unknown[], next_cursor: unknown = null) => ({ ok: true, unit_id: id, snapshot_as_of: snapshot, readings, next_cursor })

async function transport(run: () => Promise<void>, history: (args: Record<string, unknown>) => unknown, calls: Record<string, unknown>[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('authorization'), 'Bearer caller.token.value', 'Never elevate the history call to service role')
    assert.match(headers.get('x-request-id')!, /^[0-9a-f-]{36}$/)
    if (String(input).endsWith('/user')) return new Response(JSON.stringify({ id }))
    const args = JSON.parse(String(init?.body)); calls.push(args)
    return new Response(JSON.stringify(history(args)))
  }
  try { await run() } finally { globalThis.fetch = original }
}

test('CSV export authorizes original caller and preserves null, provenance, quotes and formula safety across pages', async () => {
  const calls: Record<string, unknown>[] = [], second = '550e8400-e29b-41d4-a716-446655440001'
  await transport(async () => {
    const result = await handler(request())
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('content-disposition'), 'attachment; filename="smart-agro-history.csv"')
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(result.headers.get('x-history-row-count'), '2')
    const csv = await result.text()
    assert.match(csv, /"-10"/)
    assert.match(csv, /"' \t=HYPERLINK\(""bad""\)\nline"/)
    assert.match(csv, /"error","","'/)
    assert.doesNotMatch(csv, /private-payload|private-signature|private-service/)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].p_snapshot_as_of, snapshot)
    assert.equal(calls[1].p_cursor_id, id)
  }, () => calls.length === 1 ? page([reading({ payload: 'private-payload', signature: 'private-signature' })], { measured_at: from, id }) : page([reading({ id: second, quality_status: 'error', value_nullable: null, error_message: ' \t=HYPERLINK("bad")\nline' })]), calls)
})

test('invalid requests and denied origins fail before upstream calls', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('No upstream call allowed') }
  try {
    for (const body of [{ unit_id: id, from: '2026-02-30T00:00:00.000Z', to }, { unit_id: id, from, to: from }, { unit_id: id, from, to: '2026-12-03T00:00:00.000Z' }, { unit_id: id, from, to, account_id: id }, { unit_id: id + '\n', from, to }, ['invalid']]) assert.equal((await handler(request(body))).status, 400)
    assert.equal((await handler(request(undefined, { origin: 'http://denied' }))).status, 403)
    assert.equal((await handler(request(undefined, { authorization: '' }))).status, 401)
    assert.equal((await handler(request(undefined, { 'content-type': 'text/plain' }))).status, 415)
    assert.equal((await handler(request({ unit_id: id, from, to, large: 'x'.repeat(5000) }))).status, 413)
  } finally { globalThis.fetch = original }
})

test('CSV rejects failed authorization and malformed upstream evidence without returning a partial file', async () => {
  for (const [response, status] of [[{ ok: false, code: 'unauthorized' }, 401], [{ ok: false, code: 'unit_unavailable' }, 403], [{ ok: false, code: 'invalid_range' }, 400], [page([reading({ unit_id: 'other' })]), 503], [page([reading({ quality_status: 'error', value_nullable: 0 })]), 503], [page([reading()], { measured_at: from, id: 'invalid' }), 503]] as const) {
    await transport(async () => {
      const result = await handler(request())
      assert.equal(result.status, status)
      assert.equal(result.headers.get('content-disposition'), null)
      assert.equal(result.headers.get('content-type'), 'application/json')
    }, () => response)
  }
})

test('CSV refuses oversized exports and changed snapshots before releasing any rows', async () => {
  const calls: Record<string, unknown>[] = []
  await transport(async () => {
    const result = await handler(request())
    assert.equal(result.status, 413)
    assert.equal((await result.json()).code, 'export_too_large')
    assert.equal(result.headers.get('content-disposition'), null)
    assert.equal(calls.length, 10)
  }, () => {
    const suffix = String(calls.length).padStart(12, '0'), row = reading({ id: `550e8400-e29b-41d4-a716-${suffix}` })
    return page(Array.from({ length: 500 }, () => row), { measured_at: from, id: row.id })
  }, calls)
  const largeCalls: Record<string, unknown>[] = []
  await transport(async () => {
    assert.equal((await handler(request())).status, 413)
    assert.ok(largeCalls.length < 10, 'UTF-8 byte ceiling applies before the row ceiling')
  }, () => {
    const row = reading({ id: `550e8400-e29b-41d4-a716-${String(largeCalls.length).padStart(12, '0')}`, quality_status: 'error', value_nullable: null, error_message: '\u0800'.repeat(240) })
    return page(Array.from({ length: 500 }, () => row), { measured_at: from, id: row.id })
  }, largeCalls)
  let index = 0
  await transport(async () => assert.equal((await handler(request())).status, 503), () => ++index === 1 ? page([reading()], { measured_at: from, id }) : { ...page([reading()]), snapshot_as_of: to })
})
