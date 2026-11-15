import { canonicalRequestId } from '../_shared/observability.ts'
import { fromOpenMeteo } from '../../../src/lib/weather.ts'

/* Weather for a place, from Open-Meteo, through the server so the browser never talks to the provider and the place is
 * rounded first. This function is NOT deployed and is in no deploy script or gateway; see docs/cuaca.md ("Keadaan saat ini"). */

const MAX_BODY = 512
const MAX_ANSWER = 200_000
const TIMEOUT_MS = 5000
/** About a kilometre: enough for a forecast, too coarse to point at a house. */
const round2 = (x: number) => Math.round(x * 100) / 100

function place(text: string): { lat: number; lon: number } | null {
  if (text.length > MAX_BODY) return null
  let body: unknown
  try { body = JSON.parse(text) } catch { return null }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const { lat, lon } = body as Record<string, unknown>
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

export function createWeatherForecastHandler(config: { appOrigin: string; fetch?: typeof fetch }) {
  const origin = new URL(config.appOrigin).origin
  const ask = config.fetch ?? ((input: URL | RequestInfo, init?: RequestInit) => fetch(input, init))
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300', Vary: 'Origin',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-request-id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'x-request-id': canonicalRequestId(request.headers.get('x-request-id')) }
    const reply = (status: number, code: string, message: string) => new Response(JSON.stringify({ ok: false, code, message }), { status, headers })
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply(403, 'origin_denied', 'Origin not allowed.')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, 'method_not_allowed', 'POST required.')
    const authorization = request.headers.get('authorization') ?? ''
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return reply(401, 'unauthorized', 'Authentication required.')
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply(415, 'invalid_content_type', 'JSON required.')
    const where = place(await request.text())
    if (!where) return reply(400, 'invalid_request', 'lat and lon must be numbers in range.')
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(round2(where.lat)))
    url.searchParams.set('longitude', String(round2(where.lon)))
    url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m')
    url.searchParams.set('hourly', 'temperature_2m,precipitation,weather_code')
    url.searchParams.set('forecast_days', '2')
    url.searchParams.set('timezone', 'auto')
    url.searchParams.set('wind_speed_unit', 'ms')
    try {
      // Only the place goes out: no token, no cookie, no caller headers. A redirect is an error, not something to follow.
      const answer = await ask(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
      if (!answer.ok) throw new Error('provider status')
      const text = await answer.text()
      if (text.length > MAX_ANSWER) throw new Error('provider answer too large')
      return new Response(JSON.stringify({ ok: true, weather: fromOpenMeteo(JSON.parse(text)) }), { status: 200, headers })
    } catch {
      // The detail (a status, an address, a stack) stays on the server.
      return reply(502, 'weather_unavailable', 'Weather is not available right now.')
    }
  }
}
