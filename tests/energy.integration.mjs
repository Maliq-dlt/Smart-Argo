import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign,randomBytes,randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
// Real local Auth, signature verification and SQL transactions; all meter hardware/evidence is synthetic.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body),run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,operator=false){const r=await api('/auth/v1/signup',null,{email:`energy-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);if(operator)sql(`UPDATE account SET access_roles=ARRAY['owner','operator'] WHERE id=${q(a.data.account.id)}`);return {token:r.data.access_token,id:a.data.account.id}}
const keypair=()=>{const keys=generateKeyPairSync('ed25519');return {keys,publicKey:Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')}}
async function fixture(owner,op){const id=randomUUID(),device=randomUUID(),k=keypair();sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q('EN-'+run+'-'+id.slice(0,6))},'single_pot','synthetic protocol fixture only'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(id)},${q(keypair().publicKey)}); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(id)},${q(owner.id)},clock_timestamp()-interval '6 days');`);const r=await rpc('operator_register_energy_meter',op.token,{p_device_id:device,p_public_key:k.publicKey,p_calibration_ref:'local://synthetic-software-meter-NOT-physical-calibration',p_eligible_load_ref:'local://test-useful-load-only',p_valid_from:new Date(Date.now()-6*86400000).toISOString(),p_valid_until:new Date(Date.now()+86400000).toISOString(),p_max_power_w:100});assert.equal(r.data.ok,true,JSON.stringify(r));return {id,device,meter:r.data.meter_id,...k}}
const end=Math.floor(Date.now()/900000)*900000
function packet(p,index,overrides={}){return {domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:p.meter,device_id:p.device,boot_id:randomUUID(),sequence:0,start_at:new Date(end-(index+1)*900000).toISOString(),end_at:new Date(end-index*900000).toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:20,load_start_wh:0,load_end_wh:15,battery_soc_pct:null,...overrides}}
const envelope=(p,v)=>{const payload=JSON.stringify(v);return {payload,signature:sign(null,Buffer.from(payload),p.keys.privateKey).toString('base64')}}
const send=(p,v)=>api('/functions/v1/energy-ingest',null,envelope(p,v))
const count=(table,where)=>Number(sql(`SELECT count(*) FROM ${table} WHERE ${where}`))
await test('Phase 4: signed energy evidence and atomic reward credit',async t=>{
 const owner=await account('owner'),other=await account('other'),op=await account('operator',true),p=await fixture(owner,op)
 const oldPolicy=sql("SELECT coalesce(active_policy_id::text,'') FROM reward_program WHERE singleton")
 try{
 await rpc('operator_set_reward_policy',op.token,{p_version:null,p_wh_per_point:null,p_daily_cap:null,p_enabled:false})
 let noPolicy,credited
 await t.test('operator-only immutable meter provisioning; policy disabled preserves evidence without credit',async()=>{
  assert.equal((await rpc('operator_register_energy_meter',owner.token,{p_device_id:p.device,p_public_key:p.publicKey,p_calibration_ref:'x',p_eligible_load_ref:'x',p_valid_from:new Date().toISOString(),p_valid_until:new Date(Date.now()+86400000).toISOString(),p_max_power_w:1})).data.code,'forbidden')
  noPolicy=packet(p,20);const r=await send(p,noPolicy);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.credited,0);assert.equal(r.data.reward.reason,'policy_disabled')
  assert.equal(count('energy_window',`id=${q(r.data.window_id)}`),1)
 })
 await t.test('server policy uses min(harvest,load), canonical decimal counters, daily cap and no retroactive credit',async()=>{
  assert.equal((await rpc('operator_set_reward_policy',op.token,{p_version:'energy-test-'+run,p_wh_per_point:0.1,p_daily_cap:35,p_enabled:true})).data.ok,true)
  const retry=await send(p,noPolicy);assert.equal(retry.data.duplicate,true);assert.equal(retry.data.credited,0)
  credited=packet(p,19,{solar_start_wh:0.1,solar_end_wh:2.1,load_start_wh:0.1,load_end_wh:1.6})
  const first=await send(p,credited);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.credited,15)
  const second=await send(p,packet(p,18));assert.equal(second.data.credited,20)
  const cap=await send(p,packet(p,17));assert.equal(cap.data.credited,0);assert.equal(cap.data.reward.reason,'daily_cap')
  const w=(await rpc('reward_workspace',owner.token)).data;assert.equal(w.balance.confirmed_points,35)
 })
 await t.test('parallel exact retries credit once; overlap across reboot and changed bytes fail',async()=>{
  const results=await Promise.all(Array.from({length:6},()=>send(p,credited)));for(const r of results){assert.equal(r.status,200);assert.equal(r.data.duplicate,true);assert.equal(r.data.credited,0)}
  assert.equal(count('reward_event',`account_id=${q(owner.id)}`),2)
  assert.equal((await send(p,{...credited,load_end_wh:1.7})).status,409)
  const overlap=await send(p,{...credited,boot_id:randomUUID()});assert.equal(overlap.status,409);assert.equal(overlap.data.code,'window_overlap')
 })
 await t.test('counter rollback, excessive power, incomplete periods and forged trust leave no evidence',async()=>{
  const boot=randomUUID(),v=packet(p,15,{boot_id:boot,sequence:10,solar_start_wh:40,solar_end_wh:41,load_start_wh:40,load_end_wh:41});assert.equal((await send(p,v)).status,200)
  assert.equal((await send(p,packet(p,14,{boot_id:boot,sequence:9,solar_start_wh:41,solar_end_wh:42,load_start_wh:41,load_end_wh:42}))).data.code,'counter_out_of_order')
  assert.equal((await send(p,packet(p,14,{boot_id:boot,sequence:11}))).data.code,'counter_out_of_order')
  const before=count('energy_window',`device_id=${q(p.device)}`)
  for(const changes of [{solar_end_wh:25.01},{load_end_wh:26},{start_at:new Date(end).toISOString(),end_at:new Date(end+900000).toISOString()},{source:'simulation'},{quality:'verified_meter'},{battery_soc_pct:101},{solar_end_wh:-1}])assert.ok((await send(p,packet(p,13,changes))).status>=400)
  const env=envelope(p,packet(p,13));env.payload=JSON.stringify({...JSON.parse(env.payload),solar_end_wh:21});assert.equal((await api('/functions/v1/energy-ingest',null,env)).status,403)
  assert.equal((await api('/functions/v1/energy-ingest',null,{...envelope(p,packet(p,13)),signature:Buffer.alloc(64).toString('base64')})).status,403)
  assert.equal(count('energy_window',`device_id=${q(p.device)}`),before)
 })
 await t.test('injected ledger failure rolls back evidence, reward event and processing result; same packet can retry',async()=>{
  const fresh=await account('rollback'),f=await fixture(fresh,op),v=packet(f,2)
  sql(`CREATE FUNCTION phase4_fail_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id=${q(fresh.id)}::uuid THEN RAISE EXCEPTION 'synthetic credit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase4_fail_credit BEFORE INSERT ON ledger_entry FOR EACH ROW EXECUTE FUNCTION phase4_fail_credit();`)
  try{assert.equal((await send(f,v)).status,503);assert.equal(count('energy_window',`device_id=${q(f.device)}`),0);assert.equal(count('reward_event',`account_id=${q(fresh.id)}`),0);assert.equal(count('energy_reward_result',`account_id=${q(fresh.id)}`),0)}finally{sql('DROP TRIGGER phase4_fail_credit ON ledger_entry;DROP FUNCTION phase4_fail_credit();')}
  assert.equal((await send(f,v)).data.credited,35)
 })
 await t.test('parallel first arrivals across two devices respect one account cap and deduplicate at ingestion',async()=>{
  const shared=await account('multi-device'),a=await fixture(shared,op),b=await fixture(shared,op),av=packet(a,4),bv=packet(b,4)
  const arrivals=await Promise.all([send(a,av),send(b,bv),send(a,av),send(b,bv)])
  assert.ok(arrivals.every(r=>r.status===200));assert.equal(arrivals.filter(r=>r.data.duplicate===false).length,2)
  assert.equal(arrivals.reduce((sum,r)=>sum+r.data.credited,0),35)
  assert.equal(count('reward_event',`account_id=${q(shared.id)}`),1)
  assert.equal((await rpc('reward_workspace',shared.token)).data.balance.confirmed_points,35)
 })
 await t.test('RLS, direct privileged calls, raw proof access and owner writes denied',async()=>{
  assert.equal((await api('/rest/v1/energy_window?select=payload,signature',owner.token,undefined,'GET')).status,403)
  assert.equal((await api('/rest/v1/energy_meter',owner.token,undefined,'GET')).status,403)
  assert.equal((await api('/rest/v1/energy_reward_result',owner.token,undefined,'GET')).status,403)
  assert.equal((await rpc('credit_energy_reward',owner.token,{p_window_id:randomUUID(),p_account_id:owner.id})).status,403)
  assert.equal((await rpc('ingest_verified_energy',owner.token,{p_payload:JSON.stringify(credited),p_public_key:p.publicKey,p_signature:envelope(p,credited).signature})).status,403)
  assert.equal((await api('/rest/v1/energy_window',owner.token,{})).status,403)
  assert.deepEqual((await api('/rest/v1/reward_event?account_id=eq.'+owner.id,other.token,undefined,'GET')).data,[])
  assert.equal((await rpc('energy_workspace',other.token)).data.windows.length,0)
 })
 await t.test('ownership transfer keeps prior evidence private and denies pre-transfer credit',async()=>{
  sql(`UPDATE ownership SET end_at=clock_timestamp() WHERE product_id=${q(p.id)} AND end_at IS NULL;INSERT INTO ownership(product_id,account_id) VALUES(${q(p.id)},${q(other.id)});`)
  assert.equal((await rpc('energy_workspace',other.token)).data.windows.length,0)
  assert.ok((await rpc('energy_workspace',owner.token)).data.windows.length>0)
  assert.equal((await send(p,packet(p,1))).data.code,'window_unavailable')
  assert.equal((await send(p,credited)).data.duplicate,true)
 })
 await t.test('revocation/replacement cannot reuse device periods; expired evidence and revoked product rejected',async()=>{
  const a=await account('replacement'),f=await fixture(a,op),v=packet(f,3);assert.equal((await send(f,v)).status,200)
  assert.equal((await rpc('operator_revoke_energy_meter',op.token,{p_meter_id:f.meter,p_reason:'Synthetic replacement test'})).data.ok,true)
  assert.equal((await send(f,v)).status,403)
  const k=keypair(),r=await rpc('operator_register_energy_meter',op.token,{p_device_id:f.device,p_public_key:k.publicKey,p_calibration_ref:'local://synthetic-new-key',p_eligible_load_ref:'local://test-only',p_valid_from:new Date(end-86400000).toISOString(),p_valid_until:new Date(Date.now()+86400000).toISOString(),p_max_power_w:100}),newMeter={...f,...k,meter:r.data.meter_id}
  assert.equal(r.data.ok,true)
  assert.equal((await send(newMeter,{...v,meter_id:newMeter.meter,boot_id:randomUUID()})).data.code,'window_overlap')
  assert.equal((await send(newMeter,packet(newMeter,110))).data.code,'window_unavailable')
  sql(`UPDATE product SET registry_status='revoked' WHERE id=${q(f.id)}`);assert.equal((await send(newMeter,packet(newMeter,2))).status,403)
 })
 await t.test('revoked Auth session cannot load balances or meter history',async()=>{
  assert.equal((await api('/auth/v1/logout?scope=local',owner.token,{})).status,204)
  assert.equal((await rpc('energy_workspace',owner.token)).data.ok,false)
  assert.equal((await rpc('reward_workspace',owner.token)).data.ok,false)
 })
 }finally{sql(`UPDATE reward_program SET active_policy_id=${oldPolicy?q(oldPolicy):'NULL'} WHERE singleton`)}
})
