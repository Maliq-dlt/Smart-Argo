import { explainDeviceEvidence, parseExplanationContext, withAi, type Explainer } from '../../../src/lib/deviceExplanation.ts'
type Json = Record<string, unknown>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function createUnitExplanationHandler(config: {url:string;serviceKey:string;appOrigin:string;explainer?:Explainer}) {
  const base=new URL(config.url), origin=new URL(config.appOrigin).origin
  if (base.protocol!=='https:' && !(base.protocol==='http:' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('HTTPS required')
  return async (request:Request):Promise<Response>=>{
    const headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
    const reply=(status:number,data:Json)=>new Response(JSON.stringify(data),{status,headers})
    if (request.headers.get('origin') && request.headers.get('origin')!==origin) return reply(403,{ok:false,code:'origin_denied',message:'Origin not allowed.'})
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers})
    if (request.method!=='POST') return reply(405,{ok:false,code:'method_not_allowed',message:'POST required.'})
    const authorization=request.headers.get('authorization') ?? ''
    if (authorization.length>8192 || !/^Bearer [A-Za-z0-9_.-]+$/.test(authorization)) return reply(401,{ok:false,code:'unauthorized',message:'Authentication required.'})
    if (request.headers.get('content-type')?.split(';')[0]!=='application/json') return reply(415,{ok:false,code:'invalid_content_type',message:'JSON required.'})
    let body:Json
    try {
      const reader=request.body?.getReader(),parts:Uint8Array[]=[]; let size=0
      if (!reader) throw new Error('Empty body')
      while (true) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return reply(413,{ok:false,code:'body_too_large',message:'Request too large.'})}parts.push(part.value)}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
      body=JSON.parse(new TextDecoder().decode(bytes))
      if (!body || Array.isArray(body) || typeof body!=='object' || !['unit_id','device_id','request_id'].every(k=>typeof body[k]==='string' && uuid.test(body[k] as string)) || typeof body.question!=='string' || body.question.length>500 || Object.keys(body).some(k=>!['unit_id','device_id','request_id','question'].includes(k))) throw new Error('Invalid request')
    } catch { return reply(400,{ok:false,code:'invalid_request',message:'Unit, device, request identity and question required.'}) }
    try {
      const auth=await fetch(`${base.origin}/auth/v1/user`,{headers:{Authorization:authorization,apikey:config.serviceKey},signal:AbortSignal.timeout(10000)})
      if (!auth.ok) return reply(401,{ok:false,code:'unauthorized',message:'Session invalid or expired.'})
      const user:Json=await auth.json()
      // Auth has validated this exact JWT before its session claim is used.
      const claims:Json=JSON.parse(atob(authorization.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))
      const rpc=async (name:string,data:Json,token=authorization):Promise<Json>=>{
        const response=await fetch(`${base.origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.serviceKey,Authorization:token},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)})
        if(!response.ok)throw new Error('Database unavailable')
        const value:unknown=await response.json()
        if(!value || typeof value!=='object' || Array.isArray(value) || typeof (value as Json).ok!=='boolean')throw new Error('Invalid database response')
        return value as Json
      }
      const context=await rpc('unit_explanation_context',{p_unit_id:body.unit_id,p_device_id:body.device_id})
      if(!context.ok)return reply(context.code==='unauthorized'?401:403,context)
      const evidence=parseExplanationContext(context),rules=explainDeviceEvidence(evidence,body.question as string)
      // The optional AI step words the rule result; any failure keeps the rule explanation, labelled as such.
      const result=config.explainer?withAi(rules,await config.explainer(rules,evidence,body.question as string)):rules
      const saved=await rpc('save_unit_explanation',{p_auth_user_id:user.id,p_session_id:claims.session_id,p_context:context,p_result:result,p_request_id:body.request_id,p_question:body.question},`Bearer ${config.serviceKey}`)
      return reply(saved.ok?200:saved.code==='unauthorized'?401:saved.code==='unit_unavailable'?403:saved.code==='rate_limited'?429:409,saved)
    } catch { return reply(503,{ok:false,code:'service_unavailable',message:'Penjelasan belum dapat disimpan. Bacaan tetap tersedia; coba kembali dengan identitas permintaan yang sama.'}) }
  }
}
