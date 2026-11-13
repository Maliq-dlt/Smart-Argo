// Record proof in a real Chrome against an in-memory test chain: an injected EIP-6963 wallet signs nothing real,
// it just answers like one, and the network's public node is intercepted to read the same chain. This checks the
// app's protocol and states, not a live testnet. Needs a running build (`npx vite preview --port 4173`).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = new URL('#statistik', process.env.TEST_URL || 'http://127.0.0.1:4173/').href
const output = resolve('.tmp/chain-proof-browser')
await mkdir(output, { recursive: true })
const errors = []
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })

// ── The test chain (Base Sepolia id): transactions are mined on the first receipt lookup after sending. ──
const account = '0x' + '5a'.repeat(20)
const chain = { block: 1000, txs: new Map(), receipts: new Map(), sent: [] }
function rpc(method, params = []) {
  if (method === 'eth_chainId') return '0x14a34'
  if (method === 'eth_blockNumber') return '0x' + chain.block.toString(16)
  if (method === 'eth_getTransactionByHash') return chain.txs.get(params[0]) ?? null
  if (method === 'eth_getTransactionReceipt') {
    const tx = chain.txs.get(params[0])
    if (tx && !chain.receipts.has(params[0])) chain.receipts.set(params[0], { status: '0x1', blockNumber: '0x' + (++chain.block).toString(16), blockHash: '0x' + createHash('sha256').update('block' + chain.block).digest('hex') })
    chain.block += 1 // later blocks add confirmations
    return chain.receipts.get(params[0]) ?? null
  }
  throw Object.assign(new Error(`unsupported ${method}`), { code: -32601 })
}
function send(tx) {
  const hash = '0x' + createHash('sha256').update(JSON.stringify(tx) + chain.sent.length).digest('hex')
  chain.sent.push(tx)
  chain.txs.set(hash, { hash, from: tx.from, to: tx.to, value: tx.value, input: tx.data, chainId: '0x14a34' })
  return hash
}

/** An EIP-1193 provider announced through EIP-6963; `mode` selects the behaviour under test. */
const injectWallet = (page, mode) => page.addInitScript(([mode, account]) => {
  let chainId = '0xaa36a7', known = false
  const provider = {
    async request({ method, params = [] }) {
      if (method === 'eth_requestAccounts') return [account]
      if (method === 'eth_chainId') return chainId
      if (method === 'wallet_switchEthereumChain') { if (!known) throw Object.assign(new Error('unknown chain'), { code: 4902 }); chainId = params[0].chainId; return null }
      if (method === 'wallet_addEthereumChain') { known = params[0].chainId === '0x14a34' && params[0].rpcUrls[0] === 'https://sepolia.base.org'; return null }
      if (method === 'eth_sendTransaction') {
        if (mode === 'reject') throw Object.assign(new Error('User rejected'), { code: 4001 })
        return window.__chainSend(params[0])
      }
      return window.__chainRpc(method, params)
    },
  }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'test-wallet', name: 'Dompet Uji', rdns: 'id.smartagro.testwallet', icon: '' }, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
}, [mode, account])

