import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {enableTotp} from './totp.mjs'
// ID-03 recovery (U03, A04) against local Auth/PostgREST/PostgreSQL: a claimant asks for a product with evidence
// references, the current owner is told without the claimant's identity, and an operator who is not a party
// decides. Approval moves ownership atomically like an accepted transfer.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')
async function account(label,roles=['owner']){const r=await api('/auth/v1/signup',null,{email:`recovery-${run}-${label}@example.test`,password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`);return{token:r.data.access_token,id:a.data.account.id,user:r.data.user.id}}
/** A product first activated and owned by `first`, now owned by `current` (or nobody). */
function product(first,current){const id=randomUUID(),serial=('REC-'+id.slice(0,8)).toUpperCase();sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q(serial)},'single_pot','synthetic DB test');
 INSERT INTO activation(product_id,secret_hash,consumed_by,consumed_at) VALUES(${q(id)},'x',${q(first.id)},clock_timestamp()-interval '30 days');
 INSERT INTO ownership(product_id,account_id,start_at,end_at) VALUES(${q(id)},${q(first.id)},clock_timestamp()-interval '30 days',${current?"clock_timestamp()-interval '10 days'":'NULL'});
 ${current?`INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(id)},${q(current.id)},clock_timestamp()-interval '10 days');`:''}`);return{id,serial}}
const statement='Saya membeli pot ini dan mengaktifkannya, lalu kehilangan akses akun lama.'
const evidence=[{kind:'receipt',reference:'INV-2026-0042'},{kind:'photo',reference:'foto label serial',sha256:'a'.repeat(64)}]

