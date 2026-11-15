import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createWeatherForecastHandler } from '../supabase/functions/weather-forecast/handler.ts'

// No test in this file reaches the network: the real fetch is replaced by one that fails the test, and every provider answer is injected.
const realFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error('A test must not use the network') }) as typeof fetch
test.after(() => { globalThis.fetch = realFetch })

const fixture = readFileSync(new URL('./fixtures/open-meteo-forecast.json', import.meta.url), 'utf8')
const origin = 'https://app.example'
const asked: { url: string; init?: RequestInit }[] = []
const provider = (answer: () => Response | Promise<Response>) => (async (input: URL | RequestInfo, init?: RequestInit) => { asked.push({ url: String(input), init }); return answer() }) as typeof fetch
const call = (fetch: typeof globalThis.fetch, body: unknown = { lat: -6.2041, lon: 106.8456 }, headers: Record<string, string> = {}, method = 'POST') => {
  asked.length = 0
  return createWeatherForecastHandler({ appOrigin: origin, fetch })(new Request('http://function.local/', { method, headers: { authorization: 'Bearer caller.token.value', 'content-type': 'application/json', origin, ...headers }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }))
}
const ok = provider(() => new Response(fixture))

test('a good request returns the snapshot, asks the provider once, and sends it only a place rounded to about a kilometre', async () => {
  const response = await call(ok)
  assert.equal(response.status, 200)
  const body = await response.json() as { ok: boolean; weather: { condition: string; tempC: number; forecast: unknown[] } }
  assert.equal(body.ok, true)
  assert.equal(body.weather.condition, 'mendung')
  assert.equal(body.weather.tempC, 29.4)
  assert.equal(body.weather.forecast.length, 6)
  assert.equal(asked.length, 1)
  const url = new URL(asked[0].url)
  assert.equal(url.hostname, 'api.open-meteo.com')
  assert.equal(url.searchParams.get('latitude'), '-6.2')
  assert.equal(url.searchParams.get('longitude'), '106.85')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['current', 'forecast_days', 'hourly', 'latitude', 'longitude', 'timezone', 'wind_speed_unit'])
  const sent = new Headers(asked[0].init?.headers)
  assert.equal(sent.get('authorization'), null, 'The caller\'s token never goes to the weather provider')
  assert.equal(sent.get('cookie'), null)
})

test('the place must be two finite numbers in range, and a bad request never reaches the provider', async () => {
  for (const body of [{}, { lat: '1', lon: 2 }, { lat: 1 }, { lat: 91, lon: 0 }, { lat: -90.1, lon: 0 }, { lat: 0, lon: 181 }, { lat: Number.NaN, lon: 0 }, { lat: null, lon: 0 }, [1, 2], 'not json', '{"lat":1,"lon":', null]) {
    const response = await call(provider(() => { throw new Error('the provider must not be asked') }), body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.equal(((await response.json()) as { code: string }).code, 'invalid_request')
    assert.equal(asked.length, 0)
  }
  const edge = await call(ok, { lat: 90, lon: -180 })
  assert.equal(edge.status, 200, 'the limits themselves are valid')
  const wrongType = await call(ok, { lat: 1, lon: 1 }, { 'content-type': 'text/plain' })
  assert.equal(wrongType.status, 415)
  const big = await call(ok, { lat: 1, lon: 1, padding: 'x'.repeat(2000) })
  assert.equal(big.status, 400, 'a body larger than a place needs is refused')
  const noToken = await call(ok, { lat: 1, lon: 1 }, { authorization: 'nope' })
  assert.equal(noToken.status, 401)
})

test('CORS is locked to the app origin, and only POST answers', async () => {
  const preflight = await call(ok, undefined, { 'access-control-request-method': 'POST' }, 'OPTIONS')
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  const other = await call(ok, { lat: 1, lon: 1 }, { origin: 'https://evil.example' })
  assert.equal(other.status, 403)
  assert.equal(other.headers.get('access-control-allow-origin'), origin, 'never reflects the caller\'s origin')
  assert.equal(((await other.json()) as { code: string }).code, 'origin_denied')
  assert.equal((await call(ok, undefined, {}, 'GET')).status, 405)
  assert.equal(asked.length, 0)
})

test('any trouble at the provider becomes weather_unavailable and leaks nothing of it', async () => {
  const failures: (() => Response | Promise<Response>)[] = [
    () => new Response('upstream exploded at 10.0.0.7', { status: 500 }),
    () => new Response('{"reason":"limit"}', { status: 429 }),
    () => { throw new Error('connect ECONNREFUSED 10.0.0.7:443') },
    () => new Response('<html>not json</html>'),
    () => new Response('{"current":{"temperature_2m":"warm"}}'),
    () => new Response('null'),
  ]
  for (const failure of failures) {
    const response = await call(provider(failure))
    assert.equal(response.status, 502)
    const text = await response.text()
    assert.equal((JSON.parse(text) as { code: string }).code, 'weather_unavailable')
    assert.ok(!/10\.0\.0\.7|exploded|ECONNREFUSED|limit/.test(text), `no provider detail in: ${text}`)
  }
})

test('the provider call has a time limit and follows no redirect', async () => {
  await call(ok)
  assert.ok(asked[0].init?.signal, 'a time limit is set')
  assert.equal(asked[0].init?.redirect, 'error')
})
