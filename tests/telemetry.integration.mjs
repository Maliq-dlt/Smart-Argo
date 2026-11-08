import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync,sign,randomBytes,randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// Isolated local stack only. Real Auth, PostgreSQL transactions and cryptographic signatures.
const url='http://127.0.0.1:54321', config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=value=>"'"+String(value).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){
 const r=await fetch(url+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
 return {status:r.status,data:await r.json().catch(()=>null)}
}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function owner(label){
 const r=await api('/auth/v1/signup',null,{email:`telemetry-${run}-${label}@example.test`,password})
 assert.equal(r.status,200);assert.equal(typeof r.data.access_token,'string')
 const token=r.data.access_token,a=await rpc('ensure_my_account',token);assert.equal(a.data.ok,true)
 return {token,id:a.data.account.id,userId:r.data.user.id}
}
async function product(label,owner,variant='single_pot'){
 const id=randomUUID(),device=randomUUID(),serial=`TEL-${run}-${label}`.toUpperCase(),code=randomBytes(24).toString('base64url'),keys=generateKeyPairSync('ed25519')
 const publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
 sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q(serial)},${q(variant)},'local-protocol-test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(id)},${q(publicKey)}); INSERT INTO activation(product_id,secret_hash) VALUES(${q(id)},encode(digest(${q(code)},'sha256'),'hex'));`)
 const n=(await rpc('issue_activation_nonce',owner.token,{p_serial:serial})).data
 const claimed=await api('/functions/v1/product-claim',owner.token,{nonce_id:n.nonce_id,sealed_code:code,signature:sign(null,Buffer.from(n.challenge),keys.privateKey).toString('base64')})
 assert.equal(claimed.status,200)
 return {id,device,keys,publicKey,serial}
}
function packet(p,unit,overrides={}){return {domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',device_id:p.device,unit_id:unit,boot_id:randomUUID(),sequence:1,measured_at:new Date().toISOString(),clock_status:'synced',sensors:{moisture:{status:'ok',value:55},soil_temperature:{status:'error',value:null,error:'Probe disconnected'},soil_ph:{status:'not_measured',value:null}},...overrides}}
const envelope=(p,value)=>{const payload=typeof value==='string'?value:JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),p.keys.privateKey).toString('base64')}}
const send=(p,value)=>api('/functions/v1/telemetry-ingest',null,envelope(p,value))
const count=(table,where)=>Number(sql(`SELECT count(*) FROM ${table} WHERE ${where}`))

