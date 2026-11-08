import { parseEnergyPacket } from '../../../src/lib/energyTelemetry.ts'
import { verifyDeviceSignature } from '../_shared/deviceSignature.ts'
type Json = Record<string, unknown>

export function createEnergyIngestHandler(config: { url: string; serviceKey: string; appOrigin: string }) {
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
    let envelope: { payload: string; signature: string }, deviceId: string, meterId: string
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
      const packet = parseEnergyPacket(JSON.parse(envelope.payload))
      deviceId = packet.device_id; meterId = packet.meter_id
    } catch { return reply(400, { ok: false, code: 'invalid_packet', message: 'Invalid signed energy packet.' }) }
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
      const device = await rpc('get_energy_meter', { p_meter_id: meterId })
      if (!device.ok || device.device_id !== deviceId || typeof device.public_key !== 'string') return reply(403, { ok: false, code: 'meter_unavailable', message: 'Meter unavailable.' })
      if (!await verifyDeviceSignature(device.public_key, envelope.signature, envelope.payload)) return reply(403, { ok: false, code: 'invalid_signature', message: 'Meter signature invalid.' })
      const result = await rpc('ingest_verified_energy', { p_payload: envelope.payload, p_public_key: device.public_key, p_signature: envelope.signature })
      const status = result.ok ? 200 : result.code === 'sequence_conflict' || result.code === 'counter_out_of_order' || result.code === 'window_overlap' ? 409 : result.code === 'rate_limited' ? 429 : result.code === 'meter_unavailable' ? 403 : 400
      return reply(status, result)
    } catch { return reply(503, { ok: false, code: 'service_unavailable', message: 'Energy ingestion temporarily unavailable. Retry the same signed packet.' }) }
  }
}
