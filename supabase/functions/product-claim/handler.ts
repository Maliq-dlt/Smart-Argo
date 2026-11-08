import { verifyDeviceSignature } from '../_shared/deviceSignature.ts'
type Config = { url: string; serviceKey: string; appOrigin: string }
type Json = Record<string, unknown>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createProductClaimHandler(config: Config) {
  const base = new URL(config.url)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  const origin = new URL(config.appOrigin).origin
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    const reply = (status: number, data: Json) => new Response(JSON.stringify(data), { status, headers })
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply(403, { ok: false, code: 'origin_denied', message: 'Origin not allowed.' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, { ok: false, code: 'method_not_allowed', message: 'POST required.' })
    const authorization = request.headers.get('authorization') ?? ''
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return reply(401, { ok: false, code: 'unauthorized', message: 'Authentication required.' })
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply(415, { ok: false, code: 'invalid_content_type', message: 'JSON required.' })
    let body: Json
    try {
      const reader = request.body?.getReader(), chunks: Uint8Array[] = []
      let length = 0
      if (!reader) throw new Error('Empty body')
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 4096) { await reader.cancel(); return reply(413, { ok: false, code: 'body_too_large', message: 'Request too large.' }) }
        chunks.push(part.value)
      }
      const buffer = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
      body = JSON.parse(new TextDecoder().decode(buffer))
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Invalid body')
      if (typeof body.nonce_id !== 'string' || !uuid.test(body.nonce_id) || typeof body.sealed_code !== 'string' || !body.sealed_code.trim() || body.sealed_code.length > 256 || typeof body.signature !== 'string' || body.signature.length !== 88) throw new Error('Invalid fields')
    } catch { return reply(400, { ok: false, code: 'invalid_request', message: 'Invalid activation request.' }) }
    try {
      const auth = await fetch(`${base.origin}/auth/v1/user`, { headers: { Authorization: authorization, apikey: config.serviceKey }, signal: AbortSignal.timeout(10000) })
      if (!auth.ok) return reply(401, { ok: false, code: 'unauthorized', message: 'Session invalid or expired.' })
      const user: Json = await auth.json()
      // Decode only AFTER Auth validates the exact bearer token; unverified claims never grant access.
      const payload: Json = JSON.parse(atob(authorization.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (typeof user.id !== 'string' || !uuid.test(user.id) || payload.sub !== user.id || typeof payload.session_id !== 'string' || !uuid.test(payload.session_id) || user.is_anonymous === true) return reply(401, { ok: false, code: 'invalid_session', message: 'Authenticated account session required.' })
      const rpc = async (name: string, args: Json): Promise<Json> => {
        const result = await fetch(`${base.origin}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
          Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey, 'Content-Type': 'application/json',
        }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) })
        if (!result.ok) throw new Error('Database operation failed')
        const data: unknown = await result.json()
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as Json).ok !== 'boolean') throw new Error('Invalid database response')
        return data as Json
      }
      const proof = await rpc('get_activation_proof', { p_nonce_id: body.nonce_id })
      if (!proof.ok || proof.auth_user_id !== user.id || proof.session_id !== payload.session_id) return reply(403, { ok: false, code: 'invalid_nonce', message: 'Challenge unavailable for this session.' })
      const valid = typeof proof.public_key === 'string' && typeof proof.challenge === 'string' && proof.challenge.length <= 2048 &&
        await verifyDeviceSignature(proof.public_key, body.signature as string, proof.challenge)
      if (!valid) return reply(403, { ok: false, code: 'invalid_signature', message: 'Device signature invalid.' })
      const result = await rpc('claim_verified_product', { p_nonce_id: body.nonce_id, p_auth_user_id: user.id,
        p_session_id: payload.session_id, p_public_key: proof.public_key, p_sealed_code: body.sealed_code })
      const status = result.ok ? 200 : result.code === 'already_owned' || result.code === 'claim_conflict' ? 409 : 400
      return reply(status, result)
    } catch { return reply(503, { ok: false, code: 'service_unavailable', message: 'Activation temporarily unavailable. Retry the same challenge.' }) }
  }
}
