import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {runOnce,rpcClients} from '../scripts/chain-worker.mjs'
// A08 against local PostgREST/PostgreSQL with an in-process stand-in for the chain node: leases, send once, receipt
// matching (chain, signer, destination, hash), mismatch, revert, retry limits and the owner's proof view.
// The chain stand-in is not a blockchain; it only answers the JSON-RPC methods the worker uses.
const base='http://127.0.0.1:54321',config=JSON.parse(await readFile('.tmp/phase1/settings.json','utf8'))
const q=v=>"'"+String(v).replaceAll("'","''")+"'"
const sql=input=>execFileSync('docker',['exec','-i','smart-agro-phase1-db-1','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const chainId=31337000+Math.floor(Math.random()*999),signer='0x'+randomBytes(20).toString('hex'),contract='0x'+randomBytes(20).toString('hex')
const {db}=rpcClients({supabaseUrl:base,serviceKey:config.service,chainUrl:'unused'})
/** Stand-in node: remembers sent transactions; `receipts` and `tamper` script what it answers per artifact hash. */
function node(){const txs=new Map(),sends=[],receipts=new Map(),tamper=new Map(),failSend=new Set()
 return{sends,receipts,tamper,failSend,chain:async(method,params)=>{
  if(method==='eth_chainId')return '0x'+chainId.toString(16)
  if(method==='eth_sendTransaction'){const tx=params[0],sha=tx.data.slice(2);if(failSend.has(sha))throw new Error('node unavailable');const hash='0x'+createHash('sha256').update(JSON.stringify(tx)+sends.length).digest('hex');sends.push(sha);txs.set(hash,{...tx,input:tx.data,chainId:'0x'+chainId.toString(16),...tamper.get(sha)});return hash}
  const tx=txs.get(params[0]),sha=tx?.data.slice(2)
  if(method==='eth_getTransactionReceipt'){const r=receipts.get(sha)??'success';return r==='pending'?null:{status:r==='reverted'?'0x0':'0x1',blockNumber:'0x10'}}
  if(method==='eth_getTransactionByHash')return tx
  throw new Error('unexpected '+method)}}}
const job=(label)=>{const artifact=JSON.stringify({schema:'smart-agro.test-artifact.v1',label,salt:randomUUID()}),sha=createHash('sha256').update(artifact).digest('hex'),key=`test-${label}:${randomUUID()}`;sql(`INSERT INTO outbox_job(event_key,kind,artifact_bytes,artifact_sha256,chain_id,contract_address,signer) VALUES(${q(key)},'ledger_anchor',${q(artifact)},${q(sha)},${q(String(chainId))},${q(contract)},${q(signer)})`);return{key,sha}}
const state=key=>sql(`SELECT status||'|'||coalesce(tx_hash,'')||'|'||coalesce(block_number::text,'')||'|'||attempts FROM outbox_job WHERE event_key=${q(key)}`).split('|')
const release=keys=>sql(`UPDATE outbox_job SET lease_until=NULL WHERE event_key IN (${keys.map(q).join(',')})`)

await test('A08: outbox worker',async t=>{
 // Park other local jobs so this worker only sees its own; they are released again at the end.
 const parked=sql(`UPDATE outbox_job SET lease_until=clock_timestamp()+interval '1 hour' WHERE status IN ('pending','sent') AND lease_until IS NULL RETURNING id`).split('\n').filter(Boolean)
 try{
 await t.test('a matching receipt confirms; tampering, revert and pending are reported honestly',async()=>{
  const n=node(),ok=job('ok'),bad=job('bad'),reverted=job('reverted'),slow=job('slow'),wrongSigner=job('signer')
  n.tamper.set(bad.sha,{input:'0x'+'0'.repeat(64)});n.tamper.set(wrongSigner.sha,{from:'0x'+'1'.repeat(40)})
  n.receipts.set(reverted.sha,'reverted');n.receipts.set(slow.sha,'pending')
  await runOnce({db,chain:n.chain,worker:'w1',signer,contract})
  assert.deepEqual(state(ok.key).filter((_,i)=>i!==1),['confirmed','16','1']);assert.match(state(ok.key)[1],/^0x[0-9a-f]{64}$/)
  assert.equal(state(bad.key)[0],'mismatch');assert.equal(state(wrongSigner.key)[0],'mismatch')
  assert.equal(state(reverted.key)[0],'failed');assert.equal(state(slow.key)[0],'sent')
  assert.equal(sql(`SELECT confirmed_at IS NULL AND last_error LIKE 'Receipt does not match%' FROM outbox_job WHERE event_key=${q(bad.key)}`),'t')
  // The pending one is checked again later and never sent twice.
  n.receipts.delete(slow.sha)
  await runOnce({db,chain:n.chain,worker:'w1',signer,contract})
  assert.equal(state(slow.key)[0],'confirmed');assert.equal(n.sends.filter(s=>s===slow.sha).length,1)
 })
 await t.test('two workers never send the same job',async()=>{
  const n=node(),one=job('race')
  await Promise.all([runOnce({db,chain:n.chain,worker:'w1',signer,contract}),runOnce({db,chain:n.chain,worker:'w2',signer,contract})])
  assert.equal(n.sends.filter(s=>s===one.sha).length,1);assert.equal(state(one.key)[0],'confirmed')
 })
 await t.test('send failures retry, then give up after five attempts',async()=>{
  const n=node(),flaky=job('flaky');n.failSend.add(flaky.sha)
  await runOnce({db,chain:n.chain,worker:'w1',signer,contract})
  assert.deepEqual([state(flaky.key)[0],state(flaky.key)[3]],['pending','1'])
  assert.equal(sql(`SELECT last_error FROM outbox_job WHERE event_key=${q(flaky.key)}`),'node unavailable')
  sql(`UPDATE outbox_job SET attempts=4 WHERE event_key=${q(flaky.key)}`)
  await runOnce({db,chain:n.chain,worker:'w1',signer,contract})
  assert.equal(state(flaky.key)[0],'failed')
 })
 await t.test('jobs stay bound to their network, contract and signer',async()=>{
  const n=node(),mine=job('bound')
  await runOnce({db,chain:n.chain,worker:'w3',signer,contract:'0x'+'2'.repeat(40)})
  assert.equal(state(mine.key)[0],'pending','a worker for another contract does not take it')
  release([mine.key])
  assert.equal((await db('worker_mark_sent',{p_job_id:sql(`SELECT id FROM outbox_job WHERE event_key=${q(mine.key)}`),p_worker:'w9',p_tx_hash:'0x'+'a'.repeat(64)})).code,'lease_lost')
  assert.notEqual((await fetch(base+'/rest/v1/rpc/worker_claim_outbox',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:'{}'})).status,200,'service role only')
 })
 await t.test('owners see the proof of their own ownership change',async()=>{
  const email=`proof-${randomUUID().slice(0,8)}@example.test`,password=randomBytes(20).toString('base64url')
  const signup=await (await fetch(base+'/auth/v1/signup',{method:'POST',headers:{apikey:config.anon,'Content-Type':'application/json'},body:JSON.stringify({email,password})})).json()
  const token=signup.access_token,rpc=async(name,body={})=>(await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:config.anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})).json()
  const account=(await rpc('ensure_my_account')).account.id,product=randomUUID(),ownership=randomUUID()
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('PROOF-'+product.slice(0,8).toUpperCase())},'single_pot','synthetic DB test'); INSERT INTO ownership(id,product_id,account_id) VALUES(${q(ownership)},${q(product)},${q(account)});
   INSERT INTO outbox_job(event_key,kind,artifact_bytes,artifact_sha256,chain_id,contract_address,signer) VALUES('claim:${ownership}','ownership_claim','{"schema":"x"}',encode(digest('{"schema":"x"}','sha256'),'hex'),${q(String(chainId))},${q(contract)},${q(signer)})`)
  await runOnce({db,chain:node().chain,worker:'w1',signer,contract})
  const [proof]=(await rpc('my_chain_proofs')).proofs
  assert.equal(proof.status,'confirmed');assert.equal(proof.chain_id,String(chainId));assert.match(proof.tx_hash,/^0x/)
  assert.equal((await rpc('operator_outbox_status')).code,'forbidden')
 })
 }finally{if(parked.length)sql(`UPDATE outbox_job SET lease_until=NULL WHERE id IN (${parked.map(q).join(',')})`)}
})
