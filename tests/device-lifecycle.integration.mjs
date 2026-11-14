// Local Auth/PostgREST and genuine Ed25519 protocol tests; no physical device or calibration claim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { enableTotp } from './totp.mjs'
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});return {status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
async function hold(statement){
 const child=spawn('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{stdio:['pipe','pipe','pipe']});child.stderr.resume()
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Lock fixture failed')))});void done.catch(()=>{})
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Lock readiness timed out'))},15000)
  let output='';child.stdout.on('data',part=>{output+=part;if(output.includes('LOCK_READY')){clearTimeout(timeout);resolve()}})
  child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('close',()=>{clearTimeout(timeout);reject(new Error('Lock fixture closed before readiness'))})
  child.stdin.write(`BEGIN; ${statement}; SELECT 'LOCK_READY';\n`)
 })
 return async(finish='ROLLBACK;')=>{child.stdin.end(finish+'\n');await done}
}
async function waitBlocked(name){
 const deadline=Date.now()+15000
 while(Date.now()<deadline){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE ${q('%'+name+'%')})`)==='t')return;await new Promise(resolve=>setImmediate(resolve))}
 throw new Error('Lifecycle request did not reach the controlled lock')
}
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
const keypair=()=>{const keys=generateKeyPairSync('ed25519');return {keys,raw:Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')}}
async function account(label,operator=false){const r=await api('/auth/v1/signup',null,{email:`lifecycle-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);if(operator)sql(`UPDATE account SET access_roles=ARRAY['owner','operator'] WHERE id=${q(a.data.account.id)}`);return {token:r.data.access_token,id:a.data.account.id,user:r.data.user.id}}
await test('Device lifecycle: atomic maintenance, immutable evidence and retired-key rejection',async t=>{
 const owner=await account('owner'),other=await account('other'),op=await account('operator',true),weak=await account('weak',true)
 const oldOp=op.token;op.token=(await enableTotp(base,config.anon,op.token)).token
 const plant=randomUUID(),contribution=randomUUID(),version=randomUUID()
 sql(`INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(plant)},${q('Lifecycle '+run)},'Synthetic test'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(plant)},${q(owner.id)},'Synthetic permission','Software fixture','{}','approved'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(plant)},${q(contribution)},1,'{}','Synthetic test');`)
 function fixture(label,owned=true){const p={product:randomUUID(),device:randomUUID(),unit:randomUUID(),serial:('LIFE-'+run+'-'+label).toUpperCase(),code:randomBytes(24).toString('base64url'),key:keypair(),boot:randomUUID()};sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(p.product)},${q(p.serial)},'single_pot','Synthetic operator fixture'); INSERT INTO device(id,product_id,public_key) VALUES(${q(p.device)},${q(p.product)},${q(p.key.raw)}); INSERT INTO activation(product_id,secret_hash) VALUES(${q(p.product)},encode(digest(${q(p.code)},'sha256'),'hex')); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(p.unit)},${q(p.product)},${q(version)},'Lifecycle fixture'); ${owned?`INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(p.product)},${q(owner.id)},clock_timestamp()-interval '1 day');`:''}`);return p}
 const f=fixture('main'),unclaimed=fixture('claim',false),second=fixture('second'),b=keypair(),c=keypair(),d=keypair()
 const rotateBody=(p,from,to,overrides={})=>({p_device_id:p.device,p_expected_public_key:from.raw,p_new_public_key:to.raw,p_request_id:randomUUID(),p_reason:'Synthetic key maintenance',...overrides})
 const rotate=(body,token=op.token)=>rpc('operator_rotate_device_key',token,body)
 const revokeDevice=(p,patch={},token=op.token)=>rpc('operator_revoke_device',token,{p_device_id:p.device,p_request_id:randomUUID(),p_reason:'Synthetic compromised device',...patch})
 const revokeProduct=(p,patch={},token=op.token)=>rpc('operator_revoke_product',token,{p_product_id:p.product,p_request_id:randomUUID(),p_reason:'Synthetic registry withdrawal',...patch})
 const history=(p=f,patch={},token=op.token)=>rpc('operator_registry_history',token,{p_product_id:p.product,...patch})
 const telemetry=(p,sequence,key=p.key)=>{const payload=JSON.stringify({domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',device_id:p.device,unit_id:p.unit,boot_id:p.boot,sequence,measured_at:new Date().toISOString(),clock_status:'synced',sensors:{moisture:{status:'ok',value:25},soil_temperature:{status:'ok',value:28},soil_ph:{status:'not_measured',value:null}}});return {payload,signature:sign(null,Buffer.from(payload),key.keys.privateKey).toString('base64')}}
 const send=envelope=>api('/functions/v1/telemetry-ingest',null,envelope)
 const packetA=telemetry(f,1);assert.equal((await send(packetA)).status,200)
 let rotation,rotationResult,current=b,meter,meterKey=keypair()
 await t.test('operator MFA, role, private table and bounded input gates',async()=>{
  const body=rotateBody(f,f.key,b)
  assert((await rotate(body,null)).status>=400)
  assert.equal((await rotate(body,owner.token)).data.code,'forbidden');assert.equal((await rotate(body,weak.token)).data.code,'mfa_required');assert.equal((await rotate(body,oldOp)).data.code,'unauthorized')
  for(const table of ['registry_event','device_key_history'])assert((await api('/rest/v1/'+table+'?select=*',owner.token,undefined,'GET')).status>=400)
  assert.equal((await history(f,{},weak.token)).data.code,'forbidden')
  for(const patch of [{p_reason:' '},{p_reason:'x'.repeat(1001)},{p_request_id:null}])assert.equal((await rotate({...body,...patch})).data.code,'invalid_request')
  for(const value of ['bad',Buffer.alloc(31).toString('base64'),b.raw+'\n'])assert.equal((await rotate({...body,p_new_public_key:value})).data.code,'invalid_key')
  assert.equal((await rotate(rotateBody(f,f.key,f.key))).data.code,'key_unavailable')
  assert.equal((await rotate(rotateBody(f,f.key,second.key))).data.code,'key_unavailable')
 })
 await t.test('rotation has durable idempotency, CAS and a globally retired key history',async()=>{
  rotation=rotateBody(f,f.key,b);const results=await Promise.all([rotate(rotation),rotate(rotation)]);assert(results.every(r=>r.data.ok));rotationResult=results[0].data
  assert.equal(sql(`SELECT public_key FROM device WHERE id=${q(f.device)}`),b.raw)
  assert.equal(sql(`SELECT count(*) FROM registry_event WHERE product_id=${q(f.product)}`),'1')
  assert.equal((await rotate({...rotation,p_reason:'Changed retry'})).data.code,'request_conflict')
  assert.equal((await rotate(rotateBody(f,f.key,c))).data.code,'key_conflict')
  assert.equal((await rotate(rotateBody(f,b,f.key))).data.code,'key_unavailable')
  assert.equal((await rotate(rotateBody(second,second.key,f.key))).data.code,'key_unavailable')
  const races=await Promise.all([rotate(rotateBody(f,b,c)),rotate(rotateBody(f,b,d))]);assert.equal(races.filter(r=>r.data.ok).length,1);assert.equal(races.filter(r=>r.data.code==='key_conflict').length,1)
  current=sql(`SELECT public_key FROM device WHERE id=${q(f.device)}`)===c.raw?c:d
  const retry=await rotate(rotation);assert.equal(retry.data.ok,true);assert.deepEqual(retry.data,rotationResult)
  assert.equal(sql(`SELECT public_key FROM device WHERE id=${q(f.device)}`),current.raw)
  assert.equal((await revokeProduct(f,{p_request_id:rotation.p_request_id})).data.code,'request_conflict')
  assert.equal(sql(`SELECT count(*) FROM device_key_history WHERE device_id=${q(f.device)}`),'3')
  assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id=${q(f.product)}`),'1')
 })
 await t.test('current signatures succeed while old signatures and preverified old-key finalization fail',async()=>{
  assert.equal((await send(packetA)).status,403)
  const old=telemetry(f,2,f.key);assert.equal((await send(old)).status,403)
  const trusted=await rpc('ingest_verified_telemetry',config.service,{p_payload:old.payload,p_public_key:f.key.raw,p_signature:old.signature});assert.equal(trusted.data.code,'device_unavailable')
  assert.equal((await send(telemetry(f,2,current))).status,200)
  assert.equal(sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(f.unit)}`),'6')
  const r=await rpc('operator_register_energy_meter',op.token,{p_device_id:f.device,p_public_key:meterKey.raw,p_calibration_ref:'Synthetic software calibration only',p_eligible_load_ref:'Synthetic software load only',p_valid_from:new Date(Date.now()-86400000).toISOString(),p_valid_until:new Date(Date.now()+86400000).toISOString(),p_max_power_w:100});assert.equal(r.data.ok,true);meter=r.data.meter_id
  assert.equal(sql(`SELECT public_key FROM energy_meter WHERE id=${q(meter)}`),meterKey.raw)
 })
 await t.test('activation checks the current key even for a challenge issued before rotation',async()=>{
  const n=(await rpc('issue_activation_nonce',owner.token,{p_serial:unclaimed.serial})).data;assert.equal(n.ok,true)
  const next=keypair();assert.equal((await rotate(rotateBody(unclaimed,unclaimed.key,next))).data.ok,true)
  const body={nonce_id:n.nonce_id,sealed_code:unclaimed.code,signature:sign(null,Buffer.from(n.challenge),unclaimed.key.keys.privateKey).toString('base64')}
  assert.equal((await api('/functions/v1/product-claim',owner.token,body)).status,403)
  const claims=JSON.parse(Buffer.from(owner.token.split('.')[1],'base64url'))
  assert.equal((await rpc('claim_verified_product',config.service,{p_nonce_id:n.nonce_id,p_auth_user_id:owner.user,p_session_id:claims.session_id,p_public_key:unclaimed.key.raw,p_sealed_code:unclaimed.code,p_aal:'aal1'})).data.code,'product_unavailable')
  assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id=${q(unclaimed.product)}`),'0')
  body.signature=sign(null,Buffer.from(n.challenge),next.keys.privateKey).toString('base64')
  assert.equal((await api('/functions/v1/product-claim',owner.token,body)).status,200)
 })
 await t.test('ownership transfer retains evidence but hides the previous epoch from its recipient',async()=>{
  const offer=(await rpc('create_transfer_offer',owner.token,{p_product_id:f.product})).data;assert.equal(offer.ok,true)
  assert.equal((await rpc('accept_transfer',other.token,{p_serial:f.serial,p_code:offer.code})).data.ok,true)
  const range={p_unit_id:f.unit,p_from:new Date(Date.now()-86400000).toISOString(),p_to:new Date(Date.now()+60000).toISOString()}
  assert.equal((await rpc('read_my_measurement_history',owner.token,range)).data.code,'unit_unavailable')
  assert.deepEqual((await rpc('read_my_measurement_history',other.token,range)).data.readings,[])
  assert.equal(sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(f.unit)}`),'6')
 })
 await t.test('device and product revocation stop signed ingestion without deleting histories',async()=>{
  const req={p_request_id:randomUUID()},revoked=await revokeDevice(f,req);assert.equal(revoked.data.ok,true)
  assert.deepEqual((await revokeDevice(f,req)).data,revoked.data)
  assert.equal((await send(telemetry(f,3,current))).status,403)
  assert.equal((await rotate(rotateBody(f,current,keypair()))).data.code,'device_unavailable')
  assert.equal((await rotate(rotation)).data.ok,true,'Successful prior request remains a retry, never a reactivation')
  assert.equal(sql(`SELECT status FROM device WHERE id=${q(f.device)}`),'revoked')
  const end=Math.floor(Date.now()/900000)*900000,payload=JSON.stringify({domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:meter,device_id:f.device,boot_id:randomUUID(),sequence:0,start_at:new Date(end-900000).toISOString(),end_at:new Date(end).toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:1,load_start_wh:0,load_end_wh:1,battery_soc_pct:null})
  assert.equal((await api('/functions/v1/energy-ingest',null,{payload,signature:sign(null,Buffer.from(payload),meterKey.keys.privateKey).toString('base64')})).status,403)
  assert.equal(sql(`SELECT status FROM energy_meter WHERE id=${q(meter)}`),'active','Dedicated meter lifecycle is not silently rewritten')
  const productReq={p_request_id:randomUUID()},result=await revokeProduct(second,productReq);assert.equal(result.data.ok,true)
  assert.deepEqual((await revokeProduct(second,productReq)).data,result.data)
  assert.equal((await send(telemetry(second,1))).status,403)
  const status=await api('/rest/v1/rpc/product_public_status',null,{p_serial:second.serial});assert.equal(status.data.registry_status,'revoked');assert.equal(JSON.stringify(status.data).includes(owner.id),false)
  assert.equal((await rotate(rotateBody(second,second.key,keypair()))).data.code,'product_unavailable')
  assert.equal(sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(f.unit)}`),'6')
 })
 await t.test('audit insert failure rolls back key, tombstone and result before a safe retry',async()=>{
  const target=fixture('rollback'),next=keypair(),body=rotateBody(target,target.key,next),name='lifecycle_audit_fail_'+run
  sql(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.device_id=${q(target.device)}::uuid THEN RAISE EXCEPTION USING ERRCODE='XX000',MESSAGE='Synthetic audit insertion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${name} BEFORE INSERT ON registry_event FOR EACH ROW EXECUTE FUNCTION ${name}();`)
  try{
   assert.equal((await rotate(body)).status,500)
   assert.equal(sql(`SELECT public_key FROM device WHERE id=${q(target.device)}`),target.key.raw)
   assert.equal(sql(`SELECT count(*) FROM device_key_history WHERE public_key=${q(next.raw)}`),'0')
   assert.equal(sql(`SELECT count(*) FROM registry_event WHERE product_id=${q(target.product)}`),'0')
  }finally{sql(`DROP TRIGGER ${name} ON registry_event; DROP FUNCTION ${name}();`)}
  assert.equal((await rotate(body)).data.ok,true)
  const forged=randomUUID()
  assert.throws(()=>sql(`INSERT INTO device(id,product_id,public_key) VALUES(${q(forged)},${q(target.product)},${q(f.key.raw)})`),/duplicate|unique/i)
  assert.equal(sql(`SELECT count(*) FROM device WHERE id=${q(forged)}`),'0')
 })
 await t.test('nonce FK checks do not deadlock with maintenance waiting on the issuer account',async()=>{
  const target=fixture('fk-cycle',false),next=keypair()
  const release=await hold(`SELECT 1 FROM account WHERE id=${q(op.id)} FOR UPDATE`)
  const pending=rotate(rotateBody(target,target.key,next))
  try{
   await waitBlocked('operator_rotate_device_key')
   const claims=JSON.parse(Buffer.from(op.token.split('.')[1],'base64url'))
   await release(`INSERT INTO activation_nonce(account_id,auth_user_id,session_id,product_id,device_id,challenge,expires_at) VALUES(${q(op.id)},${q(op.user)},${q(claims.session_id)},${q(target.product)},${q(target.device)},${q('Synthetic nonce FK '+randomUUID())},clock_timestamp()+interval '5 minutes'); COMMIT;`)
  }catch(error){await release().catch(()=>{});throw error}
  assert.equal((await pending).data.ok,true)
 })
 await t.test('role and session revocation committed during a product wait prevent maintenance',async()=>{
  const actor=await account('waiting-operator',true);actor.token=(await enableTotp(base,config.anon,actor.token)).token
  const target=fixture('wait'),next=keypair()
  let release=await hold(`SELECT 1 FROM product WHERE id=${q(target.product)} FOR UPDATE`),pending=rotate(rotateBody(target,target.key,next),actor.token)
  try{await waitBlocked('operator_rotate_device_key');sql(`UPDATE account SET access_roles=ARRAY['owner'] WHERE id=${q(actor.id)}`)}finally{await release()}
  assert.equal((await pending).data.code,'forbidden');assert.equal(sql(`SELECT public_key FROM device WHERE id=${q(target.device)}`),target.key.raw)
  sql(`UPDATE account SET access_roles=ARRAY['owner','operator'] WHERE id=${q(actor.id)}`)
  release=await hold(`SELECT 1 FROM product WHERE id=${q(target.product)} FOR UPDATE`);pending=revokeDevice(target,{},actor.token)
  try{await waitBlocked('operator_revoke_device');const claims=JSON.parse(Buffer.from(actor.token.split('.')[1],'base64url'));sql(`DELETE FROM auth.sessions WHERE id=${q(claims.session_id)}`)}finally{await release()}
  assert.equal((await pending).data.code,'unauthorized');assert.equal(sql(`SELECT status FROM device WHERE id=${q(target.device)}`),'active')
  assert.equal(sql(`SELECT count(*) FROM registry_event WHERE product_id=${q(target.product)}`),'0')
 })
 await t.test('operator audit is immutable and key history cannot be rewritten',async()=>{
  const h=await history(f,{p_limit:1});assert.equal(h.data.ok,true);assert.equal(h.data.events.length,1);assert(h.data.next_cursor!==null)
  const next=await history(f,{p_limit:50,p_before_id:h.data.next_cursor});assert.equal(next.data.ok,true);assert(next.data.events.every(e=>BigInt(e.id)<BigInt(h.data.events[0].id)))
  assert.equal(new Set([...h.data.events,...next.data.events].map(e=>e.id)).size,3)
  assert(h.data.events.every(e=>typeof e.reason==='string'&&!Object.keys(e).some(k=>['old_public_key','new_public_key','actor_account_id','request_id'].includes(k))))
  for(const table of ['registry_event','device_key_history'])assert.throws(()=>sql(`DELETE FROM ${table} WHERE device_id=${q(f.device)}`),/immutable/i)
  assert.equal((await history(f,{p_limit:0})).data.code,'invalid_request');assert.equal((await history(f,{p_limit:101})).data.code,'invalid_request')
  assert.equal((await history(f,{},owner.token)).data.code,'forbidden')
 })
})