await test('ID-03: ownership recovery through an operator',async t=>{
 const operator=await account('operator',['owner','operator']),second=await account('second',['owner','operator'])
 const alice=await account('alice'),bob=await account('bob'),carol=await account('carol'),dave=await account('dave')
 operator.token=(await enableTotp(base,config.anon,operator.token)).token
 second.token=(await enableTotp(base,config.anon,second.token)).token
 const lost=product(alice,bob),operatorOwned=product(carol,operator)
 sql(`INSERT INTO ownership_transfer(product_id,from_ownership_id,code_hash,expires_at) SELECT ${q(lost.id)},id,'h',clock_timestamp()+interval '1 day' FROM ownership WHERE product_id=${q(lost.id)} AND end_at IS NULL`)
 let caseId,carolCase
 await t.test('a claimant opens one idempotent case with valid evidence references',async()=>{
  const request=randomUUID(),body={p_request_id:request,p_serial:lost.serial.toLowerCase(),p_statement:statement,p_evidence:evidence}
  const first=(await rpc('open_ownership_recovery',alice.token,body)).data
  assert.equal(first.ok,true);assert.equal(first.idempotent,false);caseId=first.case_id
  assert.equal((await rpc('open_ownership_recovery',alice.token,body)).data.idempotent,true)
  assert.equal((await rpc('open_ownership_recovery',alice.token,{...body,p_statement:statement+' Lagi.'})).data.code,'request_conflict')
  assert.equal((await rpc('open_ownership_recovery',alice.token,{...body,p_request_id:randomUUID()})).data.code,'case_open')
  assert.equal((await rpc('open_ownership_recovery',bob.token,{...body,p_request_id:randomUUID()})).data.code,'already_owner')
  assert.equal((await rpc('open_ownership_recovery',dave.token,{...body,p_request_id:randomUUID(),p_serial:'NOPE-000'})).data.code,'product_unavailable')
  for(const bad of [[1],[{kind:'receipt'}],[{kind:'receipt',reference:'x',extra:1}],[{kind:'selfie',reference:'x'}],[{kind:'photo',reference:'x',sha256:'XYZ'}]])
   assert.equal((await rpc('open_ownership_recovery',dave.token,{...body,p_request_id:randomUUID(),p_evidence:bad})).data.code,'invalid_request',JSON.stringify(bad))
  assert.equal((await rpc('open_ownership_recovery',dave.token,{...body,p_request_id:randomUUID(),p_statement:'Terlalu pendek'})).data.code,'invalid_request')
 })
 await t.test('the current owner is told, without the claimant identity',async()=>{
  const events=sql(`SELECT detail FROM security_event WHERE user_id=${q(bob.user)} AND kind='recovery_requested'`)
  assert.equal(events,`${lost.serial} · ditinjau operator`)
  assert.equal((await rpc('my_ownership_recoveries',alice.token)).data.cases[0].status,'open')
 })
 await t.test('operators see the deciding facts and cannot judge their own product',async()=>{
  assert.equal((await rpc('operator_recovery_cases',alice.token)).data.code,'forbidden')
  const row=(await rpc('operator_recovery_cases',operator.token,{p_status:'open'})).data.cases.find(c=>c.id===caseId)
  assert.equal(row.claimant_activated,true);assert.equal(row.claimant_past_owner,true);assert.equal(row.owner_account_id,bob.id);assert.equal(row.owner_has_2fa,false)
  carolCase=(await rpc('open_ownership_recovery',carol.token,{p_request_id:randomUUID(),p_serial:operatorOwned.serial,p_statement:statement,p_evidence:[]})).data.case_id
  assert.equal((await rpc('operator_take_recovery_case',operator.token,{p_case_id:carolCase,p_request_id:randomUUID()})).data.code,'self_review')
 })
 await t.test('approval moves ownership atomically and closes the old owner out',async()=>{
  const take=randomUUID()
  assert.equal((await rpc('operator_take_recovery_case',operator.token,{p_case_id:caseId,p_request_id:take})).data.status,'in_review')
  assert.equal((await rpc('operator_take_recovery_case',operator.token,{p_case_id:caseId,p_request_id:take})).data.idempotent,true)
  assert.equal((await rpc('operator_decide_recovery_case',second.token,{p_case_id:caseId,p_request_id:randomUUID(),p_decision:'approved',p_reason:'x'})).data.code,'state_conflict')
  const body={p_case_id:caseId,p_request_id:randomUUID(),p_decision:'approved',p_reason:'Kuitansi dan aktivasi awal cocok dengan pemohon.'}
  const done=(await rpc('operator_decide_recovery_case',operator.token,body)).data
  assert.equal(done.status,'approved');assert.ok(done.ownership_id)
  assert.equal((await rpc('operator_decide_recovery_case',operator.token,body)).data.idempotent,true)
  assert.equal((await rpc('operator_decide_recovery_case',operator.token,{...body,p_decision:'rejected'})).data.code,'request_conflict')
  assert.equal(sql(`SELECT a.id FROM ownership o JOIN account a ON a.id=o.account_id WHERE o.product_id=${q(lost.id)} AND o.end_at IS NULL`),alice.id)
  assert.equal(sql(`SELECT count(*) FROM ownership WHERE product_id=${q(lost.id)} AND end_at IS NULL`),'1')
  assert.equal(sql(`SELECT status FROM ownership_transfer WHERE product_id=${q(lost.id)}`),'cancelled')
  assert.equal(sql(`SELECT kind FROM outbox_job WHERE event_key='recovery:${caseId}'`),'ownership_transfer')
  assert.equal(sql(`SELECT count(*) FROM outbox_job WHERE event_key='recovery:${caseId}' AND (artifact_bytes LIKE '%${alice.id}%' OR artifact_bytes LIKE '%${lost.id}%')`),'0','public artifact holds only a commitment')
  assert.equal((await rpc('my_products',bob.token)).data.products.some(p=>p.product_id===lost.id),false)
  assert.equal((await rpc('my_products',alice.token)).data.products.some(p=>p.product_id===lost.id),true)
  assert.equal(sql(`SELECT count(*) FROM security_event WHERE kind='recovery_decided' AND user_id IN (${q(alice.user)},${q(bob.user)})`),'2')
 })
 await t.test('rejection keeps ownership, withdrawal works only while open, and the trail is append-only',async()=>{
  assert.equal((await rpc('operator_take_recovery_case',second.token,{p_case_id:carolCase,p_request_id:randomUUID()})).data.status,'in_review')
  assert.equal((await rpc('operator_decide_recovery_case',second.token,{p_case_id:carolCase,p_request_id:randomUUID(),p_decision:'rejected',p_reason:'Pemilik sekarang memegang kuitansi asli.'})).data.status,'rejected')
  assert.equal(sql(`SELECT a.id FROM ownership o JOIN account a ON a.id=o.account_id WHERE o.product_id=${q(operatorOwned.id)} AND o.end_at IS NULL`),operator.id)
  assert.equal((await rpc('my_ownership_recoveries',carol.token)).data.cases[0].decision_reason,'Pemilik sekarang memegang kuitansi asli.')
  const opened=(await rpc('open_ownership_recovery',dave.token,{p_request_id:randomUUID(),p_serial:operatorOwned.serial,p_statement:statement,p_evidence:[]})).data.case_id
  assert.equal((await rpc('withdraw_ownership_recovery',dave.token,{p_case_id:opened})).data.status,'withdrawn')
  assert.equal((await rpc('withdraw_ownership_recovery',dave.token,{p_case_id:opened})).data.idempotent,true)
  assert.equal((await rpc('withdraw_ownership_recovery',carol.token,{p_case_id:carolCase})).data.code,'state_conflict')
  assert.equal((await rpc('withdraw_ownership_recovery',alice.token,{p_case_id:opened})).data.code,'case_unavailable')
  assert.throws(()=>sql(`DELETE FROM ownership_recovery_event WHERE case_id=${q(caseId)}`),/append-only/)
  assert.notEqual((await api('/rest/v1/ownership_recovery_case?select=id',alice.token,undefined,'GET')).status,200)
 })
})
