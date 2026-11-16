import { canonicalRequestId } from '../_shared/observability.ts'
import { appOrigins, originFor } from '../_shared/origin.ts'

type Json = Record<string, unknown>
const uuid = (value: unknown): value is string => typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})(?![\s\S])/.test(value) && Number.isFinite(Date.parse(value))
const columns = ['id', 'unit_id', 'device_id', 'packet_id', 'sensor_id', 'source', 'quality_status', 'value_nullable', 'error_message', 'measured_at', 'received_at', 'clock_status', 'sequence', 'boot_id'] as const

function csvCell(value: unknown): string {
  if (value === null) return '""'
  let text = String(value)
  // eslint-disable-next-line no-control-regex -- Skip leading control bytes when detecting spreadsheet formulas.
  if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}

function validReading(row: Json, unitId: string): boolean {
  return ['id', 'device_id', 'packet_id', 'boot_id'].every(key => uuid(row[key])) && row.unit_id === unitId
    && typeof row.sensor_id === 'string' && ['moisture', 'soil_temperature', 'soil_ph'].includes(row.sensor_id) && row.source === 'device'
    && typeof row.quality_status === 'string' && ['ok', 'error', 'not_measured'].includes(row.quality_status)
    && (row.quality_status === 'ok' ? typeof row.value_nullable === 'number' && Number.isFinite(row.value_nullable) : row.value_nullable === null)
    && (row.error_message === null || (typeof row.error_message === 'string' && row.error_message.length <= 240))
    && timestamp(row.measured_at) && timestamp(row.received_at) && typeof row.clock_status === 'string' && ['synced', 'unsynced'].includes(row.clock_status)
    && typeof row.sequence === 'number' && Number.isInteger(row.sequence) && row.sequence >= 0
}

export function createHistoryExportHandler(config: { url: string; serviceKey: string; appOrigin: string }) {
  const base = new URL(config.url), origins = appOrigins(config.appOrigin)
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  return async (request: Request): Promise<Response> => {
    const origin = originFor(origins, request)
    const requestId = canonicalRequestId(request.headers.get('x-request-id'))
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-request-id',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'x-history-snapshot-as-of, x-history-row-count', 'x-request-id': requestId }
    const reply = (status: number, code: string, message: string) => new Response(JSON.stringify({ ok: false, code, message }), { status, headers })
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) return reply(403, 'origin_denied', 'Origin not allowed.')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, 'method_not_allowed', 'POST required.')
    const authorization = request.headers.get('authorization') ?? ''
    if (authorization.length > 8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return reply(401, 'unauthorized', 'Authentication required.')
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply(415, 'invalid_content_type', 'JSON required.')
    let body: Json
    try {
      const reader = request.body?.getReader(), parts: Uint8Array[] = []
      if (!reader) throw new Error('Empty body')
      let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > 4096) { await reader.cancel(); return reply(413, 'body_too_large', 'Request too large.') }
        parts.push(part.value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const part of parts) { bytes.set(part, offset); offset += part.length }
      body = JSON.parse(new TextDecoder().decode(bytes))
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !['unit_id', 'from', 'to'].includes(key)) || !uuid(body.unit_id)) throw new Error('Invalid unit')
      for (const key of ['from', 'to']) {
        if (typeof body[key] !== 'string' || !timestamp(body[key]) || Number(body[key].slice(0, 4)) < 1 || new Date(body[key]).toISOString() !== body[key]) throw new Error('Canonical UTC required')
      }
      const span = Date.parse(body.to as string) - Date.parse(body.from as string)
      if (span <= 0 || span > 31 * 86400000) throw new Error('Invalid range')
    } catch { return reply(400, 'invalid_request', 'Unit and UTC timestamps from/to (YYYY-MM-DDTHH:mm:ss.sssZ), within 31 days, required.') }
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15000)])
      const upstreamHeaders = { Authorization: authorization, apikey: config.serviceKey, 'x-request-id': requestId }
      const auth = await fetch(`${base.origin}/auth/v1/user`, { headers: upstreamHeaders, signal })
      if (!auth.ok) return reply(401, 'unauthorized', 'Session invalid or expired.')
      const user: Json = await auth.json()
      if (!uuid(user.id) || user.is_anonymous === true) return reply(401, 'unauthorized', 'Account session required.')
      const unitId = (body.unit_id as string).toLowerCase(), lines = ['\uFEFF' + columns.join(',') + '\r\n']
      let snapshot: string | null = null, cursor: Json | null = null, count = 0, pages = 0, bytes = new TextEncoder().encode(lines[0]).length
      // ponytail: synchronous exports stop at 5,000 rows/4 MiB; use an authenticated export job when measured demand needs larger files.
      while (true) {
        if (++pages > 10) return reply(413, 'export_too_large', 'Choose a smaller time range.')
        const response = await fetch(`${base.origin}/rest/v1/rpc/read_my_measurement_history`, { method: 'POST', headers: { ...upstreamHeaders, 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ p_unit_id: unitId, p_from: body.from, p_to: body.to, p_limit: 500, p_snapshot_as_of: snapshot, p_cursor_at: cursor?.measured_at ?? null, p_cursor_id: cursor?.id ?? null }) })
        if (!response.ok) throw new Error('History unavailable')
        const page: Json = await response.json()
        if (page.ok === false) {
          if (page.code === 'unauthorized') return reply(401, 'unauthorized', 'Active session required.')
          if (page.code === 'unit_unavailable') return reply(403, 'unit_unavailable', 'Owned unit required.')
          if (['invalid_range', 'invalid_cursor', 'invalid_request'].includes(String(page.code))) return reply(400, 'invalid_request', 'Invalid history range or cursor.')
          if (page.code === 'range_too_large') return reply(413, 'export_too_large', 'Choose a smaller time range.')
          throw new Error('History unavailable')
        }
        if (page.ok !== true || page.unit_id !== unitId || !timestamp(page.snapshot_as_of) || (snapshot !== null && page.snapshot_as_of !== snapshot)
          || !Array.isArray(page.readings) || page.readings.length > 500) throw new Error('Invalid history response')
        snapshot = page.snapshot_as_of
        for (const row of page.readings) {
          if (!row || typeof row !== 'object' || Array.isArray(row) || !validReading(row, unitId)) throw new Error('Invalid reading')
          const line = columns.map(key => csvCell(row[key])).join(',') + '\r\n'
          count++; bytes += new TextEncoder().encode(line).length
          if (count > 5000 || bytes > 4 * 1024 * 1024) return reply(413, 'export_too_large', 'Choose a smaller time range; export limit is 5,000 rows or 4 MiB.')
          lines.push(line)
        }
        if (page.next_cursor === null) break
        const next = page.next_cursor as Json, last = page.readings.at(-1)
        if (!next || !timestamp(next.measured_at) || !uuid(next.id) || !last || next.measured_at !== last.measured_at || next.id !== last.id || JSON.stringify(next) === JSON.stringify(cursor)) throw new Error('Invalid cursor')
        if (count >= 5000) return reply(413, 'export_too_large', 'Choose a smaller time range; export limit is 5,000 rows.')
        cursor = { measured_at: next.measured_at, id: next.id }
      }
      return new Response(lines.join(''), { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smart-agro-history.csv"', 'X-Content-Type-Options': 'nosniff', 'x-history-snapshot-as-of': snapshot!, 'x-history-row-count': String(count) } })
    } catch { return reply(503, 'service_unavailable', 'History export temporarily unavailable.') }
  }
}
