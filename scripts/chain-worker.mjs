// A08 outbox worker: leases jobs, sends each artifact's SHA-256 as calldata to the configured contract, records the
// transaction, then records the receipt. The database decides confirmed or mismatch (chain, signer, destination and
// hash must all match); this script only reports what the chain returned. A job that already has a transaction is
// checked, never resent.
// ponytail: transactions go through eth_sendTransaction, so the signer key stays in the node or a remote signer
// (for example Web3Signer). Signing raw transactions here needs secp256k1 and RLP; add them only if no signer exists.
//
// Usage: node scripts/chain-worker.mjs [--watch]
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHAIN_RPC_URL, CHAIN_SIGNER (0x… address), CHAIN_CONTRACT (0x…),
//      WORKER_ID (optional), CHAIN_ID (optional; must match eth_chainId when set).
import { pathToFileURL } from 'node:url'

const hex = value => typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)

/** One pass over leased jobs. `db(name, args)` calls a service-role RPC; `chain(method, params)` calls JSON-RPC. */
export async function runOnce({ db, chain, worker, signer, contract, limit = 10, log = () => {} }) {
  const chainId = BigInt(await chain('eth_chainId', [])).toString()
  const claimed = await db('worker_claim_outbox', { p_worker: worker, p_chain_id: chainId, p_contract: contract, p_signer: signer, p_limit: limit })
  if (!claimed.ok) throw new Error(`claim refused: ${claimed.code}`)
  const results = []
  for (const job of claimed.jobs) {
    try {
      let tx = job.tx_hash
      if (!tx) {
        const sent = await chain('eth_sendTransaction', [{ from: signer, to: contract, data: '0x' + job.artifact_sha256, value: '0x0' }])
        if (!hex(sent) || sent.length !== 66) throw new Error('node returned no transaction hash')
        tx = sent.toLowerCase()
        const marked = await db('worker_mark_sent', { p_job_id: job.id, p_worker: worker, p_tx_hash: tx })
        if (!marked.ok) throw new Error(`mark refused: ${marked.code}`)
      }
      const receipt = await chain('eth_getTransactionReceipt', [tx])
      if (!receipt) { await db('worker_record_receipt', { p_job_id: job.id, p_worker: worker, p_outcome: 'pending', p_chain_id: null, p_from: null, p_to: null, p_data: null, p_block_number: null }); results.push({ id: job.id, status: 'sent' }); continue }
      const sentTx = await chain('eth_getTransactionByHash', [tx])
      const recorded = await db('worker_record_receipt', { p_job_id: job.id, p_worker: worker, p_outcome: receipt.status === '0x1' ? 'success' : 'reverted',
        p_chain_id: sentTx?.chainId ? BigInt(sentTx.chainId).toString() : chainId, p_from: sentTx?.from ?? null, p_to: sentTx?.to ?? null,
        p_data: sentTx?.input ?? sentTx?.data ?? null, p_block_number: hex(receipt.blockNumber) ? Number(BigInt(receipt.blockNumber)) : null })
      results.push({ id: job.id, status: recorded.status ?? recorded.code })
    } catch (error) {
      // Only a job without a transaction can fail here; a sent job keeps its hash and is checked again next pass.
      if (!job.tx_hash) await db('worker_fail', { p_job_id: job.id, p_worker: worker, p_error: String(error.message ?? error) }).catch(() => {})
      log(`job ${job.id}: ${error.message ?? error}`)
      results.push({ id: job.id, status: 'error' })
    }
  }
  return results
}

export function rpcClients({ supabaseUrl, serviceKey, chainUrl, fetchImpl = fetch }) {
  let next = 1
  return {
    db: async (name, args) => {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`${name} HTTP ${response.status}`)
      return response.json()
    },
    chain: async (method, params) => {
      const response = await fetchImpl(chainUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: next++, method, params }), signal: AbortSignal.timeout(15000) })
      const body = await response.json()
      if (body.error) throw new Error(`${method}: ${body.error.message ?? 'error'}`)
      return body.result
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = name => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value }
  const signer = env('CHAIN_SIGNER').toLowerCase(), contract = env('CHAIN_CONTRACT').toLowerCase()
  const { db, chain } = rpcClients({ supabaseUrl: env('SUPABASE_URL').replace(/\/$/, ''), serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'), chainUrl: env('CHAIN_RPC_URL') })
  if (process.env.CHAIN_ID && BigInt(await chain('eth_chainId', [])).toString() !== process.env.CHAIN_ID) throw new Error('Node is on another chain than CHAIN_ID')
  const pass = async () => { const done = await runOnce({ db, chain, worker: process.env.WORKER_ID ?? 'chain-worker', signer, contract, log: console.error }); if (done.length) console.log(JSON.stringify(done)) }
  await pass()
  if (process.argv.includes('--watch')) setInterval(() => void pass().catch(error => console.error(error.message)), 15000)
}
