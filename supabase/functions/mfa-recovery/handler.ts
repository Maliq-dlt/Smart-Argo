import { canonicalRequestId } from '../_shared/observability.ts'
// APP-01: a lost authenticator. The caller signed in with their password and holds an aal1 token, which Auth validates
// here. One recovery code is spent through the service role (consume_recovery_code: rate limited, one use, retry
// window), the TOTP factors are removed through the Auth admin API, and every other session is signed out. The
// database records the recovery, which starts the 24-hour security hold.
type Config = { url: string; serviceKey: string; appOrigin: string }
type Json = Record<string, unknown>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createMfaRecoveryHandler(config: Config) {
  const base = new URL(config.url)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  const origin = new URL(config.appOrigin).origin
  return async (request: Request): Promise<Response> => {
    const requestId = canonicalRequestId(request.headers.get('x-request-id'))
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-request-id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    const reply = (status: number, data: Json) => new Response(JSON.stringify(data), { status, headers })
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply(403, { ok: false, code: 'origin_denied', message: 'Origin not allowed.' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, { ok: false, code: 'method_not_allowed', message: 'POST required.' })
    const authorization = request.headers.get('authorization') ?? ''
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return reply(401, { ok: false, code: 'unauthorized', message: 'Authentication required.' })
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply(415, { ok: false, code: 'invalid_content_type', message: 'JSON required.' })
    let code: string
    try {
      const text = await request.text()
      if (text.length > 512) return reply(413, { ok: false, code: 'body_too_large', message: 'Request too large.' })
      const body: unknown = JSON.parse(text)
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as Json).code !== 'string' || ((body as Json).code as string).length > 32) throw new Error('Invalid')
      code = (body as Json).code as string
    } catch { return reply(400, { ok: false, code: 'invalid_request', message: 'Recovery code required.' }) }
    try {
      const service = { 'x-request-id': requestId, Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'Content-Type': 'application/json' }
      const auth = await fetch(`${base.origin}/auth/v1/user`, { headers: { 'x-request-id': requestId, Authorization: authorization, apikey: config.serviceKey }, signal: AbortSignal.timeout(10000) })
      if (!auth.ok) return reply(401, { ok: false, code: 'unauthorized', message: 'Session invalid or expired.' })
      const user: Json = await auth.json()
      if (typeof user.id !== 'string' || !uuid.test(user.id) || user.is_anonymous === true) return reply(401, { ok: false, code: 'invalid_session', message: 'Account session required.' })
      const consumed = await fetch(`${base.origin}/rest/v1/rpc/consume_recovery_code`, { method: 'POST', headers: service,
        body: JSON.stringify({ p_user_id: user.id, p_code: code }), signal: AbortSignal.timeout(10000) })
      if (!consumed.ok) throw new Error('Database operation failed')
      const result: Json = await consumed.json()
      if (!result.ok) return reply(result.code === 'rate_limited' ? 429 : 400, result)
      const factors = Array.isArray(result.factor_ids) ? result.factor_ids.filter((id): id is string => typeof id === 'string' && uuid.test(id)) : []
      for (const factor of factors) {
        const removed = await fetch(`${base.origin}/auth/v1/admin/users/${user.id}/factors/${factor}`, { method: 'DELETE', headers: service, signal: AbortSignal.timeout(10000) })
        if (!removed.ok && removed.status !== 404) throw new Error('Factor removal failed')
      }
      // Whoever else holds a session (possibly the reason for this recovery) is signed out; this session stays.
      await fetch(`${base.origin}/auth/v1/logout?scope=others`, { method: 'POST', headers: { 'x-request-id': requestId, Authorization: authorization, apikey: config.serviceKey }, signal: AbortSignal.timeout(10000) })
      return reply(200, { ok: true, removed: factors.length })
    } catch { return reply(503, { ok: false, code: 'service_unavailable', message: 'Recovery temporarily unavailable. Retry with the same code within ten minutes.' }) }
  }
}
