import {createHmac} from 'node:crypto'
// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) and GoTrue MFA helpers shared by the integration and browser tests.
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function totp(secret,at=Date.now()){
 const bits=[...secret.replace(/=+$/,'')].map(c=>B32.indexOf(c).toString(2).padStart(5,'0')).join('')
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(at/30000)))
 const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest(),o=h[19]&15
 return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0')
}
async function call(base,apikey,token,path,body){
 const r=await fetch(base+path,{method:'POST',headers:{apikey,'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
 const data=await r.json().catch(()=>null);if(!r.ok)throw new Error(`${path} ${r.status} ${JSON.stringify(data)}`);return data
}
/** Challenges and verifies a TOTP factor; returns the new AAL2 access token with a fresh `amr` totp timestamp. */
export async function verifyTotp(base,apikey,token,factor,secret){
 const challenge=await call(base,apikey,token,`/auth/v1/factors/${factor}/challenge`,{})
 return (await call(base,apikey,token,`/auth/v1/factors/${factor}/verify`,{challenge_id:challenge.id,code:totp(secret)})).access_token
}
/** Enrolls and verifies TOTP for a signed-in user, as the "Keamanan akun" panel does. */
export async function enableTotp(base,apikey,token){
 const factor=await call(base,apikey,token,'/auth/v1/factors',{factor_type:'totp'})
 return {factor:factor.id,secret:factor.totp.secret,token:await verifyTotp(base,apikey,token,factor.id,factor.totp.secret)}
}
