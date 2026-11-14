// Local-only privileged access regression. Role assignments and JWT re-signing below are trusted test fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { enableTotp } from './totp.mjs'
const base='http://127.0.0.1:54321', config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const args=['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres']
const sql=input=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){
 const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 return {status:r.status,data:await r.json().catch(()=>null)}
}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'))
async function account(label,roles){
 const r=await api('/auth/v1/signup',null,{email:`privileged-${run}-${label}@example.test`,password});assert.equal(r.status,200)
 const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true)
 sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`)
 return {token:r.data.access_token,id:a.data.account.id,user:r.data.user.id}
}
function withAmr(token,amr){
 const [head,body]=token.split('.');assert.equal(JSON.parse(Buffer.from(head,'base64url')).alg,'HS256')
 const c=JSON.parse(Buffer.from(body,'base64url'));c.amr=amr
 const data=head+'.'+Buffer.from(JSON.stringify(c)).toString('base64url')
 return data+'.'+createHmac('sha256',config.secret).update(data).digest('base64url')
}
const stale=token=>withAmr(token,claims(token).amr.map(m=>m.method==='totp'?{...m,timestamp:Math.floor(Date.now()/1000)-601}:m))
function meterFixture(owner,operator){
 const product=randomUUID(),device=randomUUID(),meter=randomUUID()
 sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('PRIV-'+product)},'single_pot','Synthetic software fixture'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(randomBytes(32).toString('base64'))}); INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(owner.id)}); INSERT INTO energy_meter(id,device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by) VALUES(${q(meter)},${q(device)},${q(randomBytes(32).toString('base64'))},'Synthetic calibration only','Synthetic load only',now()-interval '1 day',now()+interval '1 day',100,${q(operator.id)});`)
 return {product,device,meter}
}
const parameters={pot_id:'synthetic-privileged-test',crop:'Synthetic crop',media:'Test',phase:'Test',validated:false,ph_validated:false,needs_water:[30,35,40],drained:[70,75,80],next_visit_h:6,hot_c:35,ph_range:[5.5,7]}
const submit=token=>rpc('submit_profile_contribution',token,{p_profile_id:null,p_species:'Privileged fixture '+randomUUID(),p_scope:'Synthetic software only',p_source_license:'Synthetic permitted fixture',p_evidence_ref:'tests/privileged-access.integration.mjs',p_parameters:parameters,p_permission:true})
const review=(token,id)=>rpc('review_profile_contribution',token,{p_id:id,p_revision:1,p_decision:'approved',p_reason:'Synthetic protocol test',p_evidence_level:'Synthetic software only'})
async function holdTransaction(statement,finish='ROLLBACK;'){
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});child.stderr.resume()
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('Lock fixture failed')))})
 void closed.catch(()=>{})
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Resource lock fixture readiness timed out'))},15000)
  let text='';child.stdout.on('data',part=>{text+=part.toString();if(text.includes('LOCK_READY')){clearTimeout(timeout);resolve()}});child.once('error',error=>{clearTimeout(timeout);reject(error)});child.once('close',()=>{clearTimeout(timeout);reject(new Error('Resource lock fixture closed before readiness'))})
  child.stdin.write(`BEGIN; ${statement}; SELECT 'LOCK_READY';\n`)
 })
 return async()=>{child.stdin.end(finish+'\n');await closed}
}
const lockProduct=id=>holdTransaction(`SELECT 1 FROM product WHERE id=${q(id)} FOR UPDATE`)
async function waitBlocked(){
 const deadline=Date.now()+15000
 while(Date.now()<deadline){
  if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%operator_revoke_energy_meter%')")==='t')return
  await new Promise(resolve=>setImmediate(resolve))
 }
 throw new Error('Privileged request did not reach the controlled resource lock')
}
await test('Privileged writes and private queues require verified MFA and live authorization',async t=>{
 const operator=await account('operator',['owner','operator']),curator=await account('curator',['owner','curator']),author=await account('author',['owner','contributor']),owner=await account('owner',['owner'])
 const f=meterFixture(owner,operator),unmetered=randomUUID()
 sql(`INSERT INTO device(id,product_id,public_key) VALUES(${q(unmetered)},${q(f.product)},${q(randomBytes(32).toString('base64'))})`)
 const contribution=(await submit(author.token)).data;assert.equal(contribution.ok,true)
 const item=randomUUID(),redemption=randomUUID()
 sql(`INSERT INTO catalog_item(id,title,point_cost,stock_total,stock_reserved,availability) VALUES(${q(item)},'Synthetic private queue',1,1,1,'available'); INSERT INTO redemption(id,account_id,catalog_item_id,reserved_points,idempotency_key) VALUES(${q(redemption)},${q(owner.id)},${q(item)},1,${q('privileged:'+run)});`)
 const writeCalls=token=>[
  ()=>rpc('operator_register_energy_meter',token,{p_device_id:unmetered,p_public_key:randomBytes(32).toString('base64'),p_calibration_ref:'Synthetic',p_eligible_load_ref:'Synthetic',p_valid_from:new Date().toISOString(),p_valid_until:new Date(Date.now()+86400000).toISOString(),p_max_power_w:100}),
  ()=>rpc('operator_revoke_energy_meter',token,{p_meter_id:f.meter,p_reason:'Synthetic revoke'}),
  ()=>rpc('operator_set_reward_policy',token,{p_version:'privileged-'+run,p_wh_per_point:1,p_daily_cap:10,p_enabled:true}),
  ()=>rpc('operator_upsert_catalog',token,{p_id:null,p_title:'Denied privileged '+run,p_point_cost:1,p_stock_total:1,p_availability:'available'}),
  ()=>rpc('operator_fulfill_redemption',token,{p_id:redemption,p_reference:'Synthetic fulfillment'}),
  ()=>rpc('operator_compensate_redemption',token,{p_id:redemption,p_reason:'Synthetic compensation'}),
 ]
 const state=()=>sql(`SELECT jsonb_build_object('meter',(SELECT status FROM energy_meter WHERE id=${q(f.meter)}),'new_meters',(SELECT count(*) FROM energy_meter WHERE device_id=${q(unmetered)}),'redemption',(SELECT status FROM redemption WHERE id=${q(redemption)}),'policy',(SELECT active_policy_id FROM reward_program WHERE singleton),'catalog',(SELECT count(*) FROM catalog_item WHERE title=${q('Denied privileged '+run)}),'ledger',(SELECT count(*) FROM ledger_entry WHERE redemption_id=${q(redemption)}),'reviews',(SELECT count(*) FROM review WHERE contribution_id=${q(contribution.contribution_id)}))`)
 await t.test('role-only AAL1 cannot write or read another account private queues; contributor and owner stay usable',async()=>{
  const before=state()
  for(const call of writeCalls(operator.token)){const r=await call();assert.equal(r.data.ok,false);assert.equal(r.data.code,'mfa_required')}
  assert.equal((await review(curator.token,contribution.contribution_id)).data.code,'mfa_required');assert.equal(state(),before)
  const rewards=(await rpc('reward_workspace',operator.token)).data;assert.equal(rewards.ok,true);assert.deepEqual(rewards.fulfillment_queue,[])
  assert.equal((await rpc('knowledge_workspace',curator.token)).data.contributions.some(c=>c.id===contribution.contribution_id),false)
  assert.deepEqual((await api('/rest/v1/contribution?id=eq.'+contribution.contribution_id,curator.token,undefined,'GET')).data,[])
  assert.equal((await rpc('knowledge_workspace',author.token)).data.contributions.some(c=>c.id===contribution.contribution_id),true)
  assert.equal((await rpc('reward_workspace',owner.token)).data.ok,true)
  const roles=(await rpc('my_curation_roles',operator.token)).data;assert.ok(roles.includes('owner'));assert.ok(!roles.includes('operator'))
  assert.ok((await api('/rest/v1/energy_meter',operator.token,undefined,'GET')).status>=400)
  assert.equal((await rpc('energy_workspace',operator.token)).data.meters.some(m=>m.id===f.meter),false)
  assert.equal((await rpc('privileged_write_gate',operator.token,{p_role:'operator'})).status,403)
  assert.equal((await rpc('privileged_role_active',operator.token,{p_role:'operator'})).status,403)
 })
 await t.test('verified AAL2 can review and write; stale fresh-code claims cannot mutate',async()=>{
  const aal1=operator.token
  operator.token=(await enableTotp(base,config.anon,operator.token)).token
  curator.token=(await enableTotp(base,config.anon,curator.token)).token
  const beforeAal1=state()
  for(const call of writeCalls(aal1)){const r=await call();assert.equal(r.data.ok,false);assert.equal(r.data.code,'unauthorized')}
  assert.equal(state(),beforeAal1)
  assert.equal((await review(curator.token,contribution.contribution_id)).data.ok,true)
  const secureQueue=(await rpc('reward_workspace',operator.token)).data.fulfillment_queue;assert.ok(secureQueue.some(r=>r.id===redemption))
  assert.equal((await rpc('energy_workspace',operator.token)).data.meters.some(m=>m.id===f.meter),true)
  const staleToken=stale(operator.token),before=state()
  assert.ok((await rpc('reward_workspace',staleToken)).data.fulfillment_queue.some(r=>r.id===redemption),'Read scope needs AAL2, not a fresh TOTP')
  assert.ok((await rpc('knowledge_workspace',stale(curator.token))).data.contributions.some(c=>c.id===contribution.contribution_id))
  for(const amr of [undefined,{},[],[{method:'totp',timestamp:'not-a-time'}],[{method:'totp',timestamp:Math.floor(Date.now()/1000)+600}]]){
   const rejected=await rpc('operator_revoke_energy_meter',withAmr(operator.token,amr),{p_meter_id:f.meter,p_reason:'Invalid AMR must not mutate'})
   assert.equal(rejected.data.ok,false);assert.equal(rejected.data.code,'step_up_required')
  }
  for(const call of writeCalls(staleToken)){const r=await call();assert.equal(r.data.ok,false);assert.equal(r.data.code,'step_up_required')}
  const another=(await submit(author.token)).data;assert.equal(another.ok,true)
  assert.equal((await review(stale(curator.token),another.contribution_id)).data.code,'step_up_required');assert.equal(state(),before)
  assert.equal((await rpc('operator_upsert_catalog',operator.token,{p_id:null,p_title:'Secure privileged '+run,p_point_cost:1,p_stock_total:1,p_availability:'available'})).data.ok,true)
  assert.equal((await rpc('operator_fulfill_redemption',operator.token,{p_id:redemption,p_reference:'Synthetic secure fulfillment'})).data.ok,true)
  assert.equal((await rpc('operator_compensate_redemption',operator.token,{p_id:redemption,p_reason:'Synthetic secure compensation'})).data.ok,true)
  assert.equal((await rpc('operator_revoke_energy_meter',operator.token,{p_meter_id:f.meter,p_reason:'Synthetic secure revoke'})).data.ok,true)
 })
 for(const revocation of ['role','session'])await t.test(`${revocation} revocation while resource lock is pending refuses the write`,async()=>{
  const actor=await account('race-'+revocation,['owner','operator']);actor.token=(await enableTotp(base,config.anon,actor.token)).token
  const fixture=meterFixture(owner,actor),release=await lockProduct(fixture.product)
  const pending=rpc('operator_revoke_energy_meter',actor.token,{p_meter_id:fixture.meter,p_reason:'Should not commit'})
  try{
   await waitBlocked()
   if(revocation==='role')sql(`UPDATE account SET access_roles=ARRAY['owner'] WHERE id=${q(actor.id)}`)
   else sql(`DELETE FROM auth.sessions WHERE id=${q(claims(actor.token).session_id)}`)
  }finally{await release()}
  const denied=await pending;assert.equal(denied.data.ok,false);assert.ok(['forbidden','unauthorized'].includes(denied.data.code))
  assert.equal(sql(`SELECT status FROM energy_meter WHERE id=${q(fixture.meter)}`),'active')
 })
 await t.test('factor unenrollment and session downgrade follow Auth lock order without deadlock',async()=>{
  const actor=await account('race-factor',['owner','operator']),factor=await enableTotp(base,config.anon,actor.token);actor.token=factor.token
  const fixture=meterFixture(owner,actor),session=claims(actor.token).session_id
  const finish=await holdTransaction(`DELETE FROM auth.mfa_factors WHERE id=${q(factor.factor)}`,`UPDATE auth.sessions SET aal='aal1' WHERE id=${q(session)}; COMMIT;`)
  const pending=rpc('operator_revoke_energy_meter',actor.token,{p_meter_id:fixture.meter,p_reason:'Unenrolled factor must not commit'})
  try{await waitBlocked()}finally{await finish()}
  const denied=await pending;assert.equal(denied.data.ok,false);assert.equal(denied.data.code,'mfa_required')
  assert.equal(sql(`SELECT status FROM energy_meter WHERE id=${q(fixture.meter)}`),'active')
 })
})