async function openProof(page) {
  await page.goto(url); await curtainOpen(page)
  await page.getByRole('button', { name: 'Berkas' }).click()
  await page.getByRole('button', { name: 'Bukti blockchain' }).click()
  const dialog = page.getByRole('dialog', { name: 'Bukti catatan di blockchain uji' })
  await dialog.waitFor()
  return dialog
}
async function newPage(browser, viewport, mode) {
  const page = await browser.newPage({ viewport, acceptDownloads: true })
  page.on('pageerror', error => errors.push(`${mode}: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`${mode}: ${message.text()}`) })
  await page.exposeFunction('__chainRpc', (method, params) => rpc(method, params))
  await page.exposeFunction('__chainSend', tx => send(tx))
  await page.route(target => target.href.startsWith('https://sepolia.base.org'), async route => {
    const body = route.request().postDataJSON()
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: rpc(body.method, body.params) }) })
  })
  if (mode !== 'none') await injectWallet(page, mode)
  return page
}
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.chain-proof')].every(d => d.scrollWidth <= d.clientWidth + 1))

const browser = await chromium.launch({ headless: true, channel: 'chrome' })

asGuest(browser) // account entry is covered by the account checks
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await newPage(browser, viewport, 'ok')
    const dialog = await openProof(page)

    // 1 · Freeze: the downloaded bytes are the bytes that get hashed.
    const frozenDownload = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Bekukan dan unduh catatan' }).click()
    const record = `${output}/catatan-${viewport.width}.json`
    await (await frozenDownload).saveAs(record)
    const sha = createHash('sha256').update(await readFile(record)).digest('hex')
    assert.equal(await dialog.locator('.proof-facts code').innerText(), sha, 'The shown hash is the SHA-256 of the downloaded file')
    assert.equal(JSON.parse(await readFile(record, 'utf8')).version, 2, 'The frozen record is a normal session export')

    // 2 · Record: the wallet is moved to Base Sepolia (added first), then asked for one zero-value self transfer.
    await dialog.getByRole('button', { name: 'Setujui di wallet dan catat' }).click()
    await dialog.locator('.proof-note.is-ok').filter({ hasText: /Tercatat di blok \d+ dan hash cocok/ }).waitFor({ timeout: 20000 })
      .catch(async error => { throw new Error(`${error.message.split(String.fromCharCode(10))[0]} — note: ${await dialog.locator('.proof-note').innerText().catch(() => '?')}`) })
    const tx = chain.sent.at(-1)
    assert.deepEqual(tx, { from: account, to: account, value: '0x0', data: `0x53414731${sha}` }, 'Only the tagged hash leaves the browser, with value 0 to the own address')
    assert(await fits(page), `Proof dialog fits at ${viewport.width}`)
    await page.screenshot({ path: `${output}/recorded-${viewport.width}.png` })
    const proofDownload = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Unduh berkas bukti' }).click()
    const proofFile = `${output}/bukti-${viewport.width}.json`
    await (await proofDownload).saveAs(proofFile)
    const proof = JSON.parse(await readFile(proofFile, 'utf8'))
    assert.equal(proof.status, 'confirmed'); assert.equal(proof.artifact.sha256, sha); assert.equal(proof.chain_id, 84532)
    assert.doesNotMatch(JSON.stringify(proof), /samples|profile|moisture/, 'The proof file holds no session data')

    // 3 · Verify through the public node (intercepted): matching file passes, one changed byte fails.
    await dialog.getByRole('radio', { name: 'Verifikasi' }).check({ force: true })
    const inputs = dialog.locator('input[type=file]')
    await inputs.nth(0).setInputFiles(record)
    await inputs.nth(1).setInputFiles(proofFile)
    await dialog.getByRole('button', { name: 'Verifikasi', exact: true }).click()
    await dialog.locator('.proof-result.is-ok').filter({ hasText: 'Cocok dan tercatat' }).waitFor({ timeout: 15000 })
    const tampered = `${output}/catatan-diubah-${viewport.width}.json`
    await writeFile(tampered, (await readFile(record, 'utf8')).replace('"version": 2', '"version": 2 '))
    await inputs.nth(0).setInputFiles(tampered)
    await dialog.getByRole('button', { name: 'Verifikasi', exact: true }).click()
    await dialog.locator('.proof-result.is-warn').filter({ hasText: 'Berkas berbeda' }).waitFor()
    await page.waitForTimeout(500) // let the segmented pill settle after the dialog resizes
    await page.screenshot({ path: `${output}/tampered-${viewport.width}.png` })
    assert(await fits(page), `Verify view fits at ${viewport.width}`)
    await page.close()
  }

  // A refusal in the wallet sends nothing and says so.
  const refused = await newPage(browser, { width: 1024, height: 768 }, 'reject')
  const before = chain.sent.length
  let dialog = await openProof(refused)
  await dialog.getByRole('button', { name: 'Bekukan dan unduh catatan' }).click()
  await dialog.getByRole('button', { name: 'Setujui di wallet dan catat' }).click()
  await dialog.locator('.proof-note.is-warn').filter({ hasText: 'Permintaan ditolak di wallet' }).waitFor()
  assert.equal(chain.sent.length, before)
  assert.equal(await dialog.getByRole('button', { name: 'Unduh berkas bukti' }).count(), 0, 'No proof file without a transaction')
  await refused.close()

  // Without any wallet, recording is unavailable but explained; freezing still works.
  const bare = await newPage(browser, { width: 1024, height: 768 }, 'none')
  dialog = await openProof(bare)
  await dialog.locator('.proof-note.is-info').filter({ hasText: 'Wallet browser tidak ditemukan' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Setujui di wallet dan catat' }).isDisabled(), true)
  await bare.close()
} finally { await browser.close() }

assert.deepEqual(errors, [], 'No page errors')
console.log('Chain proof browser checks passed: freeze, add+switch network, record, proof file, verify, tamper, refusal, no wallet (1440/390/1024).')
