import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { enableTotp } from './totp.mjs'
const base='http://127.0.0.1:54321', config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body){const r=await fetch(base+path,{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body)=>api('/rest/v1/rpc/'+name,token,body).then(r=>r.data)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label){const r=await api('/auth/v1/signup',null,{email:`history-${run}-${label}@example.test`,password});assert.equal(r.status,200);return {token:r.data.access_token,id:(await rpc('ensure_my_account',r.data.access_token,{})).account.id,user:r.data.user.id}}
await test('History reporting: private actual telemetry, stable pages and bounded comparisons',async t=>{
 const [a,b]=await Promise.all([account('owner'),account('other')]),product=randomUUID(),unit=randomUUID(),device=randomUUID(),plant=randomUUID(),contribution=randomUUID(),version=randomUUID(),own=randomUUID(),boot=randomUUID(),serial=('HISTORY-'+run).toUpperCase()
 const keys=generateKeyPairSync('ed25519'),pub=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
 // Synthetic software fixtures exercise reporting, not field calibration or agronomic validity.
 sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q(serial)},'single_pot','Synthetic test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(pub)}); INSERT INTO ownership(id,product_id,account_id,start_at) VALUES(${q(own)},${q(product)},${q(a.id)},clock_timestamp()-interval '2 hours'); INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(plant)},${q('History '+run)},'Synthetic test'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(plant)},${q(a.id)},'Synthetic test permission','Software fixture','{}','approved'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(plant)},${q(contribution)},1,'{}','Synthetic test'); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},${q(version)},'History fixture');`)
 const now=Date.now(),at=minutes=>new Date(now+minutes*60000).toISOString(),range={p_unit_id:unit,p_from:at(-60),p_to:at(1)}
 const read=(patch={},token=a.token)=>rpc('read_my_measurement_history',token,{...range,...patch})
 const windows={p_unit_id:unit,p_first_from:at(-60),p_first_to:at(-20),p_second_from:at(-20),p_second_to:at(1)}
 const compare=(patch={},token=a.token)=>rpc('compare_my_measurement_history',token,{...windows,...patch})
 const exportHistory=async(token=a.token,patch={})=>{
  const response=await fetch(base+'/functions/v1/history-export',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({unit_id:unit,from:range.p_from,to:range.p_to,...patch}),signal:AbortSignal.timeout(20000)})
  return {response,text:await response.text()}
 }
 let seq=0
 const send=async(minutes,moisture,temp,clock='synced',packetBoot=boot)=>{
  const payload=JSON.stringify({domain:'smart-agro.telemetry.v2',schema_version:2,source:'device',device_id:device,unit_id:unit,boot_id:packetBoot,sequence:++seq,measured_at:at(minutes),clock_status:clock,sensors:{moisture:{status:'ok',value:moisture},soil_temperature:temp===null?{status:'error',value:null,error:'Synthetic probe failure'}:{status:'ok',value:temp},soil_ph:{status:'not_measured',value:null}}})
  const result=await api('/functions/v1/telemetry-ingest',null,{payload,signature:sign(null,Buffer.from(payload),keys.privateKey).toString('base64')});assert.equal(result.status,200);return result.data
 }
 await send(-40,0,null);await send(-30,20,20);await send(-10,40,40);await send(-5,99,55,'unsynced')
 await t.test('private RPC grants, finite windows and cursor ownership validation',async()=>{
  assert((await api('/rest/v1/rpc/read_my_measurement_history',null,range)).status>=400)
  assert.equal((await read({},b.token)).code,'unit_unavailable');assert.equal((await compare({},b.token)).code,'unit_unavailable')
  for(const patch of [{p_limit:0},{p_limit:501},{p_limit:null},{p_from:'-infinity'},{p_to:'infinity'},{p_from:at(-32*24*60)},{p_from:at(2)},{p_cursor_at:at(-5)},{p_cursor_id:randomUUID()},{p_snapshot_as_of:at(5)}])assert.equal((await read(patch)).code,'invalid_range')
  assert.equal((await read({p_cursor_at:at(-5),p_cursor_id:randomUUID(),p_snapshot_as_of:new Date().toISOString()})).code,'invalid_cursor')
  assert.equal((await compare({p_second_from:at(-30)})).code,'invalid_range')
 })
 await t.test('tuple paging preserves ties, quality and provenance without signed payloads',async()=>{
  const first=await read({p_limit:2});assert.equal(first.ok,true);assert.equal(first.readings.length,2);assert(first.next_cursor)
  await send(-1,50,50)
  let page=first,rows=[...first.readings]
  while(page.next_cursor){page=await read({p_limit:2,p_cursor_at:page.next_cursor.measured_at,p_cursor_id:page.next_cursor.id,p_snapshot_as_of:first.snapshot_as_of});assert.equal(page.ok,true);rows.push(...page.readings)}
  assert.equal(rows.length,12);assert.equal(new Set(rows.map(r=>r.id)).size,12)
  for(const r of rows){assert.equal(r.device_id,device);assert.equal(r.unit_id,unit);assert(r.packet_id);assert(r.boot_id);assert.equal(r.source,'device')}
  assert(rows.some(r=>r.quality_status==='error'&&r.value_nullable===null));assert(rows.some(r=>r.quality_status==='not_measured'&&r.value_nullable===null));assert(rows.some(r=>r.clock_status==='unsynced'))
  assert.doesNotMatch(JSON.stringify(rows),/signature|public_key|payload_sha256|auth_user|sealed_code/)
  assert.equal((await read()).readings.length,15)
  const latest=await read({p_limit:1});assert.equal((await read({p_to:at(-20),p_cursor_at:latest.next_cursor.measured_at,p_cursor_id:latest.next_cursor.id,p_snapshot_as_of:latest.snapshot_as_of})).code,'invalid_cursor')
 })
 await t.test('comparison aggregates actual synced values and keeps failures/missing distinct',async()=>{
  const r=await compare({p_second_to:at(-2)});assert.equal(r.ok,true)
  const m=r.sensors.find(s=>s.sensor_id==='moisture'),temp=r.sensors.find(s=>s.sensor_id==='soil_temperature'),ph=r.sensors.find(s=>s.sensor_id==='soil_ph')
  assert.equal(m.first.eligible_count,2);assert.equal(m.first.avg,10);assert.equal(m.first.min,0);assert.equal(m.first.max,20)
  assert.equal(m.second.total_count,2);assert.equal(m.second.unsynced_count,1);assert.equal(m.second.eligible_count,1);assert.equal(m.second.avg,40);assert.equal(m.avg_delta,30)
  assert.equal(temp.first.error_count,1);assert.equal(temp.first.avg,20);assert.equal(temp.avg_delta,20)
  assert.equal(ph.first.not_measured_count,2);assert.equal(ph.first.eligible_count,0);assert.equal(ph.first.avg,null);assert.equal(ph.avg_delta,null)
  const empty=await compare({p_first_from:at(-100),p_first_to:at(-90)});assert(empty.sensors.every(s=>s.first.total_count===0&&s.first.min===null&&s.avg_delta===null))
 })
 // Future observation received before a transfer must not become visible to the recipient.
 await send(0.5,65,55,'synced',randomUUID())
 await t.test('actual CSV export preserves row count, zeros, empty missing values and private provenance',async()=>{
  const expected=await read(),out=await exportHistory();assert.equal(out.response.status,200)
  assert.match(out.response.headers.get('content-type'),/^text\/csv/)
  assert.equal(out.response.headers.get('x-history-row-count'),String(expected.readings.length))
  assert(Number.isFinite(Date.parse(out.response.headers.get('x-history-snapshot-as-of'))))
  assert.match(out.response.headers.get('content-disposition'),/attachment; filename="smart-agro-history.csv"/)
  const lines=out.text.trimEnd().split('\r\n'),columns=lines[0].replace(/^\uFEFF/,'').split(',')
  assert.equal(lines.length,expected.readings.length+1)
  assert.deepEqual(columns,['id','unit_id','device_id','packet_id','sensor_id','source','quality_status','value_nullable','error_message','measured_at','received_at','clock_status','sequence','boot_id'])
  const rows=lines.slice(1).map(line=>line.split(','))
  assert(rows.some(r=>r[6]==='"ok"'&&r[7]==='"0"'))
  assert(rows.some(r=>r[6]==='"error"'&&r[7]==='""'))
  assert(rows.some(r=>r[6]==='"not_measured"'&&r[7]==='""'))
  assert.doesNotMatch(out.text,/signature|public_key|payload_sha256|auth_user|sealed_code|@example/)
  for(const [token,status] of [[null,401],[b.token,403]])assert.equal((await exportHistory(token)).response.status,status)
  assert.equal((await exportHistory(a.token,{from:'infinity'})).response.status,400)
 })
 await t.test('MFA and revoked current sessions protect both read and compare',async()=>{
  const old=a.token,verified=await enableTotp(base,config.anon,a.token)
  assert.equal((await read({},old)).code,'unauthorized');assert.equal((await compare({},old)).code,'unauthorized');assert.equal((await exportHistory(old)).response.status,401)
  a.token=verified.token;assert.equal((await read()).ok,true);assert.equal((await compare()).ok,true)
  const sid=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url')).session_id;sql(`DELETE FROM auth.sessions WHERE id=${q(sid)}`)
  assert.equal((await read()).code,'unauthorized');assert.equal((await compare()).code,'unauthorized');assert.equal((await exportHistory()).response.status,401)
 })
 await t.test('actual transfer isolates history by both measured and received ownership timestamps',async()=>{
  // Fixture handoff starts a fresh eligible owner; subsequent transition uses the real transfer protocol.
  sql(`UPDATE ownership SET end_at=clock_timestamp() WHERE id=${q(own)}; INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(b.id)});`)
  assert.deepEqual((await read({},b.token)).readings,[]);assert((await compare({},b.token)).sensors.every(s=>s.first.total_count===0&&s.second.total_count===0))
  const c=await account('recipient'),offer=await rpc('create_transfer_offer',b.token,{p_product_id:product});assert.equal(offer.ok,true)
  assert.equal((await rpc('accept_transfer',c.token,{p_serial:serial,p_code:offer.code})).ok,true)
  assert.equal((await read({},b.token)).code,'unit_unavailable');assert.equal((await compare({},b.token)).code,'unit_unavailable');assert.deepEqual((await read({},c.token)).readings,[])
  assert.equal((await exportHistory(b.token)).response.status,403)
  const empty=await exportHistory(c.token);assert.equal(empty.response.status,200);assert.equal(empty.response.headers.get('x-history-row-count'),'0');assert.equal(empty.text.trimEnd().split('\r\n').length,1)
  // A post-transfer receipt whose observed timestamp predates ownership remains hidden.
  await send(0,60,60);assert.deepEqual((await read({},c.token)).readings,[])
  assert.equal(sql(`SELECT count(*) FROM measurement WHERE unit_id=${q(unit)}`),'21')
 })
})
