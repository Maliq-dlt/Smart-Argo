import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
// Database marketplace integration. Privileged, signed synthetic energy fixtures do not establish physical meter calibration.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body),service=(name,body)=>rpc(name,config.service,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,roles=['owner']){const r=await api('/auth/v1/signup',null,{email:`rewards-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`);return{token:r.data.access_token,id:a.data.account.id}}
async function evidenceOwner(owner,operator){const product=randomUUID(),device=randomUUID(),ownership=randomUUID(),meter=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('REWARD-'+device)},'single_pot','synthetic DB test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(publicKey)}); INSERT INTO ownership(id,product_id,account_id,start_at) VALUES(${q(ownership)},${q(product)},${q(owner.id)},clock_timestamp()-interval '1 day'); INSERT INTO energy_meter(id,device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by) VALUES(${q(meter)},${q(device)},${q(publicKey)},'Synthetic software fixture; no physical calibration','Synthetic declared eligible-load fixture; not hardware evidence',clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 day',10000,${q(operator.id)});`);return{device,ownership,meter,keys,next:0}}
function window(fixture,solar,load,quality='verified_meter'){const id=randomUUID(),boot=randomUUID(),sequence=fixture.next++,start=new Date(Math.floor(Date.now()/900000)*900000-900000*(30-sequence)),end=new Date(start.getTime()+900000);const payload=JSON.stringify({domain:'smart-agro.energy.v1',schema_version:1,source:'meter',meter_id:fixture.meter,device_id:fixture.device,boot_id:boot,sequence,start_at:start.toISOString(),end_at:end.toISOString(),clock_status:'synced',solar_start_wh:0,solar_end_wh:solar,load_start_wh:0,load_end_wh:load,battery_soc_pct:null}),signature=sign(null,Buffer.from(payload),fixture.keys.privateKey).toString('base64');sql(`INSERT INTO energy_window(id,device_id,boot_id,start_at,end_at,solar_harvest_wh,load_wh,evidence_quality,meter_id,ownership_id,sequence,payload,payload_sha256,signature,solar_start_wh,solar_end_wh,load_start_wh,load_end_wh) VALUES(${q(id)},${q(fixture.device)},${q(boot)},${q(start.toISOString())},${q(end.toISOString())},${solar},${load},${q(quality)},${q(fixture.meter)},${q(fixture.ownership)},${sequence},${q(payload)},encode(digest(${q(payload)},'sha256'),'hex'),${q(signature)},0,${solar},0,${load});`);return id}
const credit=(window,owner)=>service('credit_energy_reward',{p_window_id:window,p_account_id:owner.id})
await test('Phase 4: explicit policy and atomic marketplace (synthetic DB evidence)',async t=>{
 const operator=await account('operator',['owner','operator']),alice=await account('alice'),bob=await account('bob'),capOwner=await account('cap')
 const previous=(await rpc('reward_workspace',operator.token)).data.policy
 const setPolicy=(version,wh,cap,enabled=true)=>rpc('operator_set_reward_policy',operator.token,{p_version:version,p_wh_per_point:wh,p_daily_cap:cap,p_enabled:enabled})
 const catalog=(title,cost,stock,id=null,availability='available')=>rpc('operator_upsert_catalog',operator.token,{p_id:id,p_title:title,p_point_cost:cost,p_stock_total:stock,p_availability:availability})
 const reserve=(owner,item,request=randomUUID())=>rpc('reserve_my_reward',owner.token,{p_item_id:item,p_request_id:request})
 const af=await evidenceOwner(alice,operator),bf=await evidenceOwner(bob,operator),cf=await evidenceOwner(capOwner,operator)
 let scarce,common,firstWinner
 try{
 await t.test('disabled policy never creates credit; zero outcome remains pinned after enable',async()=>{
  assert.equal((await setPolicy('',1,100,false)).data.ok,true)
  const w=window(af,100,100);assert.equal((await credit(w,alice)).data.reason,'policy_disabled')
  assert.equal(sql(`SELECT count(*) FROM reward_event WHERE energy_window_id=${q(w)}`),'0')
  assert.equal((await setPolicy('synthetic-'+run,1,100)).data.ok,true)
  const retry=await credit(w,alice);assert.equal(retry.data.credited,0);assert.equal(retry.data.reason,'already_credited')
  assert.equal((await rpc('operator_set_reward_policy',alice.token,{p_version:'illegal',p_wh_per_point:1,p_daily_cap:100,p_enabled:true})).data.code,'forbidden')
  assert.equal((await setPolicy('synthetic-'+run,2,100)).data.code,'policy_conflict')
 })
 await t.test('eligible minimum, floor, daily cap, concurrent dedup and service-only helper',async()=>{
  const a=window(af,150,100),b=window(bf,100,100)
  const duplicate=await Promise.all([credit(a,alice),credit(a,alice),credit(b,bob)])
  assert.equal(duplicate[0].data.credited,100);assert.equal(duplicate[1].data.credited,100);assert.equal(duplicate[2].data.credited,100)
  assert.equal(sql(`SELECT count(*) FROM reward_event WHERE energy_window_id=${q(a)}`),'1')
  assert.equal((await credit(window(af,50,50),alice)).data.reason,'daily_cap')
  assert.equal((await credit(window(cf,3.9,2.9),capOwner)).data.credited,2)
  assert.equal((await credit(window(cf,0.5,0.5),capOwner)).data.reason,'below_threshold')
  assert.equal((await credit(window(cf,10,10,'simulated'),capOwner)).data.reason,'untrusted_window')
  assert.ok((await rpc('credit_energy_reward',alice.token,{p_window_id:a,p_account_id:alice.id})).status>=400)
  assert.equal((await credit(window(cf,10,10),alice)).data.reason,'untrusted_window')
 })
 await t.test('ledger failure rolls back credit event and processing result',async()=>{
  const w=window(cf,10,10),fn='reward_test_'+run.replaceAll('-','')
  sql(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id=${q(capOwner.id)}::uuid THEN RAISE EXCEPTION 'Synthetic ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${fn} BEFORE INSERT ON ledger_entry FOR EACH ROW EXECUTE FUNCTION public.${fn}();`)
  try{assert.ok((await credit(w,capOwner)).status>=400);assert.equal(sql(`SELECT count(*) FROM reward_event WHERE energy_window_id=${q(w)}`),'0');assert.equal(sql(`SELECT count(*) FROM energy_reward_result WHERE energy_window_id=${q(w)}`),'0')}
  finally{sql(`DROP TRIGGER ${fn} ON ledger_entry; DROP FUNCTION public.${fn}();`)}
  assert.equal((await credit(w,capOwner)).data.credited,10)
 })
 await t.test('concurrent stock and same-account balance reservations cannot overspend',async()=>{
  scarce=(await catalog('Synthetic scarce item '+run,80,1)).data.item_id
  const attempts=await Promise.all([reserve(alice,scarce),reserve(bob,scarce)])
  assert.equal(attempts.filter(r=>r.data.ok).length,1)
  const index=attempts.findIndex(r=>r.data.ok);firstWinner=index===0?alice:bob
  assert.equal((await rpc('cancel_my_redemption',firstWinner.token,{p_id:attempts[index].data.redemption_id})).data.status,'cancelled')
  common=(await catalog('Synthetic common item '+run,80,2)).data.item_id
  const same=await Promise.all([reserve(alice,common),reserve(alice,common)])
  assert.equal(same.filter(r=>r.data.ok).length,1);assert.equal(same.find(r=>!r.data.ok).data.code,'insufficient_points')
  await rpc('cancel_my_redemption',alice.token,{p_id:same.find(r=>r.data.ok).data.redemption_id})
 })
 await t.test('account-scoped request idempotency and protected reserved stock',async()=>{
  const key=randomUUID(),a=await reserve(alice,common,key),retry=await reserve(alice,common,key)
  assert.equal(a.data.redemption_id,retry.data.redemption_id)
  assert.equal((await reserve(alice,scarce,key)).data.code,'request_conflict')
  const b=await reserve(bob,common,key);assert.equal(b.data.ok,true);assert.notEqual(a.data.redemption_id,b.data.redemption_id)
  assert.equal((await catalog('Synthetic common item '+run,80,1,common)).data.code,'stock_reserved')
  assert.equal((await rpc('cancel_my_redemption',bob.token,{p_id:a.data.redemption_id})).data.code,'redemption_unavailable')
  await rpc('cancel_my_redemption',alice.token,{p_id:a.data.redemption_id});await rpc('cancel_my_redemption',bob.token,{p_id:b.data.redemption_id})
 })
 await t.test('cancel/fulfill race serializes; fulfillment uses reserved price and debits once',async()=>{
  const item=(await catalog('Synthetic fulfillment '+run,10,4)).data.item_id,r=(await reserve(alice,item)).data
  const race=await Promise.all([rpc('cancel_my_redemption',alice.token,{p_id:r.redemption_id}),rpc('operator_fulfill_redemption',operator.token,{p_id:r.redemption_id,p_reference:'Synthetic race fulfillment reference'})])
  assert.equal(race.filter(x=>x.data.ok).length,1)
  const another=(await reserve(alice,item)).data;assert.equal(another.ok,true)
  await catalog('Synthetic fulfillment '+run,20,4,item)
  const fulfilled=await rpc('operator_fulfill_redemption',operator.token,{p_id:another.redemption_id,p_reference:'Synthetic fulfillment reference; no shipment sent'})
  assert.equal(fulfilled.data.status,'fulfilled')
  const repeated=await rpc('operator_fulfill_redemption',operator.token,{p_id:another.redemption_id,p_reference:'Changed retry reference'})
  assert.equal(repeated.data.fulfillment_reference,fulfilled.data.fulfillment_reference)
  assert.equal(sql(`SELECT signed_points FROM ledger_entry WHERE redemption_id=${q(another.redemption_id)} AND reversal_of IS NULL`),'-10')
  const stock=sql(`SELECT stock_total FROM catalog_item WHERE id=${q(item)}`)
  const compensations=await Promise.all([rpc('operator_compensate_redemption',operator.token,{p_id:another.redemption_id,p_reason:'Synthetic test compensation; item not returned'}),rpc('operator_compensate_redemption',operator.token,{p_id:another.redemption_id,p_reason:'Duplicate synthetic request'})])
  assert.ok(compensations.every(x=>x.data.status==='compensated'))
  assert.equal(sql(`SELECT count(*) FROM ledger_entry WHERE redemption_id=${q(another.redemption_id)} AND reversal_of IS NOT NULL`),'1')
  assert.equal(sql(`SELECT sum(signed_points) FROM ledger_entry WHERE redemption_id=${q(another.redemption_id)}`),'0')
  assert.equal(sql(`SELECT stock_total FROM catalog_item WHERE id=${q(item)}`),stock)
 })
 await t.test('owner RLS, audit immutability and revoked session access',async()=>{
  const w=(await rpc('reward_workspace',alice.token)).data;assert.equal(w.ok,true);assert.deepEqual(w.fulfillment_queue,[])
  const other=await api('/rest/v1/ledger_entry?account_id=eq.'+alice.id,bob.token,undefined,'GET');assert.equal(other.status,200);assert.deepEqual(other.data,[])
  assert.ok((await api('/rest/v1/ledger_entry',alice.token,{account_id:alice.id,signed_points:1000,idempotency_key:randomUUID(),note:'Forbidden arbitrary credit'})).status>=400)
  for(const [table,where] of [['reward_policy',`version=${q('synthetic-'+run)}`],['reward_event',`account_id=${q(alice.id)}`],['ledger_entry',`account_id=${q(alice.id)}`]])assert.throws(()=>sql(`DELETE FROM ${table} WHERE ${where}`),/immutable/)
  await api('/auth/v1/logout?scope=local',bob.token,{})
  assert.equal((await rpc('reward_workspace',bob.token)).data.code,'unauthorized')
  assert.equal((await reserve(bob,common)).data.code,'unauthorized')
 })
 }finally{if(previous)await setPolicy(previous.version,previous.wh_per_point,previous.daily_point_cap);else await setPolicy('',1,100,false)}
})
