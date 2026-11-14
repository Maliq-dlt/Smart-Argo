import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
// APP-02 (U02) against local Auth/PostgREST/PostgreSQL: rename and archive units, place devices with history, and
// ingest that honours placement and archive. Synthetic keys and readings; no physical device.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label){const r=await api('/auth/v1/signup',null,{email:`units-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);return{token:r.data.access_token,id:a.data.account.id}}
function device(product){const id=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');sql(`INSERT INTO device(id,product_id,public_key) VALUES(${q(id)},${q(product)},${q(publicKey)})`);return{id,keys,publicKey}}
function product(owner,variant,devices){const id=randomUUID();sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q('UNIT-'+id.slice(0,8).toUpperCase())},${q(variant)},'synthetic DB test'); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(id)},${q(owner.id)},clock_timestamp()-interval '1 day')`);return{id,devices:Array.from({length:devices},()=>device(id))}}
function ingest(d,unit,payloadText){const payload=payloadText??JSON.stringify({domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',device_id:d.id,unit_id:unit,boot_id:randomUUID(),sequence:1,measured_at:new Date().toISOString(),clock_status:'synced',sensors:{moisture:{status:'ok',value:50},soil_temperature:{status:'ok',value:26},soil_ph:{status:'not_measured',value:null}}});return rpc('ingest_verified_telemetry',config.service,{p_payload:payload,p_public_key:d.publicKey,p_signature:sign(null,Buffer.from(payload),d.keys.privateKey).toString('base64')}).then(r=>({...r.data,payload}))}
const units=async owner=>(await rpc('my_units',owner.token)).data
const pairs=async owner=>(await rpc('my_device_units',owner.token)).data.units.map(u=>`${u.device_id}:${u.unit_id}`)

await test('APP-02: unit lifecycle and device placement',async t=>{
 const alice=await account('alice'),bob=await account('bob')
 const profile=randomUUID(),contribution=randomUUID(),version=randomUUID()
 sql(`INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(profile)},'Unit test profile ${run}','Synthetic fixture'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(profile)},${q(alice.id)},'Test-only synthetic data','local://unit-fixture','{}','approved'); INSERT INTO review(contribution_id,reviewer_account_id,decision,decision_reason) VALUES(${q(contribution)},${q(bob.id)},'approved','Fixture only'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(profile)},${q(contribution)},1,'{}','synthetic test only');`)
 const garden=product(alice,'garden',2),pot=product(alice,'single_pot',1),other=product(bob,'garden',1)
 const create=async(p,label,owner=alice)=>(await rpc('create_my_unit',owner.token,{p_product_id:p.id,p_profile_version_id:version,p_label:label})).data
 const a=(await create(garden,'Zona A')).unit_id,b=(await create(garden,'Zona B')).unit_id,potUnit=(await create(pot,'Teras')).unit_id,bobUnit=(await create(other,'Bob',bob)).unit_id
 const [d1,d2]=garden.devices
 await t.test('rename is owner-only, idempotent and recorded',async()=>{
  assert.equal((await rpc('rename_my_unit',alice.token,{p_unit_id:a,p_label:'  Bedeng cabai  '})).data.changed,true)
  assert.equal((await rpc('rename_my_unit',alice.token,{p_unit_id:a,p_label:'Bedeng cabai'})).data.changed,false)
  assert.equal((await rpc('rename_my_unit',alice.token,{p_unit_id:a,p_label:' '})).data.code,'invalid_label')
  assert.equal((await rpc('rename_my_unit',bob.token,{p_unit_id:a,p_label:'Milik Bob'})).data.code,'unit_unavailable')
  const history=(await rpc('my_unit_history',alice.token,{p_unit_id:a})).data.events
  assert.deepEqual(history[0].detail,{from:'Zona A',to:'Bedeng cabai'})
  assert.equal((await rpc('my_unit_history',bob.token,{p_unit_id:a})).data.code,'unit_unavailable')
 })
 await t.test('a placed device reports only to its unit; unplaced devices keep the old behaviour',async()=>{
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d1.id,p_unit_id:a})).data.changed,true)
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d1.id,p_unit_id:a})).data.changed,false)
  const listed=await pairs(alice)
  assert.ok(listed.includes(`${d1.id}:${a}`));assert.ok(!listed.includes(`${d1.id}:${b}`))
  assert.ok(listed.includes(`${d2.id}:${a}`)&&listed.includes(`${d2.id}:${b}`),'unplaced device still pairs with every unit')
  assert.equal((await units(alice)).devices.find(d=>d.device_id===d1.id).unit_id,a)
  assert.equal((await ingest(d1,b)).code,'unit_mismatch')
  const accepted=await ingest(d1,a);assert.equal(accepted.ok,true)
  assert.equal((await ingest(d2,b)).ok,true)
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d1.id,p_unit_id:bobUnit})).data.code,'unit_unavailable')
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d1.id,p_unit_id:potUnit})).data.code,'unit_unavailable','other product')
  assert.equal((await rpc('place_my_device',bob.token,{p_device_id:d1.id,p_unit_id:a})).data.code,'device_unavailable')
  // Moving keeps history and an exact retry of a packet accepted before the move still succeeds.
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d1.id,p_unit_id:b})).data.changed,true)
  const retry=await ingest(d1,a,accepted.payload);assert.equal(retry.ok,true);assert.equal(retry.duplicate,true)
  assert.equal((await ingest(d1,a)).code,'unit_mismatch')
  assert.equal((await rpc('my_unit_history',alice.token,{p_unit_id:a})).data.events[0].action,'device_removed')
  assert.equal((await rpc('my_unit_history',alice.token,{p_unit_id:b})).data.events[0].action,'device_placed')
  assert.equal(sql(`SELECT count(*) FROM device_placement WHERE device_id=${q(d1.id)}`),'2')
 })
 await t.test('archiving keeps data, ends placements, and stops new packets',async()=>{
  const before=sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(b)}`)
  assert.equal((await rpc('archive_my_unit',alice.token,{p_unit_id:b})).data.changed,true)
  assert.equal((await rpc('archive_my_unit',alice.token,{p_unit_id:b})).data.changed,false)
  assert.equal(sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(b)}`),before)
  assert.equal((await units(alice)).devices.find(d=>d.device_id===d1.id).unit_id,null,'placement ended with the archive')
  assert.equal((await ingest(d2,b)).code,'unit_unavailable')
  assert.ok(!(await pairs(alice)).some(p=>p.endsWith(':'+b)))
  assert.ok((await units(alice)).units.find(u=>u.unit_id===b).archived_at)
  assert.equal((await rpc('rename_my_unit',alice.token,{p_unit_id:b,p_label:'X'})).data.code,'unit_unavailable')
  assert.equal((await rpc('place_my_device',alice.token,{p_device_id:d2.id,p_unit_id:b})).data.code,'unit_unavailable')
  assert.equal((await rpc('restore_my_unit',alice.token,{p_unit_id:b})).data.changed,true)
 })
 await t.test('an archived unit frees its slot; restoring respects the product limit',async()=>{
  assert.equal((await create(pot,'Kedua')).code,'unit_limit')
  assert.equal((await rpc('archive_my_unit',alice.token,{p_unit_id:potUnit})).data.ok,true)
  assert.equal((await create(pot,'Kedua')).ok,true)
  assert.equal((await rpc('restore_my_unit',alice.token,{p_unit_id:potUnit})).data.code,'unit_limit')
 })
 await t.test('records stay behind the functions and the trail is append-only',async()=>{
  assert.notEqual((await api('/rest/v1/device_placement?select=id',alice.token,undefined,'GET')).status,200)
  assert.throws(()=>sql(`UPDATE unit_event SET action='renamed' WHERE unit_id=${q(a)}`),/unit_event is append-only/)
  assert.equal((await rpc('lock_my_unit',alice.token,{p_unit_id:a})).status>=400,true)
 })
})
