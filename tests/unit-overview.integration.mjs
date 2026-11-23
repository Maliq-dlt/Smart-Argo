import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
// APP-03 (U02, A05) against local Auth/PostgREST/PostgreSQL: the overview reports the latest reading per sensor and
// alerts (no data, stale, sensor error, revoked device, energy deficit, low battery) from the current ownership only.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label){const r=await api('/auth/v1/signup',null,{email:`overview-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);return{token:r.data.access_token,id:a.data.account.id}}
function product(owner){const id=randomUUID(),device=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q('OVR-'+id.slice(0,8).toUpperCase())},'garden','synthetic DB test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(id)},${q(publicKey)}); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(id)},${q(owner.id)},clock_timestamp()-interval '2 days')`);return{id,device,keys,publicKey}}
async function ingest(p,unit,sensors,extra={}){const payload=JSON.stringify({domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',device_id:p.device,unit_id:unit,boot_id:randomUUID(),sequence:1,measured_at:new Date().toISOString(),clock_status:'synced',sensors,...extra});const r=await rpc('ingest_verified_telemetry',config.service,{p_payload:payload,p_public_key:p.publicKey,p_signature:sign(null,Buffer.from(payload),p.keys.privateKey).toString('base64')});assert.equal(r.data.ok,true,JSON.stringify(r.data))}
const fixture=sqlText=>sql(`SET session_replication_role=replica; ${sqlText}; SET session_replication_role=origin;`)
const overview=async owner=>Object.fromEntries((await rpc('my_unit_overview',owner.token)).data.units.map(u=>[u.location_label,u]))

await test('APP-03: unit overview and alerts',async t=>{
 const alice=await account('alice'),bob=await account('bob')
 const profile=randomUUID(),contribution=randomUUID(),version=randomUUID()
 sql(`INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(profile)},'Overview profile ${run}','Synthetic fixture'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(profile)},${q(alice.id)},'Test-only synthetic data','local://overview','{}','approved'); INSERT INTO review(contribution_id,reviewer_account_id,decision,decision_reason) VALUES(${q(contribution)},${q(bob.id)},'approved','Fixture only'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(profile)},${q(contribution)},1,'{}','synthetic test only');`)
 const garden=product(alice),handed=product(bob)
 const create=async(p,label,owner)=>(await rpc('create_my_unit',owner.token,{p_product_id:p.id,p_profile_version_id:version,p_label:label})).data.unit_id
 const fresh=await create(garden,'Segar',alice),stale=await create(garden,'Usang',alice),gone=await create(garden,'Arsip',alice)
 await create(garden,'Kosong',alice)
 const bobUnit=await create(handed,'Bekas Bob',bob)
 await ingest(garden,fresh,{moisture:{status:'ok',value:41},soil_temperature:{status:'error',value:null,error:'Probe disconnected'},soil_ph:{status:'not_measured',value:null}})
 await ingest(garden,stale,{moisture:{status:'ok',value:60},soil_temperature:{status:'ok',value:25},soil_ph:{status:'ok',value:6.5}})
 fixture(`UPDATE telemetry_packet SET received_at=received_at-interval '3 hours', measured_at=measured_at-interval '3 hours' WHERE unit_id=${q(stale)}; UPDATE measurement SET received_at=received_at-interval '3 hours', measured_at=measured_at-interval '3 hours' WHERE unit_id=${q(stale)}`)
 await ingest(handed,bobUnit,{moisture:{status:'ok',value:70},soil_temperature:{status:'ok',value:24},soil_ph:{status:'ok',value:6.8}})
 assert.equal((await rpc('archive_my_unit',alice.token,{p_unit_id:gone})).data.ok,true)
 await t.test('latest reading per sensor and freshness alerts',async()=>{
  const units=await overview(alice)
  assert.equal(units.Arsip,undefined,'archived units are left out')
  const s=Object.fromEntries(units.Segar.sensors.map(x=>[x.sensor_id,x]))
  assert.equal(s.moisture.value_nullable,41);assert.equal(s.soil_temperature.quality_status,'error');assert.equal(s.soil_ph.value_nullable,null)
  assert.deepEqual(units.Segar.alerts,['sensor_error'])
  assert.deepEqual(units.Usang.alerts,['stale'])
  assert.deepEqual(units.Kosong.alerts,['no_data'])
  assert.equal(units.Segar.devices[0].status,'active')
 })
 await t.test('battery voltage comes from the latest packet and a low cell raises battery_low',async()=>{
  const cell=await create(garden,'Baterai',alice),ago=s=>new Date(Date.now()-s*1000).toISOString()
  const soil={moisture:{status:'ok',value:50},soil_temperature:{status:'ok',value:26},soil_ph:{status:'not_measured',value:null}}
  await ingest(garden,cell,soil,{measured_at:ago(120),battery:{status:'ok',value:3.92}})
  let u=(await overview(alice)).Baterai
  assert.deepEqual([u.battery.voltage,u.alerts],[3.92,[]])
  await ingest(garden,cell,soil,{measured_at:ago(60),battery:{status:'ok',value:3.31}})
  u=(await overview(alice)).Baterai
  assert.deepEqual([u.battery.voltage,u.alerts],[3.31,['battery_low']])
  await ingest(garden,cell,soil,{measured_at:ago(1),battery:{status:'not_measured',value:null}})
  u=(await overview(alice)).Baterai
  assert.deepEqual([u.battery,u.alerts],[null,[]],'a newer packet without a reading clears the voltage')
  assert.equal((await overview(alice)).Segar.battery,null,'packets without the object report nothing')
 })
 await t.test('soil pH, read once a day, shows the last measured value with its own time',async()=>{
  const daily=await create(garden,'pH harian',alice)
  const soil=(ph,moisture={status:'ok',value:48})=>({moisture,soil_temperature:{status:'ok',value:25},soil_ph:ph})
  await ingest(garden,daily,soil({status:'ok',value:6.4}))
  // SINTETIS. The morning reading is 20 hours old; the device has sent pH as not_measured since.
  fixture(`UPDATE telemetry_packet SET received_at=received_at-interval '20 hours', measured_at=measured_at-interval '20 hours' WHERE unit_id=${q(daily)}; UPDATE measurement SET received_at=received_at-interval '20 hours', measured_at=measured_at-interval '20 hours' WHERE unit_id=${q(daily)}`)
  await ingest(garden,daily,soil({status:'not_measured',value:null}))
  let s=Object.fromEntries((await overview(alice))['pH harian'].sensors.map(x=>[x.sensor_id,x]))
  assert.equal(s.soil_ph.quality_status,'ok')
  assert.equal(Number(s.soil_ph.value_nullable),6.4)
  assert.ok(Date.now()-Date.parse(s.soil_ph.measured_at)>19*3600000,'the pH keeps its own measurement time')
  assert.ok(Date.now()-Date.parse(s.moisture.measured_at)<600000,'moisture is the newest packet')
  // Only pH falls back: a moisture probe that stops measuring is never covered by an older value.
  await ingest(garden,daily,soil({status:'not_measured',value:null},{status:'not_measured',value:null}),{measured_at:new Date(Date.now()+1000).toISOString()})
  s=Object.fromEntries((await overview(alice))['pH harian'].sensors.map(x=>[x.sensor_id,x]))
  assert.equal(s.moisture.quality_status,'not_measured')
 })
 await t.test('energy, battery and device alerts',async()=>{
  const meter=randomUUID(),now=Date.now(),start=new Date(Math.floor(now/900000)*900000-900000*4).toISOString(),end=new Date(Math.floor(now/900000)*900000-900000*3).toISOString()
  fixture(`INSERT INTO energy_meter(id,device_id,public_key,calibration_ref,eligible_load_ref,valid_from,valid_until,max_power_w,created_by) VALUES(${q(meter)},${q(garden.device)},${q(garden.publicKey)},'fixture','fixture',clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 day',100,${q(alice.id)});
   INSERT INTO energy_window(device_id,boot_id,start_at,end_at,solar_harvest_wh,load_wh,evidence_quality,meter_id,ownership_id,solar_start_wh,solar_end_wh,load_start_wh,load_end_wh,battery_soc_pct)
   SELECT ${q(garden.device)},'b',${q(start)},${q(end)},2,9,'verified_meter',${q(meter)},id,0,2,0,9,15 FROM ownership WHERE product_id=${q(garden.id)} AND end_at IS NULL`)
  fixture(`UPDATE device SET status='revoked' WHERE id=${q(garden.device)}`)
  const units=await overview(alice)
  assert.deepEqual(units.Segar.energy,{windows:1,solar_wh:2,load_wh:9,battery_soc_pct:15})
  assert.deepEqual(units.Segar.alerts,['sensor_error','device_revoked','energy_deficit','battery_low'])
 })
 await t.test('a new owner starts without the previous owner readings',async()=>{
  assert.deepEqual((await overview(bob))['Bekas Bob'].alerts,[])
  sql(`UPDATE ownership SET end_at=clock_timestamp() WHERE product_id=${q(handed.id)} AND end_at IS NULL; INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(handed.id)},${q(alice.id)},clock_timestamp())`)
  const mine=await overview(alice)
  assert.deepEqual(mine['Bekas Bob'].sensors,[]);assert.deepEqual(mine['Bekas Bob'].alerts,['no_data'])
  assert.deepEqual(await overview(bob),{})
  assert.equal((await rpc('my_unit_overview',null)).status>=400||(await rpc('my_unit_overview',null)).data.ok===false,true)
 })
})
