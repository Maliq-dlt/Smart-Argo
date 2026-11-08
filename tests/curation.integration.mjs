import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const url='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){
 const r=await fetch(url+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
 return {status:r.status,data:await r.json().catch(()=>null)}
}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,roles){
 const r=await api('/auth/v1/signup',null,{email:`curation-${run}-${label}@example.test`,password});assert.equal(r.status,200)
 const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true)
 sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`)
 return {token:r.data.access_token,id:a.data.account.id}
}
// Explicit synthetic software fixture, never asserted as agronomically calibrated.
const parameters={pot_id:'synthetic-test-target',crop:'Synthetic crop',media:'Test medium',phase:'Test phase',validated:false,ph_validated:false,needs_water:[30,35,40],drained:[70,75,80],next_visit_h:6,hot_c:35,ph_range:[5.5,7]}
const submission=(overrides={})=>({p_profile_id:null,p_species:`Synthetic curation fixture ${run}`,p_scope:'Software integration test only; not field validated',p_source_license:'Synthetic test data; permission granted for software testing',p_evidence_ref:'tests/curation.integration.mjs',p_parameters:parameters,p_permission:true,...overrides})
await test('Phase 3: permissioned profile curation against real Auth/PostgreSQL',async t=>{
 const author=await account('author',['owner','contributor','curator']),curator=await account('curator',['owner','curator']),owner=await account('owner',['owner']),other=await account('other',['contributor'])
 let contribution,profile,version
 await t.test('contributor role, sharing permission and exact numeric profile validation',async()=>{
  assert.equal((await rpc('submit_profile_contribution',owner.token,submission())).data.code,'forbidden')
  for(const extra of [{p_permission:false},{p_parameters:{...parameters,hot_c:61}},{p_parameters:{...parameters,drained:[35,36,37]}},{p_parameters:{...parameters,extra:true}}]) assert.equal((await rpc('submit_profile_contribution',author.token,submission(extra))).data.code,'invalid_contribution')
  const r=await rpc('submit_profile_contribution',author.token,submission());assert.equal(r.data.ok,true);contribution=r.data.contribution_id;profile=r.data.profile_id
  assert.equal(sql(`SELECT count(*) FROM contribution_revision WHERE contribution_id=${q(contribution)}`),'1')
 })
 const review=(who,decision='approved',revision=1)=>rpc('review_profile_contribution',who.token,{p_id:contribution,p_revision:revision,p_decision:decision,p_reason:'Synthetic integration review; no field validation',p_evidence_level:'Synthetic software fixture only'})
 await t.test('self-approval and unauthorized review fail; private queue isolated',async()=>{
  assert.equal((await review(author)).data.code,'self_review');assert.equal((await review(owner)).data.code,'forbidden')
  assert.equal((await rpc('knowledge_workspace',other.token)).data.contributions.some(c=>c.id===contribution),false)
  assert.equal((await rpc('knowledge_workspace',curator.token)).data.contributions.some(c=>c.id===contribution),true)
  const raw=await api('/rest/v1/contribution?id=eq.'+contribution,other.token,undefined,'GET');assert.equal(raw.status,200);assert.deepEqual(raw.data,[])
 })
 await t.test('needs-revision author workflow preserves immutable revision history',async()=>{
  assert.equal((await review(curator,'needs_revision')).data.ok,true)
  const body={p_id:contribution,p_revision:1,p_source_license:'Synthetic permitted test revision',p_evidence_ref:'tests/curation.integration.mjs#revision',p_parameters:{...parameters,next_visit_h:5},p_permission:true}
  assert.equal((await rpc('revise_profile_contribution',other.token,body)).data.code,'forbidden')
  assert.equal((await rpc('revise_profile_contribution',author.token,{...body,p_revision:2})).data.code,'revision_conflict')
  assert.equal((await rpc('revise_profile_contribution',author.token,body)).data.revision,2)
  const item=(await rpc('knowledge_workspace',author.token)).data.contributions.find(c=>c.id===contribution)
  assert.equal(item.revisions.length,2);assert.equal(item.revisions[0].proposed_parameters.next_visit_h,6)
  assert.equal(item.latest_review.revision,1)
 })
 await t.test('concurrent approval has one winner and one immutable published version',async()=>{
  const results=await Promise.all([review(curator,'approved',2),review(curator,'approved',2)])
  assert.equal(results.filter(r=>r.data.ok).length,1);assert.equal(results.filter(r=>r.data.code==='revision_conflict').length,1)
  version=results.find(r=>r.data.ok).data.profile_version_id
  assert.equal(sql(`SELECT count(*) FROM profile_version WHERE contribution_id=${q(contribution)}`),'1')
  const details=(await rpc('published_profile_details',owner.token,{p_version_id:version})).data
  assert.equal(details.ok,true);assert.equal(details.profile.parameters_and_scope.pot_id,parameters.pot_id);assert.equal(details.profile.parameters_and_scope.next_visit_h,5)
  assert.equal(details.profile.profile_id,profile)
  assert.equal(details.profile.provenance_status,'pinned')
  sql(`UPDATE contribution SET source_method_license='Changed mutable draft source',evidence_ref='Changed mutable draft evidence' WHERE id=${q(contribution)}; UPDATE plant_profile SET context_scope='Changed mutable profile scope' WHERE id=${q(profile)};`)
  const pinned=(await rpc('published_profile_details',owner.token,{p_version_id:version})).data.profile
  assert.equal(pinned.source_method_license,details.profile.source_method_license)
  assert.equal(pinned.evidence_ref,details.profile.evidence_ref)
  assert.equal(pinned.context_scope,details.profile.context_scope)

  for(const table of ['profile_version','review','contribution_revision']){
   const where=table==='profile_version'?`id=${q(version)}`:`contribution_id=${q(contribution)}`
   assert.throws(()=>sql(`DELETE FROM ${table} WHERE ${where}`),/immutable/)
  }
 })
 await t.test('published profile assignment owner-only; calibration binding enforced',async()=>{
  const prod=randomUUID(),unit=randomUUID()
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(prod)},${q('CUR-'+run)},'single_pot','synthetic test'); INSERT INTO ownership(product_id,account_id) VALUES(${q(prod)},${q(owner.id)}); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(prod)},${q(version)},'Synthetic test unit');`)
  const body={p_unit_id:unit,p_profile_version_id:version}
  assert.equal((await rpc('assign_unit_profile',other.token,body)).data.code,'unit_unavailable')
  assert.equal((await rpc('assign_unit_profile',owner.token,body)).data.ok,true)
  // Privileged fixture simulates a separately calibrated immutable version for another unit.
  const bound=randomUUID()
  sql(`INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(bound)},${q(profile)},${q(contribution)},2,${q(JSON.stringify({...parameters,validated:true,pot_id:randomUUID()}))}::jsonb,'Synthetic binding test only');`)
  assert.equal((await rpc('assign_unit_profile',owner.token,{...body,p_profile_version_id:bound})).data.code,'calibration_mismatch')
 })
 await t.test('signed-out session cannot access workspace or publish',async()=>{
  const out=await api('/auth/v1/logout?scope=local',curator.token,{});assert.ok([200,204].includes(out.status))
  assert.equal((await rpc('knowledge_workspace',curator.token)).data.code,'unauthorized')
  assert.equal((await review(curator,'approved',2)).data.code,'unauthorized')
 })
})
