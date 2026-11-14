import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { enableTotp } from './totp.mjs'
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return {status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body).then(r=>r.data)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label){const r=await api('/auth/v1/signup',null,{email:`care-${run}-${label}@example.test`,password});assert.equal(r.status,200);return {token:r.data.access_token,id:(await rpc('ensure_my_account',r.data.access_token)).account.id,user:r.data.user.id}}
await test('Care journal: persistent private observations and ownership isolation',async t=>{
 const [a,b]=await Promise.all([account('owner'),account('other')]),product=randomUUID(),unit=randomUUID(),plant=randomUUID(),contribution=randomUUID(),version=randomUUID(),own=randomUUID(),serial=`CARE-${run}`.toUpperCase()
 sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q(serial)},'single_pot','Synthetic software test'); INSERT INTO ownership(id,product_id,account_id,start_at) VALUES(${q(own)},${q(product)},${q(a.id)},clock_timestamp()-interval '2 days'); INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(plant)},${q('Care '+run)},'Synthetic test'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(plant)},${q(a.id)},'Synthetic test permission','Software fixture','{}','approved'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(plant)},${q(contribution)},1,'{}','Synthetic test'); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},${q(version)},'Care fixture');`)
 const observed=new Date(Date.now()-60000).toISOString()
 const body=(overrides={})=>({p_unit_id:unit,p_request_id:randomUUID(),p_kind:'watering',p_observed_at:observed,p_amount_ml:200,p_notes:'  Checked manually  ',...overrides})
 const append=(data=body(),token=a.token)=>rpc('append_my_care_journal',token,data)
 const read=(data={},token=a.token)=>rpc('read_my_care_journal',token,{p_unit_id:unit,...data})
 let first,request
 await t.test('private RPC grants and table access; other owners and spoofed fields rejected',async()=>{
  assert((await api('/rest/v1/rpc/append_my_care_journal',null,body())).status>=400)
  assert.equal((await append(body(),b.token)).code,'unit_unavailable')
  assert.equal((await read({},b.token)).code,'unit_unavailable')
  for(const method of ['GET','POST','PATCH','DELETE'])assert((await api('/rest/v1/care_journal',a.token,method==='GET'?undefined:{notes:'spoof'},method)).status>=400)
  assert((await api('/rest/v1/rpc/append_my_care_journal',a.token,{...body(),p_account_id:b.id})).status>=400)
 })
 await t.test('idempotent concurrent append and mismatch rejection preserve original',async()=>{
  request=body();const results=await Promise.all([append(request),append(request)]);assert(results.every(r=>r.ok));assert.equal(results.filter(r=>!r.idempotent).length,1)
  first=results[0].entry;assert.equal(first.notes,'Checked manually');assert.equal(first.amount_ml,200)
  assert.equal((await append({...request,p_notes:'changed'})).code,'request_conflict')
  assert.equal((await append({...request,p_kind:'inspection',p_amount_ml:null})).code,'request_conflict')
  assert.equal(sql(`SELECT count(*) FROM care_journal WHERE request_id=${q(request.p_request_id)}`),'1')
 })
 await t.test('invalid dates, quantities, actions, notes and paging bounds fail',async()=>{
  for(const patch of [{p_observed_at:'infinity'},{p_observed_at:new Date(Date.now()+600000).toISOString()},{p_observed_at:new Date(Date.now()-3*86400000).toISOString()},{p_kind:'note',p_amount_ml:null,p_notes:' '},{p_amount_ml:0},{p_amount_ml:100001},{p_kind:'fertilizing',p_amount_ml:2},{p_kind:'actuate'},{p_notes:'x'.repeat(2001)}]) assert.equal((await append(body(patch))).code,'invalid_request')
  for(const patch of [{p_limit:0},{p_limit:101},{p_before_id:randomUUID()},{p_from:'-infinity'},{p_from:'2020-01-01',p_to:'2026-01-01'},{p_snapshot_as_of:new Date(Date.now()+60000).toISOString()}])assert.equal((await read(patch)).code,'invalid_request')
 })
 await t.test('stable tuple pages and fixed snapshot exclude subsequent backdated writes',async()=>{
  for(let i=0;i<3;i++)assert.equal((await append(body({p_kind:'inspection',p_amount_ml:null,p_notes:`Inspection ${i}`}))).ok,true)
  const page=await read({p_limit:2});assert.equal(page.entries.length,2);assert(page.next_cursor)
  assert.equal((await append(body({p_notes:'After snapshot'}))).ok,true)
  const next=await read({p_limit:2,p_snapshot_as_of:page.snapshot_as_of,p_before_observed_at:page.next_cursor.observed_at,p_before_id:page.next_cursor.id})
  assert.equal(next.entries.length,2);assert.equal(next.next_cursor,null);assert.equal(new Set([...page.entries,...next.entries].map(e=>e.id)).size,4)
  assert.equal((await read()).entries.length,5)
  assert.deepEqual((await read({p_from:observed,p_to:observed})).entries,[])
  assert.equal((await read({p_from:observed,p_to:new Date(Date.parse(observed)+1).toISOString()})).entries.length,5)
 })
 await t.test('account-wide cap exempts exact retries and flags changed payload first',async()=>{
  for(let i=5;i<20;i++)assert.equal((await append(body({p_notes:`Rate ${i}`}))).ok,true)
  assert.equal((await append()).code,'rate_limited');assert.equal((await append(request)).idempotent,true)
  const secondProduct=randomUUID(),secondUnit=randomUUID()
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(secondProduct)},${q(serial+'-SECOND')},'single_pot','Synthetic test'); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(secondProduct)},${q(a.id)},clock_timestamp()-interval '2 days'); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(secondUnit)},${q(secondProduct)},${q(version)},'Second product');`)
  assert.equal((await append(body({p_unit_id:secondUnit}))).code,'rate_limited','The quota covers every product for this account')
  assert.equal((await append({...request,p_notes:'conflict under cap'})).code,'request_conflict')
 })
 await t.test('MFA and revoked live sessions cannot read or append',async()=>{
  const old=a.token,verified=await enableTotp(base,config.anon,a.token)
  assert.equal((await read({},old)).code,'unauthorized');assert.equal((await append(body(),old)).code,'unauthorized')
  a.token=verified.token;assert.equal((await read()).ok,true)
  const sid=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url')).session_id
  sql(`DELETE FROM auth.sessions WHERE id=${q(sid)}`)
  assert.equal((await read()).code,'unauthorized');assert.equal((await append()).code,'unauthorized')
 })
 await t.test('actual transfer hides the prior epoch from both new and former owners',async()=>{
  // A separate fresh owner session is not needed to test epoch isolation: transfer RPC belongs to b after a fixture handoff.
  // End the old epoch exactly as transfer does, then use the actual transfer RPC for a second epoch transition.
  sql(`UPDATE ownership SET end_at=clock_timestamp() WHERE id=${q(own)}; INSERT INTO ownership(product_id,account_id) VALUES(${q(product)},${q(b.id)});`)
  assert.deepEqual((await read({},b.token)).entries,[])
  const fresh=body({p_observed_at:new Date().toISOString(),p_notes:'New owner',p_request_id:request.p_request_id})
  assert.equal((await append(fresh,b.token)).ok,true)
  for(const kind of ['fertilizing','note'])assert.equal((await append(body({p_kind:kind,p_amount_ml:null,p_observed_at:new Date().toISOString(),p_notes:'Manual '+kind}),b.token)).ok,true)
  assert.equal((await append(body(),b.token)).code,'invalid_request')
  const c=await account('recipient'),offer=await rpc('create_transfer_offer',b.token,{p_product_id:product});assert.equal(offer.ok,true)
  assert.equal((await rpc('accept_transfer',c.token,{p_serial:serial,p_code:offer.code})).ok,true)
  assert.equal((await read({},b.token)).code,'unit_unavailable');assert.deepEqual((await read({},c.token)).entries,[])
  assert.equal(sql(`SELECT count(*) FROM care_journal WHERE ownership_id=${q(own)}`),'20')
 })
})