await test('Phase 2: authenticated device telemetry',async t=>{
 const first=await owner('a'),second=await owner('b'),profile=randomUUID(),contribution=randomUUID(),version=randomUUID()
 sql(`INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(profile)},'Protocol test profile ${run}','Synthetic protocol fixture, not field validated'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(profile)},${q(first.id)},'Test-only synthetic data','local://protocol-fixture','{}','approved'); INSERT INTO review(contribution_id,reviewer_account_id,decision,decision_reason) VALUES(${q(contribution)},${q(second.id)},'approved','Protocol fixture only, no agronomic validation'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(profile)},${q(contribution)},1,'{}','synthetic protocol test only');`)
 const p=await product('single',first),foreign=await product('foreign',second),garden=await product('garden',first,'garden')
 const create=(prod,label,token=first.token)=>rpc('create_my_unit',token,{p_product_id:prod.id,p_profile_version_id:version,p_label:label})
 let unit,foreignUnit,gardenUnits
 await t.test('owner-only unit creation; simultaneous single-pot creation has one winner',async()=>{
  assert.equal((await create(p,'forbidden',second.token)).data.code,'product_unavailable')
  const attempts=await Promise.all([create(p,'Pot A'),create(p,'Pot B')])
  assert.equal(attempts.filter(x=>x.data.ok).length,1);assert.equal(attempts.filter(x=>x.data.code==='unit_limit').length,1)
  unit=attempts.find(x=>x.data.ok).data.unit_id
  foreignUnit=(await create(foreign,'Other owner pot',second.token)).data.unit_id
  gardenUnits=[(await create(garden,'Zone A')).data.unit_id,(await create(garden,'Zone B')).data.unit_id]
  assert.equal((await rpc('my_device_units',first.token)).data.units.some(x=>x.unit_id===unit),true)
  assert.equal((await rpc('my_device_units',second.token)).data.units.some(x=>x.unit_id===unit),false)
  assert.equal((await rpc('create_my_unit',first.token,{p_product_id:garden.id,p_profile_version_id:randomUUID(),p_label:'No profile'})).data.code,'profile_unavailable')
 })
 let original
 await t.test('signed packet writes exactly three sensor statuses and authoritative receipt time',async()=>{
  original=packet(p,unit)
  const r=await send(p,original)
  assert.equal(r.status,200);assert.equal(r.data.inserted,3);assert.equal(r.data.duplicate,false)
  const readings=(await rpc('unit_measurements',first.token,{p_unit_id:unit})).data.readings
  assert.equal(readings.length,3)
  const byName=Object.fromEntries(readings.map(x=>[x.sensor_id,x]))
  assert.equal(byName.moisture.value_nullable,55);assert.equal(byName.soil_temperature.value_nullable,null)
  assert.equal(byName.soil_temperature.error_message,'Probe disconnected');assert.equal(byName.soil_ph.quality_status,'not_measured')
  for(const row of readings){assert.equal(row.source,'device');assert.equal(row.clock_status,'synced');assert.ok(Date.parse(row.received_at)>=Date.parse(row.measured_at))}
  assert.equal(sql(`SELECT payload_sha256=encode(digest(payload,'sha256'),'hex') FROM telemetry_packet WHERE id=${q(r.data.packet_id)}`),'t')
 })
 await t.test('parallel reconnect replay is idempotent; changed bytes/unit conflict',async()=>{
  const retries=await Promise.all(Array.from({length:5},()=>send(p,original)))
  for(const r of retries){assert.equal(r.status,200);assert.equal(r.data.inserted,0);assert.equal(r.data.duplicate,true)}
  assert.equal(count('measurement',`device_id=${q(p.device)}`),3)
  const altered={...original,sensors:{...original.sensors,moisture:{status:'ok',value:56}}}
  assert.equal((await send(p,altered)).status,409)
  const g=packet(garden,gardenUnits[0]);assert.equal((await send(garden,g)).status,200)
  assert.equal((await send(garden,{...g,unit_id:gardenUnits[1]})).status,409)
 })
 await t.test('forged/tampered key proofs and cross-product unit submissions fail',async()=>{
  const env=envelope(p,packet(p,unit));env.payload=env.payload.replace('55','56')
  assert.equal((await api('/functions/v1/telemetry-ingest',null,env)).status,403)
  env.signature=Buffer.alloc(64).toString('base64');assert.equal((await api('/functions/v1/telemetry-ingest',null,env)).status,403)
  assert.equal((await send(p,packet(p,foreignUnit))).status,403)
  const invalid=packet(p,unit,{source:'simulation'});assert.equal((await send(p,invalid)).status,400)
 })
 await t.test('sequence rollback/time reversal rejected; reboot accepts new boot identity',async()=>{
  const boot=randomUUID(),value=packet(p,unit,{boot_id:boot,sequence:10})
  assert.equal((await send(p,value)).status,200)
  assert.equal((await send(p,{...value,sequence:9})).status,409)
  assert.equal((await send(p,{...value,sequence:11,measured_at:new Date(Date.parse(value.measured_at)-1000).toISOString()})).status,409)
  assert.equal((await send(p,{...value,boot_id:randomUUID(),sequence:0,clock_status:'unsynced'})).status,200)
 })
 await t.test('backlog is preserved; future/too-old/invalid sensor data never partially insert',async()=>{
  assert.equal((await send(p,packet(p,unit,{measured_at:new Date(Date.now()-2*86400000).toISOString()}))).status,200)
  const before=count('measurement',`device_id=${q(p.device)}`)
  for(const overrides of [{measured_at:new Date(Date.now()+6*60000).toISOString()},{measured_at:new Date(Date.now()-8*86400000).toISOString()},{measured_at:'2026-02-30T12:00:00Z'},{drip:{}},{sensors:{...original.sensors,moisture:{status:'ok',value:101}}},{sensors:{...original.sensors,soil_ph:{status:'error',value:0,error:'bad'}}}])assert.equal((await send(p,packet(p,unit,overrides))).status,400)
  assert.equal(count('measurement',`device_id=${q(p.device)}`),before)
 })
 await t.test('sensor insertion error rolls back packet and all sensor rows',async()=>{
  const v=packet(p,unit),before=count('telemetry_packet',`device_id=${q(p.device)}`)
  sql(`CREATE FUNCTION phase2_test_fail_sensor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.device_id=${q(p.device)}::uuid AND NEW.sensor_id='soil_temperature' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase2_test_fail BEFORE INSERT ON measurement FOR EACH ROW EXECUTE FUNCTION phase2_test_fail_sensor();`)
  try{assert.equal((await send(p,v)).status,503);assert.equal(count('telemetry_packet',`device_id=${q(p.device)}`),before)}finally{sql('DROP TRIGGER phase2_test_fail ON measurement; DROP FUNCTION phase2_test_fail_sensor();')}
  assert.equal((await send(p,v)).status,200)
 })
 await t.test('RLS hides other accounts, private proofs and direct writes/RPC',async()=>{
  assert.equal((await rpc('unit_measurements',second.token,{p_unit_id:unit})).data.ok,false)
  assert.deepEqual((await api(`/rest/v1/measurement?unit_id=eq.${unit}`,second.token,undefined,'GET')).data,[])
  assert.equal((await api('/rest/v1/telemetry_packet?select=payload,signature',first.token,undefined,'GET')).status,403)
  assert.equal((await rpc('ingest_verified_telemetry',first.token,{p_payload:JSON.stringify(original),p_public_key:p.publicKey,p_signature:envelope(p,original).signature})).status,403)
  assert.equal((await api('/rest/v1/measurement',first.token,{})).status,403)
 })
 await t.test('new owner sees no measurements from the previous ownership period',async()=>{
  sql(`UPDATE ownership SET end_at=clock_timestamp() WHERE product_id=${q(p.id)} AND end_at IS NULL; INSERT INTO ownership(product_id,account_id) VALUES(${q(p.id)},${q(second.id)});`)
  assert.equal((await rpc('unit_measurements',first.token,{p_unit_id:unit})).data.ok,false)
  assert.deepEqual((await rpc('unit_measurements',second.token,{p_unit_id:unit})).data.readings,[])
  assert.equal((await send(p,packet(p,unit))).status,200)
  assert.equal((await rpc('unit_measurements',second.token,{p_unit_id:unit})).data.readings.length,3)
 })
 await t.test('rate limit caps new packets but still acknowledges exact retry',async()=>{
  const rateDevice=await product('rate',first),rateUnit=(await create(rateDevice,'Rate test pot')).data.unit_id
  const replay=packet(rateDevice,rateUnit)
  assert.equal((await send(rateDevice,replay)).status,200)
  for(let i=1;i<120;i++)assert.equal((await send(rateDevice,packet(rateDevice,rateUnit))).status,200)
  assert.equal((await send(rateDevice,packet(rateDevice,rateUnit))).status,429)
  const duplicate=await send(rateDevice,replay)
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.inserted,0)
  assert.equal(count('telemetry_packet',`device_id=${q(rateDevice.device)}`),120)
 })
 await t.test('revoked device or registry rejects validly signed packets',async()=>{
  sql(`UPDATE device SET status='revoked' WHERE id=${q(garden.device)}`)
  assert.equal((await send(garden,packet(garden,gardenUnits[0]))).status,403)
  sql(`UPDATE product SET registry_status='revoked' WHERE id=${q(foreign.id)}`)
  assert.equal((await send(foreign,packet(foreign,foreignUnit))).status,403)
 })
 await t.test('logout denies telemetry reads even before JWT expiry',async()=>{
  assert.equal((await api('/auth/v1/logout?scope=local',second.token,{})).status,204)
  assert.equal((await rpc('unit_measurements',second.token,{p_unit_id:unit})).data.ok,false)
  assert.deepEqual((await api(`/rest/v1/measurement?unit_id=eq.${unit}`,second.token,undefined,'GET')).data,[])
 })
})
