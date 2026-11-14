import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHmac} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {enableTotp} from './totp.mjs'
// APP-01 lost-authenticator recovery against the local gateway, Auth, PostgREST and PostgreSQL: codes need a fresh
// second factor, are shown once, spend once, are rate limited, and recovery removes the factor, signs out other
// sessions and starts the 24-hour hold.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label){const email=`mfa-${run}-${label}@example.test`,r=await api('/auth/v1/signup',null,{email,password});assert.equal(r.status,200);assert.equal((await rpc('ensure_my_account',r.data.access_token)).data.ok,true);return{email,token:r.data.access_token,user:r.data.user.id}}
const signIn=async a=>(await api('/auth/v1/token?grant_type=password',null,{email:a.email,password})).data.access_token
const recover=(token,code)=>api('/functions/v1/mfa-recovery',token,{code})
function forge(token,patch){const [head,body]=token.split('.');const data=head+'.'+Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url')),...patch})).toString('base64url');return data+'.'+createHmac('sha256',config.secret).update(data).digest('base64url')}

await test('APP-01: recovery codes for a lost authenticator',async t=>{
 const alice=await account('alice'),bob=await account('bob'),eve=await account('eve')
 let codes
 await t.test('codes need an enrolled authenticator and a fresh code, and are shown once',async()=>{
  assert.equal((await rpc('create_my_recovery_codes',bob.token)).data.code,'mfa_required')
  alice.token=(await enableTotp(base,config.anon,alice.token)).token
  const stale=forge(alice.token,{amr:JSON.parse(Buffer.from(alice.token.split('.')[1],'base64url')).amr.map(m=>m.method==='totp'?{...m,timestamp:m.timestamp-600}:m)})
  assert.equal((await rpc('create_my_recovery_codes',stale)).data.code,'step_up_required')
  codes=(await rpc('create_my_recovery_codes',alice.token)).data.codes
  assert.equal(codes.length,10);for(const c of codes)assert.match(c,/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
  assert.equal(new Set(codes).size,10)
  assert.equal(sql(`SELECT count(*) FROM mfa_recovery_code WHERE user_id=${q(alice.user)} AND code_hash IN (${codes.map(c=>q(c)).join(',')})`),'0','only hashes are stored')
  assert.deepEqual({...(await rpc('my_recovery_codes_status',alice.token)).data,created_at:undefined},{ok:true,total:10,remaining:10,created_at:undefined})
  assert.notEqual((await api('/rest/v1/mfa_recovery_code?select=user_id',alice.token,undefined,'GET')).status,200)
  assert.equal((await rpc('consume_recovery_code',alice.token,{p_user_id:alice.user,p_code:codes[0]})).status>=400,true,'service role only')
 })
 await t.test('a password-only session cannot reach data until a code is spent',async()=>{
  const pending=await signIn(alice)
  assert.equal(JSON.parse(Buffer.from(pending.split('.')[1],'base64url')).aal,'aal1')
  assert.equal((await rpc('my_products',pending)).data.ok,false)
  const wrong=await recover(pending,'0000-0000-0000');assert.equal(wrong.status,400);assert.equal(wrong.data.code,'invalid_code')
  const done=await recover(pending,codes[0].toLowerCase().replaceAll('-',' '))
  assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.removed,1)
  assert.equal(sql(`SELECT count(*) FROM auth.mfa_factors WHERE user_id=${q(alice.user)}`),'0')
  assert.equal((await rpc('my_products',pending)).data.ok,true,'the same session now works')
  assert.equal((await rpc('my_products',alice.token)).data.ok,false,'the other session was signed out')
  assert.ok((await rpc('security_workspace',pending)).data.hold_until,'24-hour hold started')
  assert.equal(sql(`SELECT count(*) FROM security_event WHERE user_id=${q(alice.user)} AND kind='mfa_recovered'`),'1')
  const retry=await recover(pending,codes[0]);assert.equal(retry.status,200);assert.equal(retry.data.removed,0)
  assert.equal(sql(`SELECT count(*) FILTER (WHERE used_at IS NULL) FROM mfa_recovery_code WHERE user_id=${q(alice.user)}`),'9')
 })
 await t.test('failures are rate limited per account',async()=>{
  eve.token=(await enableTotp(base,config.anon,eve.token)).token
  const fresh=(await rpc('create_my_recovery_codes',eve.token)).data.codes
  const pending=await signIn(eve)
  for(let i=0;i<5;i++)assert.equal((await recover(pending,'ABCD-ABCD-ABC'+i)).data.code,'invalid_code')
  const limited=await recover(pending,fresh[0]);assert.equal(limited.status,429);assert.equal(limited.data.code,'rate_limited')
  assert.equal(sql(`SELECT count(*) FROM auth.mfa_factors WHERE user_id=${q(eve.user)} AND status='verified'`),'1')
 })
})
