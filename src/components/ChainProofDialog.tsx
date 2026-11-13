import { ArrowSquareOut, CheckCircle, DownloadSimple, FileArrowUp, LinkSimple, SealCheck, Warning, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { httpRpc, networkById, newProof, NETWORKS, parseProof, sha256Hex, verifyProof, type ProofFile, type Verification } from '../lib/chainProof'
import { connectWallet, discoverWallets, sendProofTransaction, walletMessage, walletRpc, type Wallet } from '../lib/wallet'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import SegmentedControl from './ui/segmented-control'
import { SelectField } from './ui/select'

type Frozen = { name: string; bytes: Uint8Array; sha256: string }
type Note = { tone: 'ok' | 'warn' | 'info'; text: string }

function save(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const saveProof = (proof: ProofFile) => save(JSON.stringify(proof, null, 2) + '\n', proof.artifact.name.replace(/\.json$/i, '') + '.bukti.json', 'application/json')
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`
const explorerTx = (proof: ProofFile) => `${networkById(proof.chain_id)!.explorer}/tx/${proof.tx_hash}`

const RESULT: Record<Exclude<Verification['status'], 'verified'>, string> = {
  file_mismatch: 'Berkas berbeda', wrong_network: 'Jaringan berbeda', not_found: 'Transaksi belum ditemukan',
  pending: 'Masih menunggu blok', failed: 'Transaksi gagal', chain_mismatch: 'Data transaksi tidak cocok',
}

/** UC-12/13/17: freeze the session as exact JSON bytes, record its SHA-256 through the user's wallet on a test
 * network, and later check a record file against its separate proof file using the network's public node. */
export default function ChainProofDialog({ open, onOpenChange, record }: { open: boolean; onOpenChange: (open: boolean) => void; record: () => { name: string; text: string } }) {
  const [tab, setTab] = useState('record')
  const [frozen, setFrozen] = useState<Frozen | null>(null)
  const [networkId, setNetworkId] = useState(NETWORKS[0].id)
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [walletId, setWalletId] = useState('')
  const [busy, setBusy] = useState(false)
  const [proof, setProof] = useState<ProofFile | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [files, setFiles] = useState<{ record?: File; proof?: File }>({})
  const [result, setResult] = useState<Verification | null>(null)
  const alive = useRef(true)
  const network = networkById(networkId)!

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    setWallets(null)
    void discoverWallets().then(found => { if (active) { setWallets(found); setWalletId(found[0]?.id ?? '') } })
    return () => { active = false }
  }, [open])

  async function freeze() {
    const { name, text } = record()
    const bytes = new TextEncoder().encode(text)
    const next = { name, bytes, sha256: await sha256Hex(bytes) }
    setFrozen(next); setProof(null)
    save(bytes as Uint8Array<ArrayBuffer>, name, 'application/json')
    setNote({ tone: 'info', text: 'Catatan dibekukan dan diunduh. Simpan berkas ini apa adanya: mengubah satu karakter saja membuat hash berbeda.' })
  }

  async function recordOnChain() {
    const wallet = wallets?.find(w => w.id === walletId)
    if (!frozen || !wallet) return
    setBusy(true); setNote({ tone: 'info', text: 'Buka wallet Anda: setujui koneksi dan jaringan uji.' })
    let current: ProofFile | null = null
    try {
      const account = await connectWallet(wallet, network)
      setNote({ tone: 'info', text: 'Periksa transaksi di wallet: nilai 0, tujuan alamat Anda sendiri, data berisi hash.' })
      const tx = await sendProofTransaction(wallet, account, frozen.sha256)
      current = newProof({ name: frozen.name, bytes: frozen.bytes.length, sha256: frozen.sha256, chainId: network.id, txHash: tx, from: account })
      setProof(current)
      setNote({ tone: 'info', text: 'Transaksi terkirim dan menunggu blok. Status ini belum berarti tercatat.' })
      for (let attempt = 0; attempt < 40 && alive.current; attempt++) {
        const check = await verifyProof(frozen.bytes, current, walletRpc(wallet)).catch(() => null)
        if (check?.status === 'verified') { setProof(check.proof); setNote({ tone: 'ok', text: `Tercatat di blok ${check.block_number} dan hash cocok. Unduh berkas bukti dan simpan bersama catatan.` }); return }
        if (check && check.status !== 'pending' && check.status !== 'not_found') { if (check.proof) setProof(check.proof); setNote({ tone: 'warn', text: check.message }); return }
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
      setNote({ tone: 'warn', text: 'Belum ada blok setelah menunggu. Unduh berkas bukti sekarang, lalu periksa lagi nanti di tab Verifikasi.' })
    } catch (error) {
      setNote({ tone: 'warn', text: current ? `${walletMessage(error)} Transaksi ${short(current.tx_hash)} mungkin tetap diproses; periksa sebelum mengirim ulang.` : walletMessage(error) })
    } finally { if (alive.current) setBusy(false) }
  }

  async function verify() {
    if (!files.record || !files.proof) return
    setBusy(true); setResult(null); setNote(null)
    try {
      if (files.record.size > 2_000_000 || files.proof.size > 16384) throw new Error('Berkas terlalu besar untuk catatan atau bukti Smart Agro.')
      const parsed = parseProof(JSON.parse(await files.proof.text()))
      const bytes = new Uint8Array(await files.record.arrayBuffer())
      setResult(await verifyProof(bytes, parsed, httpRpc(networkById(parsed.chain_id)!.rpc)))
    } catch (error) {
      setNote({ tone: 'warn', text: error instanceof SyntaxError ? 'Berkas bukti bukan JSON yang valid.' : error instanceof Error ? error.message : 'Verifikasi gagal dijalankan.' })
    } finally { setBusy(false) }
  }

  const noteView = note && <p className={`proof-note is-${note.tone}`} role={note.tone === 'warn' ? 'alert' : 'status'}>{note.tone === 'ok' ? <CheckCircle weight="fill" aria-hidden="true" /> : note.tone === 'warn' ? <Warning weight="fill" aria-hidden="true" /> : null}{note.text}</p>

  return <Dialog open={open} onOpenChange={next => { if (!busy || next) onOpenChange(next) }}>
    <DialogContent className="chain-proof" showCloseButton={false} aria-busy={busy}>
      <div className="dialog-heading"><span className="dialog-icon"><LinkSimple weight="duotone" aria-hidden="true" /></span>
        <div><DialogTitle>Bukti catatan di blockchain uji</DialogTitle><DialogDescription>Mencatat sidik jari (SHA-256) berkas sesi, bukan isinya. Data sesi tetap sintetis dan tetap di perangkat Anda.</DialogDescription></div>
        <button type="button" className="icon-button" aria-label="Tutup bukti blockchain" disabled={busy} onClick={() => onOpenChange(false)}><X aria-hidden="true" /></button></div>
      <SegmentedControl label="Langkah bukti" value={tab} onValueChange={value => { setTab(value); setNote(null) }} options={[{ value: 'record', label: 'Catat' }, { value: 'verify', label: 'Verifikasi' }]} />

      {tab === 'record' ? <div className="proof-steps">
        <section aria-labelledby="proof-step-1"><h3 id="proof-step-1"><span>1</span>Bekukan catatan</h3>
          <p>Sesi aktif disimpan sebagai berkas JSON. Hash dihitung dari byte berkas yang Anda unduh.</p>
          <button type="button" className="button" disabled={busy} onClick={() => void freeze()}><DownloadSimple aria-hidden="true" />{frozen ? 'Bekukan ulang dan unduh' : 'Bekukan dan unduh catatan'}</button>
          {frozen && <dl className="proof-facts"><div><dt>Berkas</dt><dd>{frozen.name} · {frozen.bytes.length.toLocaleString('id-ID')} byte</dd></div><div><dt>SHA-256</dt><dd><code>{frozen.sha256}</code></dd></div></dl>}
        </section>
        <section aria-labelledby="proof-step-2"><h3 id="proof-step-2"><span>2</span>Catat hash lewat wallet</h3>
          <label className="miro-field"><span>Jaringan uji</span><SelectField label="Jaringan uji" value={String(networkId)} onValueChange={value => setNetworkId(Number(value))} options={NETWORKS.map(n => ({ value: String(n.id), label: n.name }))} /></label>
          {wallets === null ? <p role="status">Mencari wallet di browser…</p> : !wallets.length ? <p className="proof-note is-info">Wallet browser tidak ditemukan. Pasang wallet (misalnya MetaMask) dengan saldo ETH testnet untuk biaya gas. Tanpa wallet, Anda tetap bisa membekukan catatan dan memverifikasi bukti yang ada.</p>
            : wallets.length > 1 && <label className="miro-field"><span>Wallet</span><SelectField label="Wallet" value={walletId} onValueChange={setWalletId} options={wallets.map(w => ({ value: w.id, label: w.name }))} /></label>}
          <p className="proof-consent">Wallet akan meminta persetujuan untuk satu transaksi <strong>bernilai 0</strong> ke <strong>alamat Anda sendiri</strong>, dengan data berisi tanda <code>SAG1</code> dan hash di atas. Biaya gas testnet dibayar dari wallet Anda. Kunci pribadi tidak pernah masuk ke aplikasi.</p>
          <button type="button" className="button primary" disabled={busy || !frozen || !wallets?.length} onClick={() => void recordOnChain()}><SealCheck weight="duotone" aria-hidden="true" />Setujui di wallet dan catat</button>
        </section>
        {noteView}
        {proof && <section className="proof-result" aria-label="Status bukti"><dl className="proof-facts">
          <div><dt>Status</dt><dd>{proof.status === 'confirmed' ? `Tercatat · blok ${proof.block_number}` : proof.status === 'failed' ? 'Gagal' : 'Menunggu blok'}</dd></div>
          <div><dt>Transaksi</dt><dd><a href={explorerTx(proof)} target="_blank" rel="noreferrer noopener">{short(proof.tx_hash)}<ArrowSquareOut aria-hidden="true" /></a></dd></div>
          <div><dt>Jaringan</dt><dd>{proof.network}</dd></div></dl>
          <button type="button" className="button" onClick={() => saveProof(proof)}><DownloadSimple aria-hidden="true" />Unduh berkas bukti</button></section>}
      </div> : <div className="proof-steps">
        <p>Pilih berkas catatan asli dan berkas buktinya. Pemeriksaan memakai node publik jaringan pada bukti; wallet tidak diperlukan.</p>
        <div className="file-picks">
          {([['record', 'Berkas catatan', '.json'], ['proof', 'Berkas bukti', '.bukti.json']] as const).map(([key, title, hint]) => <label key={key} className="file-pick" data-filled={files[key] ? '' : undefined}>
            <FileArrowUp weight="duotone" aria-hidden="true" />
            <span><strong>{title}</strong><small>{files[key]?.name ?? `Pilih ${hint}`}</small></span>
            <input type="file" accept=".json,application/json" aria-label={title} onChange={e => { const file = e.target.files?.[0]; setFiles(f => ({ ...f, [key]: file })); setResult(null) }} />
          </label>)}
        </div>
        <button type="button" className="button primary" disabled={busy || !files.record || !files.proof} onClick={() => void verify()}><SealCheck weight="duotone" aria-hidden="true" />{busy ? 'Memeriksa…' : 'Verifikasi'}</button>
        {noteView}
        {result && (result.status === 'verified'
          ? <section className="proof-result is-ok" role="status"><p><CheckCircle weight="fill" aria-hidden="true" /><strong>Cocok dan tercatat</strong></p>
            <p>Hash berkas sama dengan data transaksi di blok {result.block_number} ({result.confirmations} konfirmasi). Berkas tidak berubah sejak dicatat; ini bukan bukti kebenaran sensor, aturan, atau AI.</p>
            {result.confirmations < 3 && <p>Konfirmasi masih sedikit. Di jaringan uji, blok baru masih bisa berubah.</p>}
            <div className="miro-actions-row"><a className="button" href={explorerTx(result.proof)} target="_blank" rel="noreferrer noopener"><ArrowSquareOut aria-hidden="true" />Lihat di penjelajah</a><button type="button" className="button" onClick={() => saveProof(result.proof)}><DownloadSimple aria-hidden="true" />Unduh bukti terbaru</button></div></section>
          : <section className="proof-result is-warn" role="alert"><p><Warning weight="fill" aria-hidden="true" /><strong>{RESULT[result.status]}</strong></p><p>{result.message}</p></section>)}
      </div>}
    </DialogContent>
  </Dialog>
}
