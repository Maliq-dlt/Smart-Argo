import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,generateKeyPairSync,sign,verify,createPrivateKey,createPublicKey,createHash,createHmac} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {enableTotp} from './totp.mjs'
// ID-01 / ID-04 against the local gateway, Auth, PostgREST and PostgreSQL: products are provisioned only from
// manifests signed by a pinned issuer key, through the operator's own gated session; public status exposes the
// manifest and signature for independent verification. The issuer key is the local test key in .tmp/phase1.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8')),issuer=JSON.parse(await readFile('.tmp/phase1/issuer.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
async function api(path,token,body,method='POST'){const r=await fetch(base+path,{method,headers:{apikey:config.anon,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json().catch(()=>null)}}
const rpc=(name,token,body={})=>api('/rest/v1/rpc/'+name,token,body)
const run=randomUUID().slice(0,8).toUpperCase(),password=randomBytes(20).toString('base64url')
async function account(label,roles=['owner']){const r=await api('/auth/v1/signup',null,{email:`provision-${run}-${label}@example.test`.toLowerCase(),password});assert.equal(r.status,200);const a=await rpc('ensure_my_account',r.data.access_token);assert.equal(a.data.ok,true);sql(`UPDATE account SET access_roles=ARRAY[${roles.map(q).join(',')}]::text[] WHERE id=${q(a.data.account.id)}`);return{token:r.data.access_token,id:a.data.account.id}}
const issuerKey=createPrivateKey(issuer.private_key_pem)
const deviceKey=()=>Buffer.from(generateKeyPairSync('ed25519').publicKey.export({format:'jwk'}).x,'base64url').toString('base64')
const manifest=(serial,keys,extra={})=>JSON.stringify({schema:'smart-agro.product-manifest.v1',serial_public:serial,variant:keys.length>1?'garden':'single_pot',device_public_keys:keys,issued_at:'2026-11-14T00:00:00.000Z',issuer_key_id:issuer.key_id,...extra})
const signWith=(key,text)=>sign(null,Buffer.from(text),key).toString('base64')
const code=()=>randomBytes(16).toString('hex'),hash=text=>createHash('sha256').update(text).digest('hex')
const provision=(token,text,signature=signWith(issuerKey,text),request=randomUUID(),secret=hash(code()))=>api('/functions/v1/product-provision',token,{request_id:request,manifest:text,signature,activation_secret_hash:secret})
function forge(token,patch){const [head,body]=token.split('.');const data=head+'.'+Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body,'base64url')),...patch})).toString('base64url');return data+'.'+createHmac('sha256',config.secret).update(data).digest('base64url')}

await test('ID-04: issuer-signed provisioning',async t=>{
 const operator=await account('operator',['owner','operator']),owner=await account('owner')
 operator.token=(await enableTotp(base,config.anon,operator.token)).token
 const serial=`SA-${run}-01`,keys=[deviceKey()],text=manifest(serial,keys)
 await t.test('only a manifest signed by a pinned issuer key is accepted',async()=>{
  assert.equal((await provision(operator.token,manifest(`SA-${run}-X`,[deviceKey()],{issuer_key_id:'someone-else'}))).data.code,'unknown_issuer')
  const forged=await provision(operator.token,text,signWith(generateKeyPairSync('ed25519').privateKey,text))
  assert.equal(forged.status,400);assert.equal(forged.data.code,'invalid_signature')
  assert.equal(sql(`SELECT count(*) FROM product WHERE serial_public=${q(serial)}`),'0')
 })
 await t.test('the operator gate applies to the person, and the RPC refuses unattested manifests',async()=>{
  assert.equal((await provision(owner.token,text)).data.code,'forbidden')
  const stale=forge(operator.token,{amr:JSON.parse(Buffer.from(operator.token.split('.')[1],'base64url')).amr.map(m=>m.method==='totp'?{...m,timestamp:m.timestamp-600}:m)})
  // Same session, but the authenticator code is ten minutes old: the database gate still sees the person's token.
  const late=await provision(stale,text);assert.equal(late.status,403);assert.equal(late.data.code,'step_up_required')
  const unsigned=manifest(`SA-${run}-02`,[deviceKey()])
  const direct=await rpc('operator_provision_product',operator.token,{p_request_id:randomUUID(),p_manifest:unsigned,p_signature:signWith(issuerKey,unsigned).replace(/^./,'A'),p_activation_secret_hash:hash('x')})
  assert.equal(direct.data.code,'manifest_unverified')
 })
 let productId
 await t.test('a valid manifest registers product, activation, devices, audit and outbox once',async()=>{
  const request=randomUUID(),secret=hash(code()),signature=signWith(issuerKey,text)
  const done=await provision(operator.token,text,signature,request,secret)
  assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.devices,1);productId=done.data.product_id
  assert.equal((await provision(operator.token,text,signature,request,secret)).data.idempotent,true)
  assert.equal((await provision(operator.token,text,signature,request,hash('other'))).data.code,'request_conflict')
  assert.equal((await provision(operator.token,text,signature,randomUUID(),secret)).data.code,'serial_taken')
  assert.equal((await provision(operator.token,manifest(`SA-${run}-03`,keys))).data.code,'key_in_use')
  assert.equal(sql(`SELECT registry_status||'/'||variant FROM product WHERE id=${q(productId)}`),'active/single_pot')
  assert.equal(sql(`SELECT secret_hash FROM activation WHERE product_id=${q(productId)} AND consumed_by IS NULL`),secret)
  assert.equal(sql(`SELECT public_key FROM device WHERE product_id=${q(productId)}`),keys[0])
  assert.equal(sql(`SELECT artifact_bytes=${q(text)} AND kind='product_manifest' FROM outbox_job WHERE event_key='manifest:${productId}'`),'t')
  assert.equal(sql(`SELECT action FROM registry_event WHERE product_id=${q(productId)}`),'provision_product')
 })
 await t.test('invalid manifest shapes are refused even when signed',async()=>{
  for(const bad of [manifest(`SA-${run}-04`,[deviceKey(),deviceKey()],{variant:'single_pot'}),manifest(`sa-lower-${run}`,[deviceKey()]),
   manifest(`SA-${run}-05`,['not-a-key']),manifest(`SA-${run}-06`,[deviceKey()],{extra:true}),manifest(`SA-${run}-07`,[deviceKey()],{device_public_keys:'x'})]){
   const r=await provision(operator.token,bad);assert.equal(r.status,400,bad);assert.equal(r.data.code,'invalid_manifest',bad)
  }
  assert.equal((await provision(operator.token,'[1,2]')).data.code,'invalid_request')
 })
 await t.test('public status exposes the signed manifest for independent verification',async()=>{
  const status=(await rpc('product_public_status',null,{p_serial:serial.toLowerCase()})).data
  assert.equal(status.issuer_verified,true);assert.equal(status.manifest,text);assert.equal(status.issuer_key_id,issuer.key_id)
  const publicKey=createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:Buffer.from(issuer.public_key,'base64').toString('base64url')},format:'jwk'})
  assert.equal(verify(null,Buffer.from(status.manifest),publicKey,Buffer.from(status.issuer_signature,'base64')),true)
  const legacy=randomUUID();sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(legacy)},'LEGACY-${run}','single_pot','synthetic DB test')`)
  const old=(await rpc('product_public_status',null,{p_serial:'LEGACY-'+run})).data
  assert.equal(old.issuer_verified,false);assert.equal(old.manifest,null);assert.equal(old.issuer_signature,null)
 })
})
