import { createServer } from 'node:http'
import { createHistoryExportHandler } from '../supabase/functions/history-export/handler.ts'
import { canonicalRequestId, logHttpRequest } from '../supabase/functions/_shared/observability.ts'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEnergyIngestHandler } from '../supabase/functions/energy-ingest/handler.ts'
import { createUnitExplanationHandler } from '../supabase/functions/unit-explanation/handler.ts'
import { createTelemetryIngestHandler } from '../supabase/functions/telemetry-ingest/handler.ts'
import { createProductClaimHandler } from '../supabase/functions/product-claim/handler.ts'
import { createProductProvisionHandler, issuerKeysFrom } from '../supabase/functions/product-provision/handler.ts'
import { createMfaRecoveryHandler } from '../supabase/functions/mfa-recovery/handler.ts'
import { explainerFromEnv } from '../src/lib/aiExplanation.ts'

export function startGateway({settings, appOrigin, authUrl='http://127.0.0.1:54324', restUrl='http://127.0.0.1:54325', host='127.0.0.1', extraOrigins=[], staticRoot='', port=54321, log=console.log, explainer=explainerFromEnv(name => process.env[name]), issuerKeys=issuerKeysFrom(process.env.ISSUER_PUBLIC_KEYS)}) {
  const config = {url:'http://127.0.0.1:54321', serviceKey:settings.service, appOrigin}
  const handlers = {'/functions/v1/history-export':createHistoryExportHandler(config), '/functions/v1/product-claim':createProductClaimHandler(config), '/functions/v1/product-provision':createProductProvisionHandler({...config, issuerKeys}), '/functions/v1/mfa-recovery':createMfaRecoveryHandler(config), '/functions/v1/telemetry-ingest':createTelemetryIngestHandler(config), '/functions/v1/unit-explanation':createUnitExplanationHandler({...config, explainer}), '/functions/v1/energy-ingest':createEnergyIngestHandler(config)}
  const allowedOrigins = new Set([appOrigin, ...extraOrigins])
  const server = createServer(async (req,res) => {
    const started = performance.now(), requestId = canonicalRequestId(req.headers['x-request-id'])
    let operation = 'not_found', logged = false, failed = false
    const completed = () => {
      if (logged) return
      logged = true
      const outcome = !res.writableFinished ? 'aborted' : failed ? 'error' : 'completed'
      logHttpRequest({entryPoint:'gateway', operation, requestId, method:req.method || 'OTHER', status:res.writableFinished ? res.statusCode : null, durationMs:performance.now()-started, outcome}, log)
    }
    res.once('finish',completed)
    res.once('close',completed)
    res.setHeader('x-request-id',requestId)
    try {
      let path
      try {path = new URL(req.url,config.url).pathname} catch {res.writeHead(400);res.end();return}
      operation = handlers[path] ? path.slice('/functions/v1/'.length) : path.startsWith('/auth/v1/') ? 'auth' : path.startsWith('/rest/v1/rpc/') ? 'rpc' : path.startsWith('/rest/v1/') ? 'rest' : path === '/health' ? 'health' : staticRoot ? 'static' : 'not_found'
      const origin = req.headers.origin
      res.setHeader('Cache-Control','no-store')
      res.setHeader('Vary','Origin')
      if (origin && !allowedOrigins.has(origin)) {res.writeHead(403);res.end();return}
      if (origin) res.setHeader('Access-Control-Allow-Origin',origin)
      res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-request-id')
      res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS') // PUT: Auth user metadata ("Siapkan pot")
      res.setHeader('Access-Control-Expose-Headers','x-request-id,x-history-snapshot-as-of,x-history-row-count')
      if (req.method === 'OPTIONS') {res.writeHead(204);res.end();return}
      if (req.method === 'GET' && path === '/health') {
        const checks = await Promise.all([fetch(authUrl+'/health',{headers:{'x-request-id':requestId},signal:AbortSignal.timeout(3000)}), fetch(restUrl+'/',{headers:{'x-request-id':requestId},signal:AbortSignal.timeout(3000)})])
        const ready = checks.every(response => response.ok)
        res.writeHead(ready ? 200 : 503, {'Content-Type':'application/json'})
        res.end(JSON.stringify({status:ready ? 'ready' : 'unavailable'}));return
      }
      if (req.method === 'GET' && path === '/runtime-config.js' && staticRoot) {
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8'})
        res.end(`window.SMART_AGRO_CONFIG = {url: window.location.origin, anonKey: ${JSON.stringify(settings.anon)}};`);return
      }
      if (staticRoot && !path.startsWith('/auth/v1/') && !path.startsWith('/rest/v1/') && !path.startsWith('/functions/v1/')) {
        if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return}
        let requested
        try {requested = decodeURIComponent(path)} catch {res.writeHead(400);res.end();return}
        const file = resolve(staticRoot, '.'+(requested === '/' ? '/index.html' : requested))
        if (!file.startsWith(staticRoot+sep)) {res.writeHead(403);res.end();return}
        let resolved
        try {resolved = await realpath(file)} catch {res.writeHead(404);res.end();return}
        if (!resolved.startsWith(staticRoot+sep) || !(await stat(resolved)).isFile()) {res.writeHead(404);res.end();return}
        const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.wasm':'application/wasm','.md':'text/markdown; charset=utf-8','.mp4':'video/mp4','.avif':'image/avif','.txt':'text/plain; charset=utf-8','.ico':'image/x-icon'}
        res.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'})
        res.end(req.method === 'HEAD' ? undefined : await readFile(resolved));return
      }
      const maxBody = ['/rest/v1/rpc/save_unit_explanation','/rest/v1/rpc/finish_unit_explanation'].includes(path) ? 600000 : 16384
      const parts=[];let length=0
      for await (const part of req) {length+=part.length;if(length>maxBody){res.writeHead(413);res.end();return}parts.push(part)}
      const body=Buffer.concat(parts)
      let result
      if (handlers[path]) {
        const headers = new Headers({'x-request-id':requestId})
        for (const [k,v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'origin' && k !== 'x-request-id') headers.set(k,v)
        result = await handlers[path](new Request(config.url+path,{method:req.method,headers,...(body.length?{body}:{})}))
      } else {
        const upstream = path.startsWith('/auth/v1/') ? authUrl+req.url.slice('/auth/v1'.length) : path.startsWith('/rest/v1/') ? restUrl+req.url.slice('/rest/v1'.length) : null
        if (!upstream) {res.writeHead(404);res.end();return}
        const headers={'x-request-id':requestId}
        for (const k of ['authorization','apikey','content-type','prefer']) if (req.headers[k]) headers[k]=req.headers[k]
        // manual: OAuth (/authorize -> Google, /callback -> app) must reach the browser as a redirect, not be followed here.
        result=await fetch(upstream,{method:req.method,headers,redirect:'manual',...(body.length?{body}:{}),signal:AbortSignal.timeout(15000)})
      }
      res.statusCode=result.status
      for (const key of ['content-disposition','x-content-type-options','x-history-snapshot-as-of','x-history-row-count']) if (result.headers.has(key)) res.setHeader(key,result.headers.get(key))
      if (result.headers.get('location')) res.setHeader('Location',result.headers.get('location'))
      res.setHeader('Content-Type',result.headers.get('content-type') || 'application/json')
      res.end(Buffer.from(await result.arrayBuffer()))
    } catch {
      failed = true
      if (res.headersSent) res.destroy()
      else {res.writeHead(503);res.end(JSON.stringify({message:'Local backend unavailable'}))}
    }
  })
  server.requestTimeout=15000
  server.headersTimeout=10000
  server.listen(port,host,()=>{try {log(JSON.stringify({event:'gateway_ready',entryPoint:'gateway',port:server.address().port}))} catch { /* Logging is best effort. */ }})
  return server
}

// ponytail: Node serves this assessment build; use a CDN/reverse proxy for high-traffic hosting.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings=JSON.parse(await readFile('/run/smart-agro/settings.json','utf8'))
  const server=startGateway({settings,appOrigin:process.env.APP_ORIGIN || 'http://127.0.0.1:8088',authUrl:'http://auth:9999',restUrl:'http://rest:3000',host:'0.0.0.0',staticRoot:resolve('dist')})
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)))
}
