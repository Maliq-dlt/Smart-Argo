import { timingSafeEqual } from 'node:crypto'
import nodemailer from 'nodemailer'

type Env = (name: string) => string | undefined
const messages = {
  soil_dry: 'Dua bacaan berturut-turut menunjukkan media lebih kering dari acuan pot.',
  battery_low: 'Tegangan baterai perangkat berada di bawah 3,4 V. Peringatan ini tidak diulang sampai baterai sehat (3,6 V atau lebih) selama sehari penuh.',
  device_silent: 'Perangkat belum mengirim paket selama lebih dari 90 menit.',
  soil_hot: 'Suhu tanah berada pada atau di atas 35 derajat Celsius selama sedikitnya tiga jam.',
}

// "23 Nov 14.30 WIB": owners read Jakarta time, not the UTC stamp the database keeps.
export function wib(at: string): string {
  const parts = new Intl.DateTimeFormat('id-ID', {timeZone:'Asia/Jakarta', day:'numeric', month:'short', hour:'2-digit',
    minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date(at))
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('day')} ${part('month').replace('.', '')} ${part('hour')}.${part('minute')} WIB`
}

// The settings page that turns these mails off. Without a valid ALERT_APP_URL the line is left out, never a broken link.
function settingsLink(env: Env): string {
  try {
    const url = new URL(env('ALERT_APP_URL') || '')
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    return url.protocol === 'https:' || (local && url.protocol === 'http:')
      ? `\nAtur atau matikan peringatan:\n${url.origin}/#pengaturan-peringatan` : ''
  } catch { return '' }
}

function mailer(env: Env) {
  const host=env('SMTP_HOST'), from=env('SMTP_FROM'), user=env('SMTP_USER'), pass=env('SMTP_PASSWORD')
  const mode=env('SMTP_MODE') || 'tls', port=Number(env('SMTP_PORT') || (mode==='starttls' ? 2587 : 465))
  const local=mode==='local' && ['localhost','127.0.0.1','::1'].includes(host || '') && !user && !pass
  if (!host || !from || /[\r\n]/.test(from) || !Number.isInteger(port) || port<1 || port>65535 ||
    (!local && mode!=='starttls' && mode!=='tls') || Boolean(user)!==Boolean(pass)) throw Error('Invalid SMTP settings')
  return {from,transport:nodemailer.createTransport({host,port,secure:mode==='tls',requireTLS:mode==='starttls',ignoreTLS:local,
    auth:user && pass ? {user,pass} : undefined, connectionTimeout:6000,greetingTimeout:6000,socketTimeout:12000,
    disableFileAccess:true,disableUrlAccess:true})}
}

export function createAlertDispatchHandler(config: {url:string; serviceKey:string; env:Env}) {
  const rpc=async(name:string,body:Record<string,unknown>={})=>{
    const res=await fetch(config.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{apikey:config.serviceKey,Authorization:'Bearer '+config.serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body)})
    if (!res.ok) throw Error('Database operation failed')
    return res.json()
  }
  return async(request:Request): Promise<Response>=>{
    const reply=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
    if(request.method!=='POST') return reply({ok:false,code:'method_not_allowed'},405)
    const expected=config.env('ALERT_DISPATCH_SECRET'), provided=request.headers.get('authorization') || ''
    if(!expected || expected.length<32) return reply({ok:false,code:'maintenance_unconfigured'},503)
    const key=new TextEncoder().encode('Bearer '+expected),candidate=new TextEncoder().encode(provided)
    if(candidate.length!==key.length || !timingSafeEqual(candidate,key)) return reply({ok:false,code:'forbidden'},403)
    try {
      const purge=await rpc('purge_due_account_deletions')
      if(!purge?.ok) throw Error('Purge failed')
      const pending: {id:string}[]=await rpc('evaluate_alerts')
      let sent=0,failed=0,uncertain=0,processed=0
      const until=Date.now()+40000
      for(const {id} of pending){
        if(Date.now()>=until) break
        processed++
        const claim={p_episode_id:id,p_token:crypto.randomUUID()}
        if(!await rpc('claim_alert_delivery',claim)) continue
        let sending=false
        try {
          const {from,transport}=mailer(config.env)
          const job=await rpc('begin_alert_delivery',claim)
          if(!job){await rpc('finish_alert_delivery',{...claim,p_sent:false});continue}
          sending=true
          await transport.sendMail({from,to:job.email,subject:'Peringatan perangkat Smart Agro',messageId:'<'+id+'@alerts.smart-agro>',
            text:'Pot: '+job.unit_name+'\n'+messages[job.kind as keyof typeof messages]+'\nMulai: '+wib(job.opened_at)+
              '\nLihat perangkat di aplikasi Smart Agro.'+settingsLink(config.env)})
        } catch(error) {
          const smtp=error as {responseCode?:number; command?:string; code?:string; syscall?:string; timeoutType?:string}
          // Nodemailer also reports a socket reset after DATA as CONN. Retry only a known rejection or setup failure.
          const rejected=Number(smtp.responseCode)>=400 || smtp.syscall==='connect' ||
            ['EAUTH','EDNS','ETLS','EENVELOPE','EREQUIRETLS'].includes(smtp.code || '') ||
            ['CONNECT_TIMEOUT','GREETING_TIMEOUT'].includes(smtp.timeoutType || '')
          if(sending && !rejected){
            uncertain++;continue  // No automatic replay after an ambiguous SMTP acceptance.
          }
          await rpc('finish_alert_delivery',{...claim,p_sent:false});failed++;continue
        }
        if(!await rpc('finish_alert_delivery',{...claim,p_sent:true})) throw Error('Delivery acknowledgment failed')
        sent++
      }
      const ok=failed===0 && uncertain===0
      return reply({ok,...(!ok && {code:'delivery_incomplete'}),purged:purge.purged,sent,failed,uncertain,deferred:pending.length-processed},ok?200:503)
    } catch {return reply({ok:false,code:'maintenance_unavailable'},503)}
  }
}
