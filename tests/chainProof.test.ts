import assert from 'node:assert/strict'
import test from 'node:test'
import { hashFromCalldata, httpRpc, newProof, parseProof, proofCalldata, sha256Hex, verifyProof, type Rpc } from '../src/lib/chainProof.ts'

const bytes = new TextEncoder().encode('{"source":"simulation","samples":[1,2,3]}\n')
const from = '0x' + 'ab'.repeat(20)
const txHash = '0x' + '12'.repeat(32)
const blockHash = '0x' + '34'.repeat(32)

/** A tiny in-memory chain answering the five calls verification needs. */
function chain(overrides: Partial<Record<string, unknown>> = {}, tx: Record<string, unknown> = {}): Rpc {
  return async (method) => {
    if (method in overrides) return overrides[method]
    if (method === 'eth_chainId') return '0x14a34'
    if (method === 'eth_blockNumber') return '0x10'
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from, to: from, value: '0x0', chainId: '0x14a34', input: proofCalldata(await sha256Hex(bytes)), ...tx }
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xe', blockHash }
    throw new Error(method)
  }
}

test('SHA-256 memakai byte UTF-8 persis; satu byte berubah mengubah hash', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.notEqual(await sha256Hex(bytes), await sha256Hex(new TextEncoder().encode('{"source":"simulation","samples":[1,2,3]}')))
})

test('Data transaksi hanya berisi tanda SAG1 dan hash; data lain tidak dibaca sebagai bukti', async () => {
  const hash = await sha256Hex(bytes)
  assert.equal(proofCalldata(hash), `0x53414731${hash}`)
  assert.equal(hashFromCalldata(proofCalldata(hash).toUpperCase().replace('0X', '0x')), hash)
  for (const input of ['0x', `0x${hash}`, `0xdeadbeef${hash}`, `${proofCalldata(hash)}00`, null]) assert.equal(hashFromCalldata(input), null)
  assert.throws(() => proofCalldata('not-a-hash'), /Hash/)
})

test('Berkas bukti terpisah divalidasi; jaringan yang tidak didukung ditolak', async () => {
  const proof = newProof({ name: 'sesi.json', bytes: bytes.length, sha256: await sha256Hex(bytes), chainId: 84532, txHash, from, at: new Date('2026-11-13T00:00:00Z') })
  assert.equal(proof.status, 'pending')
  assert.deepEqual(parseProof(JSON.parse(JSON.stringify(proof))), proof)
  assert.throws(() => parseProof({ ...proof, chain_id: 1 }), /Jaringan/)
  assert.throws(() => parseProof({ ...proof, tx_hash: '0x12' }), /Transaksi/)
  assert.throws(() => parseProof({ ...proof, schema: 'lain' }), /dikenali/)
})

test('Verifikasi sukses hanya bila berkas, jaringan, pengirim, tujuan, nilai nol, data dan receipt cocok', async () => {
  const proof = newProof({ name: 'sesi.json', bytes: bytes.length, sha256: await sha256Hex(bytes), chainId: 84532, txHash, from })
  const ok = await verifyProof(bytes, proof, chain())
  assert.equal(ok.status, 'verified')
  if (ok.status === 'verified') { assert.equal(ok.block_number, 14); assert.equal(ok.confirmations, 3); assert.equal(ok.proof.status, 'confirmed'); assert.equal(ok.proof.block_hash, blockHash) }

  const cases: [string, Rpc, Uint8Array?][] = [
    ['file_mismatch', chain(), new TextEncoder().encode('{"source":"simulation","samples":[1,2,4]}\n')],
    ['wrong_network', chain({ eth_chainId: '0xaa36a7' })],
    ['not_found', chain({ eth_getTransactionByHash: null })],
    ['pending', chain({ eth_getTransactionReceipt: null })],
    ['failed', chain({ eth_getTransactionReceipt: { status: '0x0', blockNumber: '0xe', blockHash } })],
    ['chain_mismatch', chain({}, { to: '0x' + 'cd'.repeat(20) })],
    ['chain_mismatch', chain({}, { value: '0x1' })],
    ['chain_mismatch', chain({}, { input: proofCalldata('0'.repeat(64)) })],
    ['chain_mismatch', chain({}, { from: '0x' + 'cd'.repeat(20) })],
  ]
  for (const [status, rpc, file] of cases) assert.equal((await verifyProof(file ?? bytes, proof, rpc)).status, status, status)
})

test('Klien JSON-RPC menolak respons dengan id lain atau galat node', async () => {
  const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch
  assert.equal(await httpRpc('https://rpc.test', reply({ jsonrpc: '2.0', id: 1, result: '0x14a34' }))('eth_chainId'), '0x14a34')
  await assert.rejects(httpRpc('https://rpc.test', reply({ jsonrpc: '2.0', id: 9, result: '0x1' }))('eth_chainId'), /tidak valid/)
  await assert.rejects(httpRpc('https://rpc.test', reply({ jsonrpc: '2.0', id: 1, error: { code: -32000 } }))('eth_chainId'), /menolak/)
  await assert.rejects(httpRpc('https://rpc.test', reply({}, false))('eth_chainId'), /dihubungi/)
})
