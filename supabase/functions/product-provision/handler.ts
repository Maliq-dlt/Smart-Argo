import { canonicalRequestId } from '../_shared/observability.ts'
import { appOrigins, originFor } from '../_shared/origin.ts'
import { verifyDeviceSignature } from '../_shared/deviceSignature.ts'
// ID-04: an operator registers an official product from an issuer-signed manifest. The issuer's public keys are pinned
// here (ISSUER_PUBLIC_KEYS), outside operator control. A valid signature is recorded with the service role
// (attest_issuer_manifest); the product is then provisioned with the operator's own bearer, so the database's TOTP
// gate and audit apply to the person, and an unsigned manifest cannot be provisioned by calling the RPC directly.
type Config = { url: string; serviceKey: string; appOrigin: string; issuerKeys: Record<string, string> }
type Json = Record<string, unknown>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Pinned issuer keys from the environment: {"key-id": "<base64 Ed25519 public key>"}. Invalid entries are dropped. */
export function issuerKeysFrom(value: string | undefined): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, key]) => /^[a-z0-9][a-z0-9-]{2,63}$/.test(id) && typeof key === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(key)))
  } catch { return {} }
}

export function createProductProvisionHandler(config: Config) {
  const base = new URL(config.url)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  const origins = appOrigins(config.appOrigin)
  return async (request: Request): Promise<Response> => {
    const origin = originFor(origins, request)
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
    let body: Json, manifest: Json
    try {
      const reader = request.body?.getReader(), chunks: Uint8Array[] = []
      let length = 0
      if (!reader) throw new Error('Empty body')
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 12288) { await reader.cancel(); return reply(413, { ok: false, code: 'body_too_large', message: 'Request too large.' }) }
        chunks.push(part.value)
      }
      const buffer = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length }
      body = JSON.parse(new TextDecoder().decode(buffer))
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Invalid body')
      if (typeof body.request_id !== 'string' || !uuid.test(body.request_id) || typeof body.manifest !== 'string' || body.manifest.length > 8192
        || typeof body.signature !== 'string' || body.signature.length !== 88
        || typeof body.activation_secret_hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.activation_secret_hash)) throw new Error('Invalid fields')
      manifest = JSON.parse(body.manifest)
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || typeof manifest.issuer_key_id !== 'string') throw new Error('Invalid manifest')
    } catch { return reply(400, { ok: false, code: 'invalid_request', message: 'Invalid provisioning request.' }) }
    const issuerKey = Object.hasOwn(config.issuerKeys, manifest.issuer_key_id as string) ? config.issuerKeys[manifest.issuer_key_id as string] : undefined
    if (!issuerKey) return reply(400, { ok: false, code: 'unknown_issuer', message: 'Manifest issuer key is not trusted.' })
    if (!await verifyDeviceSignature(issuerKey, body.signature as string, body.manifest as string)) return reply(400, { ok: false, code: 'invalid_signature', message: 'Issuer signature invalid.' })
    try {
      const auth = await fetch(`${base.origin}/auth/v1/user`, { headers: { 'x-request-id': requestId, Authorization: authorization, apikey: config.serviceKey }, signal: AbortSignal.timeout(10000) })
      if (!auth.ok) return reply(401, { ok: false, code: 'unauthorized', message: 'Session invalid or expired.' })
      const call = async (name: string, args: Json, bearer: string): Promise<Json> => {
        const result = await fetch(`${base.origin}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'x-request-id': requestId,
          Authorization: bearer, apikey: config.serviceKey, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) })
        if (!result.ok) throw new Error('Database operation failed')
        const data: unknown = await result.json()
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof (data as Json).ok !== 'boolean') throw new Error('Invalid database response')
        return data as Json
      }
      const attested = await call('attest_issuer_manifest', { p_manifest: body.manifest, p_key_id: manifest.issuer_key_id, p_signature: body.signature }, `Bearer ${config.serviceKey}`)
      if (!attested.ok) return reply(400, attested)
      const result = await call('operator_provision_product', { p_request_id: body.request_id, p_manifest: body.manifest,
        p_signature: body.signature, p_activation_secret_hash: body.activation_secret_hash }, authorization)
      const code = result.code
      const status = result.ok ? 200 : code === 'unauthorized' ? 401 : code === 'forbidden' || code === 'mfa_required' || code === 'step_up_required' ? 403
        : code === 'serial_taken' || code === 'key_in_use' || code === 'request_conflict' ? 409 : 400
      return reply(status, result)
    } catch { return reply(503, { ok: false, code: 'service_unavailable', message: 'Provisioning temporarily unavailable. Retry the same request.' }) }
  }
}
