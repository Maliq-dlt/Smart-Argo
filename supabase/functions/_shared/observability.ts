type Operation = 'weather-forecast' | 'history-export' | 'product-claim' | 'product-provision' | 'mfa-recovery' | 'telemetry-ingest' | 'energy-ingest' | 'unit-explanation' | 'auth' | 'rpc' | 'rest' | 'health' | 'static' | 'not_found'
type LogSink = (line: string) => void

export function canonicalRequestId(value: unknown): string {
  return typeof value === 'string' && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : crypto.randomUUID()
}

export function logHttpRequest(event: { entryPoint: 'edge' | 'gateway'; operation: Operation; requestId: string; method: string; status: number | null; durationMs: number; outcome: 'completed' | 'aborted' | 'error' }, sink: LogSink = console.log): void {
  try {
    const { status, outcome } = event
    sink(JSON.stringify({ event: 'http_request', timestamp: new Date().toISOString(), entryPoint: event.entryPoint, operation: event.operation, requestId: event.requestId, status, outcome,
      method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(event.method) ? event.method : 'OTHER',
      durationMs: Math.max(0, Math.round(event.durationMs)),
      level: outcome === 'error' || (status !== null && status >= 500) ? 'error' : outcome === 'aborted' || (status !== null && status >= 400) ? 'warn' : 'info',
    }))
  } catch { /* Logging failure must not change the business response. */ }
}

// ponytail: JSON stdout supports current Edge/Node runtimes; add a metrics/tracing sink when operating multiple services with measured SLOs.
export function observeHandler(operation: Operation, handler: (request: Request) => Promise<Response>, sink: LogSink = console.log): (request: Request) => Promise<Response> {
  return async request => {
    const started = performance.now(), requestId = canonicalRequestId(request.headers.get('x-request-id'))
    const headers = new Headers(request.headers)
    headers.set('x-request-id', requestId)
    let response: Response, outcome: 'completed' | 'aborted' | 'error' = 'completed'
    try { response = await handler(new Request(request, { headers })) }
    catch {
      outcome = 'error'
      response = new Response(JSON.stringify({ ok: false, code: 'internal_error', message: 'Service temporarily unavailable.' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    }
    if (request.signal.aborted) outcome = 'aborted'
    const responseHeaders = new Headers(response.headers)
    responseHeaders.set('x-request-id', requestId)
    responseHeaders.append('Access-Control-Expose-Headers', 'x-request-id')
    logHttpRequest({ entryPoint: 'edge', operation, requestId, method: request.method, status: outcome === 'aborted' ? null : response.status, durationMs: performance.now() - started, outcome }, sink)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
  }
}
