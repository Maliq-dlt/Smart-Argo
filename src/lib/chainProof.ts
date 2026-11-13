/* Record proof on a public test network (UC-12, UC-13, UC-17; docs/diagram/03-alur-demo-ai-blockchain.mmd).
 * The record is frozen as exact UTF-8 bytes and hashed with SHA-256. The user's own wallet sends a zero-value
 * transaction to their own address whose data is a 4-byte tag plus that hash; nothing else leaves the browser.
 * Chain ID, transaction hash, block and receipt status live in a separate proof file, because adding them to the
 * record would change its hash. A match proves the file is unchanged since it was recorded, not that the sensor
 * readings, the rules or any AI output in it are true. */

export interface ChainNetwork { id: number; key: string; name: string; rpc: string; explorer: string; currency: string }
export const NETWORKS: readonly ChainNetwork[] = [
  { id: 84532, key: 'base-sepolia', name: 'Base Sepolia (testnet)', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org', currency: 'ETH' },
  { id: 11155111, key: 'sepolia', name: 'Ethereum Sepolia (testnet)', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', currency: 'ETH' },
]
export const networkById = (id: number) => NETWORKS.find(n => n.id === id)

/** "SAG1": marks the data as a Smart Agro record hash, version 1. */
export const PROOF_TAG = '53414731'
const HASH = /^[0-9a-f]{64}$/
const TX = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/

export const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
export async function sha256Hex(bytes: Uint8Array) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)))
}
export const proofCalldata = (hash: string) => {
  if (!HASH.test(hash)) throw new Error('Hash SHA-256 tidak valid.')
  return `0x${PROOF_TAG}${hash}`
}
/** The record hash carried by a transaction's data, or null when the data is not a Smart Agro proof. */
export function hashFromCalldata(input: unknown) {
  if (typeof input !== 'string') return null
  const data = input.toLowerCase()
  return data.length === 2 + 8 + 64 && data.startsWith(`0x${PROOF_TAG}`) && HASH.test(data.slice(10)) ? data.slice(10) : null
}

export type ProofStatus = 'pending' | 'confirmed' | 'failed'
export interface ProofFile {
  schema: 'smart-agro.chain-proof.v1'
  artifact: { name: string; bytes: number; sha256: string }
  chain_id: number
  network: string
  tx_hash: string
  from: string
  status: ProofStatus
  block_number: number | null
  block_hash: string | null
  recorded_at: string
  checked_at: string | null
  note: string
}
const NOTE = 'Bukti ini hanya menunjukkan berkas tidak berubah sejak hash-nya dicatat. Bukan bukti kebenaran sensor, aturan, atau AI.'

export function newProof(input: { name: string; bytes: number; sha256: string; chainId: number; txHash: string; from: string; at?: Date }): ProofFile {
  const network = networkById(input.chainId)
  if (!network) throw new Error('Jaringan tidak didukung.')
  return parseProof({
    schema: 'smart-agro.chain-proof.v1', artifact: { name: input.name, bytes: input.bytes, sha256: input.sha256 },
    chain_id: input.chainId, network: network.name, tx_hash: input.txHash.toLowerCase(), from: input.from.toLowerCase(),
    status: 'pending', block_number: null, block_hash: null, recorded_at: (input.at ?? new Date()).toISOString(), checked_at: null, note: NOTE,
  })
}

function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
export function parseProof(value: unknown): ProofFile {
  if (!record(value) || value.schema !== 'smart-agro.chain-proof.v1') throw new Error('Berkas bukti tidak dikenali.')
  const a = value.artifact
  if (!record(a) || typeof a.name !== 'string' || a.name.length > 200 || !Number.isSafeInteger(a.bytes) || (a.bytes as number) < 0 || typeof a.sha256 !== 'string' || !HASH.test(a.sha256)) throw new Error('Data berkas pada bukti tidak valid.')
  if (!Number.isSafeInteger(value.chain_id) || !networkById(value.chain_id as number)) throw new Error('Jaringan pada bukti tidak didukung.')
  if (typeof value.tx_hash !== 'string' || !TX.test(value.tx_hash) || typeof value.from !== 'string' || !ADDRESS.test(value.from)) throw new Error('Transaksi pada bukti tidak valid.')
  if (!['pending', 'confirmed', 'failed'].includes(String(value.status))) throw new Error('Status bukti tidak valid.')
  if (value.block_number !== null && !Number.isSafeInteger(value.block_number)) throw new Error('Nomor blok tidak valid.')
  if (value.block_hash !== null && (typeof value.block_hash !== 'string' || !TX.test(value.block_hash))) throw new Error('Hash blok tidak valid.')
  for (const k of ['recorded_at', 'checked_at'] as const) if (value[k] !== null && (typeof value[k] !== 'string' || !Number.isFinite(Date.parse(value[k] as string)))) throw new Error('Waktu pada bukti tidak valid.')
  if (typeof value.recorded_at !== 'string') throw new Error('Waktu pencatatan tidak ada.')
  return {
    schema: 'smart-agro.chain-proof.v1', artifact: { name: a.name, bytes: a.bytes as number, sha256: a.sha256 },
    chain_id: value.chain_id as number, network: networkById(value.chain_id as number)!.name, tx_hash: value.tx_hash, from: value.from,
    status: value.status as ProofStatus, block_number: value.block_number as number | null, block_hash: value.block_hash as string | null,
    recorded_at: value.recorded_at, checked_at: value.checked_at as string | null, note: NOTE,
  }
}

