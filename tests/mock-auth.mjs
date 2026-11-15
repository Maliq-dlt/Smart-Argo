// A scripted Auth for browser tests that need no Docker: the gateway origin answers from `routes`, CORS wide open.
// A route key is "METHOD /path" or, to tell the token grants apart, "METHOD /path?query". A handler returns the JSON
// body, or { status, body }, and may be async (to hold a request in flight).
export const AUTH_URL = process.env.AUTH_URL || 'http://127.0.0.1:54321'
export const USER_ID = '6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f'
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

export function mockSession(meta = {}, { providers = ['email'], email = 'pot@contoh.test' } = {}) {
  const claims = { sub: USER_ID, email, exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal1', app_metadata: { providers }, user_metadata: meta }
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`, refresh_token: `r${Math.random().toString(36).slice(2)}`,
    expires_in: 3600, token_type: 'bearer', user: { id: USER_ID, email, factors: [] },
  }
}

export async function mockAuth(page, routes = {}) {
  const calls = []
  await page.route(`${AUTH_URL}/**`, async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const key = `${request.method()} ${url.pathname}`
    let body = null
    try { body = request.postDataJSON() } catch { /* no body */ }
    calls.push({ key, body })
    const handler = routes[`${key}${url.search}`] ?? routes[key]
    let answer = {}
    if (handler) answer = await handler(request, url)
    else if (key === 'GET /auth/v1/settings') answer = { external: { google: false, email: true } }
    else if (url.pathname.endsWith('/my_products')) answer = { products: [] }
    const scripted = answer && typeof answer === 'object' && 'status' in answer && 'body' in answer
    return route.fulfill({ status: scripted ? answer.status : 200, headers: cors, json: scripted ? answer.body : answer })
  })
  return { calls, count: key => calls.filter(c => c.key === key).length, bodies: key => calls.filter(c => c.key === key).map(c => c.body) }
}
