import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {enableTotp} from './totp.mjs'
// knowledge_workspace (KB-01..04) against local Auth/PostgREST/PostgreSQL: a curator's contributions must come with the
// names of the profiles they belong to, even when the catalogue holds more than one page (100) of profiles.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body){const r=await fetch(base+path,{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const run=randomUUID().slice(0,8),password=randomBytes(20).toString('base64url')

await test('KB: contributions keep their profile names past the first page of profiles',async()=>{
 const r=await api('/auth/v1/signup',null,{email:`kw-${run}@example.test`,password});assert.equal(r.status,200)
 const a=await api('/rest/v1/rpc/ensure_my_account',r.data.access_token,{});assert.equal(a.data.ok,true)
 sql(`UPDATE account SET access_roles=ARRAY['owner','curator'] WHERE id=${q(a.data.account.id)}`)
 const {token}=await enableTotp(base,config.anon,r.data.access_token)
 // 101 profiles that sort before the one under review, so a plain name-ordered page of 100 would miss it.
 const late=randomUUID(),contribution=randomUUID()
 sql(`INSERT INTO plant_profile(species_variety,context_scope) SELECT ${q(`!aaa ${run} `)}||g,'Synthetic fixture' FROM generate_series(1,101) g;
  INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(late)},${q(`zzz late ${run}`)},'Synthetic fixture');
  INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(late)},${q(a.data.account.id)},'Test-only','local://kw','{}','pending_review');`)
 const w=(await api('/rest/v1/rpc/knowledge_workspace',token,{})).data
 assert.equal(w.ok,true);assert.ok(w.roles.includes('curator'),'curator role active in the 2FA session')
 assert.ok(w.contributions.some(c=>c.id===contribution))
 assert.equal(w.profiles.find(p=>p.id===late)?.species_variety,`zzz late ${run}`)
 assert.ok(w.profiles.length<=100,'the page keeps the client contract of at most 100 profiles')
 assert.ok(w.profiles.every(p=>!('referenced' in p)),'the ordering helper column is not exposed')
})
