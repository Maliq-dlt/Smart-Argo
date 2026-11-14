import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign,createHmac} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {enableTotp} from './totp.mjs'
// RW-04 (U04, A06) against local Auth/PostgREST/PostgreSQL: near-bound energy is held for review instead of credited,
// owners appeal their own results, and an operator takes and decides cases with a reason. Synthetic signed fixtures
// (same shape as reward.integration.mjs); no physical meter is involved.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,roles=['owner']){const r=await api('/auth/v1/signup',null,{email:`cases-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`);return{token:r.data.access_token,id:a.data.account.id}}
// A meter bounded at 10 kW: a 15-minute window may hold at most 2500 Wh; 90% of that (2250 Wh) is held for review.
function evidenceOwner(owner,operator){const product=randomUUID(),device=randomUUID(),ownership=randomUUID(),meter=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('CASE-'+device)},'single_pot','synthetic DB test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(publicKey)}); INSERT INTO ownership(id,product_id,account_id,start_at) VALUES(${q(ownership)},${q(product)},${q(owner.id)},clock_timestamp()-interval '1 day'); INSERT INTO energy_meter(id,device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by) VALUES(${q(meter)},${q(device)},${q(publicKey)},'Synthetic software fixture; no physical calibration','Synthetic eligible-load fixture',clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 day',10000,${q(operator.id)});`);return{device,ownership,meter,keys,next:0}}
function window(fixture,solar,load){const id=randomUUID(),boot=randomUUID(),sequence=fixture.next++,start=new Date(Math.floor(Date.now()/900000)*900000-900000*(30-sequence)),end=new Date(start.getTime()+900000);const payload=JSON.stringify({domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:fixture.meter,device_id:fixture.device,boot_id:boot,sequence,start_at:start.toISOString(),end_at:end.toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:solar,load_start_wh:0,load_end_wh:load,battery_soc_pct:null}),signature=sign(null,Buffer.from(payload),fixture.keys.privateKey).toString('base64');sql(`INSERT INTO energy_window(id,device_id,boot_id,start_at,end_at,solar_harvest_wh,load_wh,evidence_quality,meter_id,ownership_id,sequence,payload,payload_sha256,signature,solar_start_wh,solar_end_wh,load_start_wh,load_end_wh) VALUES(${q(id)},${q(fixture.device)},${q(boot)},${q(start.toISOString())},${q(end.toISOString())},${solar},${load},'verified_meter',${q(fixture.meter)},${q(fixture.ownership)},${sequence},${q(payload)},encode(digest(${q(payload)},'sha256'),'hex'),${q(signature)},0,${solar},0,${load});`);return id}
function forge(token,patch){const [head,body]=token.split('.');const data=head+'.'+Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url')),...patch})).toString('base64url');return data+'.'+createHmac('sha256',config.secret).update(data).digest('base64url')}
const credit=(window,owner)=>rpc('credit_energy_reward',config.service,{p_window_id:window,p_account_id:owner.id})
const credits=owner=>Number(sql(`SELECT coalesce(sum(signed_points),0) FROM ledger_entry WHERE account_id=${q(owner.id)}`))

await test('RW-04: held claims, appeals and operator decisions',async t=>{
 const operator=await account('operator',['owner','operator']),second=await account('second',['owner','operator']),alice=await account('alice'),bob=await account('bob')
 operator.token=(await enableTotp(base,config.anon,operator.token)).token
 second.token=(await enableTotp(base,config.anon,second.token)).token
 const previous=(await rpc('reward_workspace',operator.token)).data.policy
 assert.equal((await rpc('operator_set_reward_policy',operator.token,{p_version:'cases-'+run,p_wh_per_point:1,p_daily_cap:1000,p_enabled:true})).data.ok,true)
 const af=evidenceOwner(alice,operator),of=evidenceOwner(operator,second)
 let held,heldCase,lowWindow,appealCase
 try{
 await t.test('energy near the meter bound is held, not credited, and opens an anomaly case',async()=>{
  const normal=await credit(window(af,100,100),alice)
  assert.equal(normal.data.reason,'credited');assert.equal(normal.data.case_id,null)
  held=window(af,2300,2300)
  const result=(await credit(held,alice)).data
  assert.equal(result.reason,'held_for_review');assert.equal(result.credited,0);assert.ok(result.case_id)
  heldCase=result.case_id
  assert.equal(sql(`SELECT count(*) FROM reward_event WHERE energy_window_id=${q(held)}`),'0')
  assert.equal(sql(`SELECT kind||'/'||status||'/'||proposed_points FROM reward_case WHERE id=${q(heldCase)}`),'anomaly/open/900')
  assert.equal((await credit(held,alice)).data.reason,'already_credited','a retry never opens a second case')
  const mine=(await rpc('my_reward_cases',alice.token)).data
  assert.equal(mine.cases.find(c=>c.id===heldCase).status,'open')
 })
 await t.test('owners appeal only their own recent results, once per subject, idempotently',async()=>{
  lowWindow=window(af,0.5,0.5);assert.equal((await credit(lowWindow,alice)).data.reason,'below_threshold')
  const request=randomUUID(),body={p_request_id:request,p_energy_window_id:lowWindow,p_redemption_id:null,p_statement:'Panel bersih, cuaca cerah; hasilnya terlalu kecil.'}
  const first=(await rpc('open_reward_appeal',alice.token,body)).data
  assert.equal(first.ok,true);assert.equal(first.idempotent,false);appealCase=first.case_id
  const retry=(await rpc('open_reward_appeal',alice.token,body)).data
  assert.equal(retry.case_id,appealCase);assert.equal(retry.idempotent,true)
  assert.equal((await rpc('open_reward_appeal',alice.token,{...body,p_statement:'Lain'})).data.code,'request_conflict')
  assert.equal((await rpc('open_reward_appeal',alice.token,{...body,p_request_id:randomUUID()})).data.code,'case_open')
  assert.equal((await rpc('open_reward_appeal',bob.token,{...body,p_request_id:randomUUID()})).data.code,'subject_unavailable')
  assert.equal((await rpc('open_reward_appeal',alice.token,{...body,p_request_id:randomUUID(),p_statement:'  '})).data.code,'invalid_request')
  assert.equal((await rpc('open_reward_appeal',alice.token,{...body,p_request_id:randomUUID(),p_redemption_id:randomUUID()})).data.code,'invalid_request')
  assert.equal((await rpc('open_reward_appeal',alice.token,{...body,p_request_id:randomUUID(),p_energy_window_id:held})).data.code,'case_open','the anomaly case already covers it')
 })
 await t.test('cases and their trail are reachable only through the functions',async()=>{
  assert.notEqual((await api('/rest/v1/reward_case?select=id',alice.token,undefined,'GET')).status,200)
  assert.equal((await rpc('operator_reward_cases',alice.token)).data.code,'forbidden')
  assert.throws(()=>sql(`UPDATE reward_case_event SET action='upheld' WHERE case_id=${q(heldCase)}`),/append-only/)
 })
 await t.test('an operator takes a case with fresh assurance; nobody else decides it',async()=>{
  const stale=forge(operator.token,{amr:JSON.parse(Buffer.from(operator.token.split('.')[1],'base64url')).amr.map(m=>m.method==='totp'?{...m,timestamp:m.timestamp-600}:m)})
  assert.equal((await rpc('operator_take_reward_case',stale,{p_case_id:heldCase,p_request_id:randomUUID()})).data.code,'step_up_required')
  const queue=(await rpc('operator_reward_cases',operator.token,{p_status:'open'})).data
  const row=queue.cases.find(c=>c.id===heldCase)
  assert.equal(row.energy.bound_wh,2500);assert.equal(row.energy.result,'held_for_review');assert.equal(row.proposed_points,900)
  const take=randomUUID()
  assert.equal((await rpc('operator_take_reward_case',operator.token,{p_case_id:heldCase,p_request_id:take})).data.status,'in_review')
  assert.equal((await rpc('operator_take_reward_case',operator.token,{p_case_id:heldCase,p_request_id:take})).data.idempotent,true)
  assert.equal((await rpc('operator_take_reward_case',second.token,{p_case_id:heldCase,p_request_id:randomUUID()})).data.code,'state_conflict')
  assert.equal((await rpc('operator_decide_reward_case',second.token,{p_case_id:heldCase,p_request_id:randomUUID(),p_decision:'rejected',p_points:null,p_reason:'x'})).data.code,'state_conflict')
 })
 await t.test('operators cannot review their own cases',async()=>{
  const own=(await credit(window(of,2400,2400),operator)).data
  assert.equal(own.reason,'held_for_review')
  assert.equal((await rpc('operator_take_reward_case',operator.token,{p_case_id:own.case_id,p_request_id:randomUUID()})).data.code,'self_review')
 })
 await t.test('upholding credits once through its own reward event; rejection credits nothing',async()=>{
  const before=credits(alice),decide=randomUUID(),body={p_case_id:heldCase,p_request_id:decide,p_decision:'upheld',p_points:null,p_reason:'Cuaca cerah tercatat; nilai wajar.'}
  const upheld=(await rpc('operator_decide_reward_case',operator.token,body)).data
  assert.equal(upheld.status,'upheld');assert.equal(upheld.credited_points,900)
  assert.equal((await rpc('operator_decide_reward_case',operator.token,body)).data.idempotent,true)
  assert.equal((await rpc('operator_decide_reward_case',operator.token,{...body,p_points:5})).data.code,'request_conflict')
  assert.equal(credits(alice)-before,900,'credited exactly once')
  assert.equal(sql(`SELECT count(*) FROM ledger_entry WHERE idempotency_key='case:${heldCase}'`),'1')
  assert.equal((await rpc('operator_take_reward_case',second.token,{p_case_id:appealCase,p_request_id:randomUUID()})).data.status,'in_review')
  const rejected=(await rpc('operator_decide_reward_case',second.token,{p_case_id:appealCase,p_request_id:randomUUID(),p_decision:'rejected',p_points:null,p_reason:'Meter mencatat mendung sepanjang jendela.'})).data
  assert.equal(rejected.status,'rejected');assert.equal(rejected.credited_points,null)
  assert.equal(credits(alice)-before,900)
  const mine=(await rpc('my_reward_cases',alice.token)).data.cases.find(c=>c.id===appealCase)
  assert.equal(mine.decision_reason,'Meter mencatat mendung sepanjang jendela.');assert.equal(mine.status,'rejected')
  assert.equal(sql(`SELECT string_agg(action,',' ORDER BY id) FROM reward_case_event WHERE case_id=${q(appealCase)}`),'opened,assigned,rejected')
 })
 }finally{
  const restore=previous?{p_version:previous.version,p_wh_per_point:previous.wh_per_point,p_daily_cap:previous.daily_point_cap,p_enabled:true}:{p_version:null,p_wh_per_point:null,p_daily_cap:null,p_enabled:false}
  const done=(await rpc('operator_set_reward_policy',operator.token,restore)).data
  assert.ok(done.ok||done.code==='policy_conflict','policy restore failed: '+JSON.stringify(done))
 }
})
