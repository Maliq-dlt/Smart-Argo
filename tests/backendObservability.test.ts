import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { canonicalRequestId, observeHandler } from '../supabase/functions/_shared/observability.ts'
import { createProductClaimHandler } from '../supabase/functions/product-claim/handler.ts'
// @ts-expect-error Native Node gateway is an ES module without TypeScript declarations.
import { startGateway } from '../scripts/backend-gateway.mjs'

const id = '550e8400-e29b-41d4-a716-446655440000'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const address = (server: Server) => {
  const value = server.address()
  assert.ok(value && typeof value === 'object')
  return `http://127.0.0.1:${value.port}`
}
const close = (server: Server) => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })

test('request IDs reject uncontrolled data and normalize UUIDs', () => {
  assert.equal(canonicalRequestId(id.toUpperCase()), id)
  for (const value of ['', undefined, ['secret'], 'email@example.org', id + 'extra', id + '\n', 'x'.repeat(10000), 'secret\r\nforged']) {
    const result = canonicalRequestId(value)
    assert.match(result, uuid)
    assert.notEqual(result, value)
  }
})

test('Edge logging preserves body streams and immutable headers; fields exclude secrets', async () => {
  const logs: string[] = []
  const original = await fetch('data:application/json,%7B%22ok%22%3Atrue%7D')
  assert.throws(() => original.headers.set('x-test', 'no'))
  const handler = observeHandler('telemetry-ingest', async request => {
    assert.equal(request.headers.get('x-request-id'), id)
    assert.equal(await request.text(), 'private payload')
    return original
  }, line => logs.push(line))
  const result = await handler(new Request('http://localhost/private?token=secret', { method: 'POST', headers: { 'x-request-id': id.toUpperCase(), authorization: 'Bearer secret' }, body: 'private payload' }))
  assert.equal(result.body, original.body)
  assert.equal(original.bodyUsed, false, 'Instrumentation must not consume the response')
  assert.equal(result.headers.get('x-request-id'), id)
  assert.equal(result.headers.get('access-control-expose-headers'), 'x-request-id')
  assert.deepEqual(await result.json(), { ok: true })
  const event = JSON.parse(logs[0])
  assert.equal(event.entryPoint, 'edge')
  assert.equal(event.operation, 'telemetry-ingest')
  assert.equal(event.requestId, id)
  assert.equal(event.status, 200)
  assert.equal(event.level, 'info')
  assert.ok(event.durationMs >= 0)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs.join(''), /secret|private|token|authorization/)
})

test('Edge unexpected errors and failed log sinks do not expose exception data', async () => {
  const logs: string[] = []
  const result = await observeHandler('energy-ingest', async () => { throw new Error('password=secret') }, line => logs.push(line))(new Request('http://localhost'))
  assert.equal(result.status, 500)
  assert.match(result.headers.get('x-request-id')!, uuid)
  assert.equal(JSON.parse(logs[0]).outcome, 'error')
  assert.doesNotMatch(await result.text() + logs.join(''), /password|secret/)
  const controller = new AbortController()
  controller.abort()
  await observeHandler('energy-ingest', async () => new Response('done'), line => logs.push(line))(new Request('http://localhost', { signal: controller.signal }))
  assert.equal(JSON.parse(logs[1]).outcome, 'aborted')
  assert.equal(JSON.parse(logs[1]).status, null)
  const success = await observeHandler('energy-ingest', async () => new Response(null, { status: 204 }), () => { throw new Error('logger offline') })(new Request('http://localhost'))
  assert.equal(success.status, 204)
})

test('claim Auth and RPC fetches carry the same canonical diagnostic ID', async () => {
  const original = globalThis.fetch, observed: string[] = []
  const token = 'a.' + Buffer.from(JSON.stringify({ sub: id, session_id: id })).toString('base64url') + '.c'
  globalThis.fetch = async (input, init) => {
    observed.push(new Headers(init?.headers).get('x-request-id')!)
    return new Response(JSON.stringify(String(input).endsWith('/user') ? { id } : { ok: false, code: 'invalid_nonce' }))
  }
  try {
    const handler = observeHandler('product-claim', createProductClaimHandler({ url: 'http://localhost', serviceKey: 'private service key', appOrigin: 'http://localhost' }), () => {})
    const result = await handler(new Request('http://localhost', { method: 'POST', headers: { 'x-request-id': id, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ nonce_id: id, sealed_code: 'sealed', signature: 'x'.repeat(88) }) }))
    assert.equal(result.status, 403)
    assert.deepEqual(observed, [id, id])
  } finally { globalThis.fetch = original }
})

