import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

// Runs ONLY against the isolated loopback stack created by npm run backend:local.
const url = 'http://127.0.0.1:54321'
const config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'], { input, encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim()
async function api(path, token=config.anon, body, method='POST') {
  const response = await fetch(url+path, {method,headers:{apikey:config.anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)})
  const result = await response.json().catch(()=>null)
  return {status:response.status,data:result}
}
async function rpc(name, token, body={}) { return api('/rest/v1/rpc/'+name,token,body) }
const run = randomUUID().slice(0,8)
const password = randomBytes(20).toString('base64url')
async function signup(label) {
  const email = `${label}-${run}@example.test`
  const result = await api('/auth/v1/signup',config.anon,{email,password})
  assert.equal(result.status,200,'Real Auth signup must succeed')
  assert.equal(typeof result.data.access_token,'string','Expected autoconfirm in local development Auth')
  return {email,token:result.data.access_token,id:result.data.user.id}
}
function product(label) {
  const id=randomUUID(), deviceId=randomUUID(), serial=`TEST-${run}-${label}`.toUpperCase(), code=randomBytes(24).toString('base64url')
  const keys=generateKeyPairSync('ed25519'), publicKey=keys.publicKey.export({format:'jwk'}).x
  const raw=Buffer.from(publicKey,'base64url').toString('base64')
  sql(`INSERT INTO public.product(id,serial_public,variant,issuer_signature) VALUES(${q(id)},${q(serial)},'single_pot','local-test-provisioning'); INSERT INTO public.device(id,product_id,public_key) VALUES(${q(deviceId)},${q(id)},${q(raw)}); INSERT INTO public.activation(product_id,secret_hash) VALUES(${q(id)},encode(digest(${q(code)},'sha256'),'hex'));`)
  return {id,deviceId,serial,code,keys,raw}
}
async function challenge(p, token) {
  const result=await rpc('issue_activation_nonce',token,{p_serial:p.serial})
  assert.equal(result.status,200); assert.equal(result.data.ok,true)
  return result.data
}
const signature=(p,n)=>sign(null,Buffer.from(n.challenge),p.keys.privateKey).toString('base64')
const claim=(p,n,token,code=p.code,sig=signature(p,n))=>api('/functions/v1/product-claim',token,{nonce_id:n.nonce_id,sealed_code:code,signature:sig})
const count=(table,where)=>Number(sql(`SELECT count(*) FROM public.${table} WHERE ${where};`))

