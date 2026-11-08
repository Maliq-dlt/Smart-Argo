import { parseTelemetryV2 } from '../../../src/lib/telemetry.ts'
import { verifyDeviceSignature } from '../_shared/deviceSignature.ts'
type Json = Record<string, unknown>

export function createTelemetryIngestHandler(config: { url: string; serviceKey: string; appOrigin: string }) {
  const base = new URL(config.url)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  const origin = new URL(config.appOrigin).origin
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    const reply = (status: number, data: Json) => new Response(JSON.stringify(data), { status, headers })
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply(403, { ok: false, code: 'origin_denied', message: 'Origin not allowed.' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, { ok: false, code: 'method_not_allowed', message: 'POST required.' })
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply(415, { ok: false, code: 'invalid_content_type', message: 'JSON required.' })
    let envelope: { payload: string; signature: string }, deviceId: string
    try {
      const reader = request.body?.getReader(), parts: Uint8Array[] = []
      if (!reader) throw new Error('Empty request')
      let length = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 12288) { await reader.cancel(); return reply(413, { ok: false, code: 'body_too_large', message: 'Request too large.' }) }
        parts.push(part.value)
      }
      const buffer = new Uint8Array(length)
      let offset = 0
      for (const part of parts) { buffer.set(part, offset); offset += part.length }
      envelope = JSON.parse(new TextDecoder().decode(buffer))
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || typeof envelope.payload !== 'string' || new TextEncoder().encode(envelope.payload).length > 4096 || typeof envelope.signature !== 'string' || envelope.signature.length !== 88) throw new Error('Invalid envelope')
      deviceId = parseTelemetryV2(JSON.parse(envelope.payload)).device_id
    } catch { return reply(400, { ok: false, code: 'invalid_packet', message: 'Invalid device telemetry packet.' }) }
    try {
      const rpc = async (name: string, data: Json): Promise<Json> => {
        const response = await fetch(`${base.origin}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
          'Content-Type': 'application/json', apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
        }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error('Database operation failed')
        const result: unknown = await response.json()
        if (!result || typeof result !== 'object' || Array.isArray(result) || typeof (result as Json).ok !== 'boolean') throw new Error('Invalid database response')
        return result as Json
      }
      const device = await rpc('get_telemetry_device', { p_device_id: deviceId })
      if (!device.ok || typeof device.public_key !== 'string') return reply(403, { ok: false, code: 'device_unavailable', message: 'Device unavailable.' })
      if (!await verifyDeviceSignature(device.public_key, envelope.signature, envelope.payload)) return reply(403, { ok: false, code: 'invalid_signature', message: 'Device signature invalid.' })
      const result = await rpc('ingest_verified_telemetry', { p_payload: envelope.payload, p_public_key: device.public_key, p_signature: envelope.signature })
      const status = result.ok ? 200 : result.code === 'sequence_conflict' || result.code === 'sequence_out_of_order' ? 409 : result.code === 'rate_limited' ? 429 : result.code === 'device_unavailable' || result.code === 'unit_unavailable' ? 403 : 400
      return reply(status, result)
    } catch { return reply(503, { ok: false, code: 'service_unavailable', message: 'Telemetry temporarily unavailable. Retry the same signed packet.' }) }
  }
}