test('gateway logs bounded operations, upstream IDs, early exits and aborted requests once', { timeout: 5000 }, async () => {
  const logs: string[] = [], forwarded: string[] = []
  let sawAbort!: () => void
  const observedAbort = new Promise<void>(resolve => { sawAbort = resolve })
  let release!: () => void, reached!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { reached = resolve })
  const upstream = createServer(async (req, res) => {
    forwarded.push(String(req.headers['x-request-id']))
    if (req.url === '/slow') { reached(); await waiting }
    if (req.url === '/disconnect') { req.socket.destroy(); return }
    res.writeHead(409, { 'Content-Type': 'application/json' }); res.end('{"ok":false}')
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const gateway: Server = startGateway({ settings: { service: 'private key', anon: 'test-only' }, appOrigin: 'http://allowed', port: 0, authUrl: address(upstream), restUrl: address(upstream), log: (line: string) => { logs.push(line); if (JSON.parse(line).outcome === 'aborted') sawAbort() } })
  await once(gateway, 'listening')
  try {
    const base = address(gateway)
    const denied = await fetch(base + '/private?password=secret', { headers: { origin: 'http://denied', 'x-request-id': 'malicious-secret' } })
    assert.equal(denied.status, 403)
    assert.match(denied.headers.get('x-request-id')!, uuid)
    const preflight = await fetch(base + '/functions/v1/product-claim', { method: 'OPTIONS', headers: { origin: 'http://allowed', 'x-request-id': id } })
    assert.equal(preflight.status, 204)
    assert.match(preflight.headers.get('access-control-allow-headers')!, /x-request-id/)
    assert.match(preflight.headers.get('access-control-expose-headers')!, /x-request-id/)
    const result = await fetch(base + '/rest/v1/rpc/private_name?token=secret', { method: 'PURGE', headers: { 'x-request-id': id.toUpperCase(), authorization: 'Bearer secret' } })
    assert.equal(result.status, 409)
    assert.equal(result.headers.get('x-request-id'), id)
    assert.equal(forwarded.at(-1), id)
    const edge = await fetch(base + '/functions/v1/telemetry-ingest', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': id }, body: '{}' })
    assert.equal(edge.status, 400)
    const tooBig = await fetch(base + '/rest/v1/x', { method: 'POST', body: 'x'.repeat(16385) })
    assert.equal(tooBig.status, 413)
    const unavailable = await fetch(base + '/rest/v1/disconnect', { headers: { 'x-request-id': id } })
    assert.equal(unavailable.status, 503)
    const malformed = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(base, { path: 'http://[invalid' }, response => { response.resume(); resolve(response.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(malformed, 400)
    const abortId = crypto.randomUUID()
    const aborted = new Promise<void>((resolve, reject) => {
      const req = httpRequest(base + '/rest/v1/slow', { headers: { 'x-request-id': abortId } }, () => reject(new Error('Unexpected response')))
      req.on('error', () => resolve()); req.end()
      void started.then(() => req.destroy())
    })
    await aborted
    await observedAbort
    release()
    const events = logs.map(line => JSON.parse(line)).filter(event => event.event === 'http_request')
    assert.equal(events.length, 8)
    assert.equal(events.filter(event => event.requestId === abortId).length, 1)
    assert.equal(events.at(-1).outcome, 'aborted')
    assert.equal(events.at(-1).status, null)
    assert.ok(events.some(event => event.operation === 'rpc' && event.method === 'OTHER' && event.status === 409))
    assert.ok(events.some(event => event.operation === 'telemetry-ingest' && event.status === 400))
    assert.ok(events.some(event => event.outcome === 'error' && event.status === 503))
    assert.doesNotMatch(logs.join(''), /secret|private_name|Bearer|password|malicious/)
  } finally { release(); await close(gateway); await close(upstream) }
})

test('gateway permits MFA DELETE preflights while preserving origin and Auth checks', async () => {
  const origin = 'http://127.0.0.1:5173', extra = 'http://127.0.0.1:4178'
  let calls = 0
  const upstream = createServer((req, res) => {
    calls++
    assert.equal(req.method, 'DELETE')
    assert.equal(req.url, '/factors/' + id)
    assert.equal(req.headers.apikey, 'synthetic-anon')
    assert.equal(req.headers['x-request-id'], id)
    const allowed = req.headers.authorization === 'Bearer synthetic-allowed'
    res.writeHead(allowed ? 204 : 401, { 'Content-Type': 'application/json' })
    res.end(allowed ? undefined : JSON.stringify({ message: 'Auth rejected the request' }))
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const gateway = startGateway({ settings: { anon: 'synthetic-anon', service: 'synthetic-service' }, appOrigin: origin, extraOrigins: [extra], authUrl: address(upstream), port: 0, explainer: null, log: () => {} })
  await once(gateway, 'listening')
  try {
    const url = address(gateway) + '/auth/v1/factors/' + id
    for (const allowedOrigin of [origin, extra]) {
      const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: allowedOrigin, 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' } })
      assert.equal(preflight.status, 204)
      assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin)
      assert.ok(preflight.headers.get('access-control-allow-methods')?.split(',').includes('DELETE'))
      for (const header of ['authorization', 'apikey', 'content-type']) assert.ok(preflight.headers.get('access-control-allow-headers')?.split(',').includes(header))
    }
    for (const method of ['OPTIONS', 'DELETE']) {
      const denied = await fetch(url, { method, headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'DELETE' } })
      assert.equal(denied.status, 403)
      assert.equal(denied.headers.get('access-control-allow-origin'), null)
    }
    assert.equal(calls, 0, 'Preflights and foreign origins must not reach Auth')
    const headers = { Origin: origin, apikey: 'synthetic-anon', authorization: 'Bearer synthetic-allowed', 'x-request-id': id }
    const removed = await fetch(url, { method: 'DELETE', headers })
    assert.equal(removed.status, 204)
    assert.equal(removed.headers.get('access-control-allow-origin'), origin)
    const rejected = await fetch(url, { method: 'DELETE', headers: { ...headers, authorization: 'Bearer synthetic-rejected' } })
    assert.equal(rejected.status, 401)
    assert.deepEqual(await rejected.json(), { message: 'Auth rejected the request' })
    assert.equal(calls, 2)
  } finally { await close(gateway); await close(upstream) }
})