await test('Phase 1: real Auth + PostgreSQL + PostgREST + Ed25519',async t=>{
  const first=await signup('owner-a'), second=await signup('owner-b')
  const a=await rpc('ensure_my_account',first.token), b=await rpc('ensure_my_account',second.token)
  assert.equal(a.data.ok,true);assert.equal(b.data.ok,true)
  await t.test('account retry is idempotent; roles remain server controlled; all tables have RLS',async()=>{
    assert.equal((await rpc('ensure_my_account',first.token)).data.account.id,a.data.account.id)
    assert.deepEqual(a.data.account.access_roles,['owner'])
    assert.equal(Number(sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;")),0)
    const own=await api('/rest/v1/account?select=id,access_roles',first.token,undefined,'GET')
    assert.equal(own.status,200);assert.equal(own.data.length,1);assert.equal(own.data[0].id,a.data.account.id)
    const other=await api(`/rest/v1/account?id=eq.${b.data.account.id}`,first.token,undefined,'GET')
    assert.deepEqual(other.data,[])
    assert.equal((await api('/rest/v1/account',first.token,{auth_subject:'forged',display_name:'bad',access_roles:['operator']})).status,403)
    assert.equal((await api('/rest/v1/activation?select=secret_hash',first.token,undefined,'GET')).status,403)
    assert.equal((await api('/rest/v1/outbox_job?select=*',config.anon,undefined,'GET')).status,401)
    assert.equal((await rpc('claim_verified_product',first.token,{p_nonce_id:randomUUID(),p_auth_user_id:first.id,p_session_id:randomUUID(),p_public_key:'forged',p_sealed_code:'bad'})).status,403)
  })
  await t.test('invalid JWT, cross-account/session and forged signatures fail',async()=>{
    const p=product('proof'), n=await challenge(p,first.token)
    assert.equal((await claim(p,n,'invalid.token.value')).status,401)
    assert.equal((await claim(p,n,second.token)).status,403)
    const login=await api('/auth/v1/token?grant_type=password',config.anon,{email:first.email,password})
    assert.equal(login.status,200)
    assert.equal((await claim(p,n,login.data.access_token)).status,403)
    assert.equal((await claim(p,n,first.token,p.code,Buffer.alloc(64).toString('base64'))).status,403)
    const altered={...n,challenge:n.challenge+'tampered'}
    assert.equal((await claim(p,n,first.token,p.code,signature(p,altered))).status,403)
    assert.equal(count('ownership',`product_id=${q(p.id)}`),0)
  })
  await t.test('wrong-code attempts commit; nonce cap holds; new challenge can recover',async()=>{
    const p=product('wrong-code'), n=await challenge(p,first.token)
    for(let i=0;i<5;i++)assert.equal((await claim(p,n,first.token,'wrong')).data.code,'invalid_code')
    assert.equal(sql(`SELECT failed_attempts FROM activation WHERE product_id=${q(p.id)}`),'5')
    assert.equal((await claim(p,n,first.token)).data.code,'nonce_exhausted')
    assert.equal(count('ownership',`product_id=${q(p.id)}`),0)
    const fresh=await challenge(p,first.token)
    assert.equal((await claim(p,fresh,first.token)).status,200)
  })
  await t.test('parallel claims yield one owner/outbox; same request retry is idempotent',async()=>{
    const p=product('parallel'), n1=await challenge(p,first.token),n2=await challenge(p,second.token)
    const results=await Promise.all([claim(p,n1,first.token),claim(p,n2,second.token)])
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409])
    assert.equal(count('ownership',`product_id=${q(p.id)} AND end_at IS NULL`),1)
    const winner=results[0].status===200?{user:first,n:n1}:{user:second,n:n2}
    const retry=await claim(p,winner.n,winner.user.token)
    assert.equal(retry.status,200);assert.equal(retry.data.idempotent,true)
    assert.equal(count('outbox_job',`event_key='claim:'||${q(retry.data.ownership_id)}`),1)
    const mine=await rpc('my_products',winner.user.token)
    assert.ok(mine.data.products.some(x=>x.product_id===p.id))
    const loser=winner.user===first?second:first
    assert.equal((await rpc('my_products',loser.token)).data.products.some(x=>x.product_id===p.id),false)
    assert.deepEqual((await api(`/rest/v1/ownership?product_id=eq.${p.id}`,loser.token,undefined,'GET')).data,[])
    const artifact=sql(`SELECT artifact_bytes FROM outbox_job WHERE event_key='claim:'||${q(retry.data.ownership_id)}`)
    for(const secret of [first.email,first.id,second.email,second.id,p.code])assert.equal(artifact.includes(secret),false)
    assert.equal(sql(`SELECT (artifact_bytes::jsonb->>'commitment')=encode(digest(private_payload,'sha256'),'hex') AND artifact_sha256=encode(digest(artifact_bytes,'sha256'),'hex') FROM outbox_job WHERE event_key='claim:'||${q(retry.data.ownership_id)}`),'t')
  })
  await t.test('expired nonce, revoked device/product, and changed key are rejected',async()=>{
    for(const state of ['expired','device','product','key']){
      const p=product(state),n=await challenge(p,first.token)
      if(state==='expired')sql(`UPDATE activation_nonce SET created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' WHERE id=${q(n.nonce_id)}`)
      if(state==='device')sql(`UPDATE device SET status='revoked' WHERE id=${q(p.deviceId)}`)
      if(state==='product')sql(`UPDATE product SET registry_status='revoked' WHERE id=${q(p.id)}`)
      if(state==='key')sql(`UPDATE device SET public_key=${q(randomBytes(32).toString('base64'))} WHERE id=${q(p.deviceId)}`)
      const result=await claim(p,n,first.token)
      assert.ok(result.status>=400 && result.status<500)
      assert.equal(count('ownership',`product_id=${q(p.id)}`),0)
    }
  })
  await t.test('outbox insertion failure rolls back code, nonce and ownership',async()=>{
    const p=product('rollback'),n=await challenge(p,first.token)
    sql(`CREATE FUNCTION public.phase1_test_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM public.ownership o WHERE NEW.event_key='claim:'||o.id::text AND o.product_id=${q(p.id)}::uuid) THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER phase1_test_outbox BEFORE INSERT ON public.outbox_job FOR EACH ROW EXECUTE FUNCTION public.phase1_test_reject_outbox();`)
    try{
      assert.equal((await claim(p,n,first.token)).status,503)
      assert.equal(count('ownership',`product_id=${q(p.id)}`),0)
      assert.equal(sql(`SELECT consumed_at IS NULL FROM activation WHERE product_id=${q(p.id)}`),'t')
      assert.equal(sql(`SELECT consumed_at IS NULL FROM activation_nonce WHERE id=${q(n.nonce_id)}`),'t')
    }finally{sql('DROP TRIGGER phase1_test_outbox ON public.outbox_job; DROP FUNCTION public.phase1_test_reject_outbox();')}
    assert.equal((await claim(p,n,first.token)).status,200)
  })
  await t.test('nonce issuance is rate limited under parallel requests',async()=>{
    const p=product('limited')
    const results=await Promise.all(Array.from({length:8},()=>rpc('issue_activation_nonce',first.token,{p_serial:p.serial})))
    assert.equal(results.filter(x=>x.data.ok).length,5)
    assert.equal(results.filter(x=>x.data.code==='rate_limited').length,3)
  })
  await t.test('logout revokes account reads and pending proofs despite unexpired access token',async()=>{
    const p=product('logout'),n=await challenge(p,second.token)
    assert.equal((await api('/auth/v1/logout?scope=local',second.token,{})).status,204)
    assert.deepEqual((await api('/rest/v1/account?select=id',second.token,undefined,'GET')).data,[])
    assert.equal((await rpc('ensure_my_account',second.token)).data.ok,false)
    assert.equal((await rpc('my_products',second.token)).data.ok,false)
    assert.equal((await rpc('issue_activation_nonce',second.token,{p_serial:p.serial})).data.code,'invalid_session')
    assert.ok((await claim(p,n,second.token)).status>=400)
    assert.equal(count('ownership',`product_id=${q(p.id)}`),0)
  })
  await t.test('bounded request validation; unauthenticated/foreign-origin requests denied',async()=>{
    assert.equal((await api('/functions/v1/product-claim',first.token,{nonce_id:'bad'})).status,400)
    assert.equal((await api('/functions/v1/product-claim',first.token,{text:'x'.repeat(5000)})).status,413)
    const denied=await fetch(url+'/functions/v1/product-claim',{method:'POST',headers:{Origin:'https://other.example'}})
    assert.equal(denied.status,403)
  })
})