export type Rpc = (method: string, params?: unknown[]) => Promise<unknown>
const hexInt = (v: unknown) => (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v) ? Number.parseInt(v, 16) : NaN)

export type Verification =
  | { status: 'verified'; block_number: number; block_hash: string; confirmations: number; proof: ProofFile }
  | { status: 'file_mismatch' | 'wrong_network' | 'not_found' | 'pending' | 'failed' | 'chain_mismatch'; message: string; proof?: ProofFile }

/** Checks a record against its proof on the proof's own chain. Every negative outcome keeps "verified" withheld. */
export async function verifyProof(recordBytes: Uint8Array, proof: ProofFile, rpc: Rpc, now = new Date()): Promise<Verification> {
  const hash = await sha256Hex(recordBytes)
  if (hash !== proof.artifact.sha256) return { status: 'file_mismatch', message: 'Berkas ini berbeda dari berkas yang dicatat. Hash SHA-256 tidak sama.' }
  if (hexInt(await rpc('eth_chainId')) !== proof.chain_id) return { status: 'wrong_network', message: 'Sumber data blockchain berada di jaringan lain dari yang tertulis pada bukti.' }
  const tx = await rpc('eth_getTransactionByHash', [proof.tx_hash])
  if (!record(tx)) return { status: 'not_found', message: 'Transaksi belum ditemukan di jaringan ini. Bisa jadi belum tersebar; periksa lagi nanti.' }
  const receipt = await rpc('eth_getTransactionReceipt', [proof.tx_hash])
  if (!record(receipt)) return { status: 'pending', message: 'Transaksi masih menunggu dimasukkan ke blok. Status belum terverifikasi.' }
  if (receipt.status !== '0x1') return { status: 'failed', message: 'Transaksi gagal di jaringan. Berkas tidak tercatat.', proof: { ...proof, status: 'failed', checked_at: now.toISOString() } }
  const from = String(tx.from).toLowerCase(), to = String(tx.to).toLowerCase()
  if (from !== proof.from || to !== proof.from || hexInt(tx.value) !== 0 || hashFromCalldata(tx.input) !== hash || hexInt(tx.chainId ?? '0x' + proof.chain_id.toString(16)) !== proof.chain_id)
    return { status: 'chain_mismatch', message: 'Data transaksi tidak memuat hash berkas ini dari alamat pada bukti. Jangan anggap tercatat.' }
  const block = hexInt(receipt.blockNumber), latest = hexInt(await rpc('eth_blockNumber'))
  const blockHash = String(receipt.blockHash).toLowerCase()
  if (!Number.isSafeInteger(block) || !TX.test(blockHash)) return { status: 'pending', message: 'Receipt belum memuat blok yang lengkap. Periksa lagi nanti.' }
  const confirmations = Number.isSafeInteger(latest) ? Math.max(1, latest - block + 1) : 1
  return { status: 'verified', block_number: block, block_hash: blockHash, confirmations, proof: { ...proof, status: 'confirmed', block_number: block, block_hash: blockHash, checked_at: now.toISOString() } }
}

/** Plain JSON-RPC over HTTPS to the network's public endpoint; no wallet needed to verify. */
export function httpRpc(url: string, fetcher: typeof fetch = fetch): Rpc {
  let id = 0
  return async (method, params = []) => {
    const request = ++id
    const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: request, method, params }), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Node jaringan tidak dapat dihubungi.')
    const body: unknown = await response.json()
    if (!record(body) || body.id !== request) throw new Error('Respons node jaringan tidak valid.')
    if (record(body.error)) throw new Error('Node jaringan menolak permintaan.')
    return body.result
  }
}
