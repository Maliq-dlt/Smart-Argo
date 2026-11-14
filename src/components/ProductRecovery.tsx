import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ProductAccountClient } from '../lib/productAccountClient'
import { SelectField } from './ui/select'

const KIND = { receipt: 'Kuitansi atau faktur', photo: 'Foto', serial_label: 'Label serial', activation_card: 'Kartu aktivasi', other: 'Lainnya' }
const STATUS: Record<string, string> = { open: 'Menunggu operator', in_review: 'Sedang ditinjau', approved: 'Disetujui', rejected: 'Ditolak', withdrawn: 'Dibatalkan' }
const PROOF: Record<string, string> = { pending: 'Menunggu dikirim', sent: 'Terkirim, menunggu konfirmasi', confirmed: 'Terkonfirmasi', failed: 'Gagal', mismatch: 'Tidak cocok, tidak dianggap bukti' }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
type Evidence = { kind: keyof typeof KIND; reference: string }

/** ID-03 recovery (A04 "pemulihan lewat proses dukungan") and the A08 proofs of the person's ownership changes. */
export default function ProductRecovery({ client }: { client: Pick<ProductAccountClient, 'rpc' | 'session'> }) {
  const [cases, setCases] = useState<Record<string, unknown>[]>([])
  const [proofs, setProofs] = useState<Record<string, unknown>[]>([])
  const [serial, setSerial] = useState('')
  const [statement, setStatement] = useState('')
  const [evidence, setEvidence] = useState<Evidence[]>([{ kind: 'receipt', reference: '' }])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const alive = useRef(true), retry = useRef<{ key: string; id: string } | null>(null)

  async function run(task: () => Promise<string | void>) {
    setBusy(true); setMessage('')
    try { const done = await task(); if (alive.current && done) setMessage(done) }
    catch (err) { if (alive.current) setMessage(err instanceof Error ? err.message : 'Permintaan gagal.') }
    finally { if (alive.current) setBusy(false) }
  }
  const load = async () => {
    const [mine, chain] = await Promise.all([client.rpc('my_ownership_recoveries'), client.rpc('my_chain_proofs')])
    if (alive.current) { setCases(list(mine.cases)); setProofs(list(chain.proofs)) }
  }
  useEffect(() => {
    alive.current = true
    void run(load)
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submit(event: FormEvent) {
    event.preventDefault()
    const refs = evidence.map(e => ({ kind: e.kind, reference: e.reference.trim() })).filter(e => e.reference)
    const body = { p_serial: serial.trim(), p_statement: statement.trim(), p_evidence: refs }, key = JSON.stringify(body)
    const attempt = retry.current?.key === key ? retry.current : { key, id: crypto.randomUUID() }
    retry.current = attempt
    void run(async () => {
      if (body.p_statement.length < 20) throw new Error('Ceritakan kronologinya minimal 20 karakter.')
      await client.rpc('open_ownership_recovery', { p_request_id: attempt.id, ...body })
      retry.current = null
      await load()
      if (alive.current) { setSerial(''); setStatement(''); setEvidence([{ kind: 'receipt', reference: '' }]) }
      return 'Permintaan terkirim. Pemilik saat ini diberi tahu tanpa identitas Anda.'
    })
  }

  return <>
    <section className="panel miro-card" aria-labelledby="recovery-heading" aria-busy={busy}>
      <div className="panel-heading"><h3 id="recovery-heading">Pulihkan kepemilikan</h3></div>
      <div className="miro-card-body">
        <p>Untuk produk yang dulu Anda miliki atau sudah diklaim orang lain. Operator memeriksa bukti; produk berpindah hanya jika disetujui.</p>
        <p className="sr-only" aria-live="polite">{message}</p>
        <form onSubmit={submit}><fieldset className="product-account-form" disabled={busy}><legend>Ajukan pemulihan</legend>
          <label className="miro-field"><span>Serial produk</span><input required maxLength={120} autoCapitalize="characters" value={serial} onChange={e => setSerial(e.target.value)} /></label>
          <label className="miro-field"><span>Kronologi</span><textarea required minLength={20} maxLength={2000} rows={3} value={statement} onChange={e => setStatement(e.target.value)} /></label>
          {evidence.map((e, i) => <div key={i} className="evidence-row">
            <label className="miro-field"><span>Jenis bukti {i + 1}</span><SelectField label={`Jenis bukti ${i + 1}`} value={e.kind} onValueChange={v => setEvidence(all => all.map((x, j) => j === i ? { ...x, kind: v as Evidence['kind'] } : x))} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} /></label>
            <label className="miro-field"><span>Rujukan bukti {i + 1}</span><input maxLength={240} placeholder="Nomor faktur, nama toko, atau lokasi file" value={e.reference} onChange={ev => setEvidence(all => all.map((x, j) => j === i ? { ...x, reference: ev.target.value } : x))} /></label>
          </div>)}
          {evidence.length < 5 && <button type="button" className="button" onClick={() => setEvidence(all => [...all, { kind: 'photo', reference: '' }])}>Tambah bukti</button>}
          <button className="button primary" type="submit">Kirim permintaan</button>
        </fieldset></form>
        {message && <p aria-hidden="true">{message}</p>}
        {cases.length > 0 && <ul className="miro-list" aria-label="Permintaan pemulihan saya">{cases.map(c => <li key={String(c.id)}><div>
          <strong>{String(c.serial_public)} · {STATUS[String(c.status)] ?? String(c.status)}</strong> · {when(String(c.created_at))}
          {typeof c.decision_reason === 'string' && <p>Keputusan: {c.decision_reason}</p>}
          {c.status === 'open' && <button type="button" className="button" disabled={busy} onClick={() => void run(async () => { await client.rpc('withdraw_ownership_recovery', { p_case_id: c.id }); await load(); return 'Permintaan dibatalkan.' })}>Batalkan</button>}
        </div></li>)}</ul>}
      </div>
    </section>
    <section className="panel miro-card" aria-labelledby="proofs-heading">
      <div className="panel-heading"><h3 id="proofs-heading">Bukti blockchain kepemilikan</h3></div>
      <div className="miro-card-body">
        <p>Setiap aktivasi, transfer, dan pemulihan dicatat sebagai komitmen hash tanpa data pribadi. Status "Terkonfirmasi" berarti jaringan, penanda tangan, tujuan, dan hash cocok. Bukti ini tidak membuktikan kebenaran data sensor.</p>
        {proofs.length ? <ul className="miro-list" aria-label="Bukti kepemilikan">{proofs.map(p => <li key={String(p.event_key)}><div>
          <strong>{String(p.serial_public)} · {{ ownership_claim: 'Aktivasi', ownership_transfer: 'Transfer atau pemulihan' }[String(p.kind)] ?? String(p.kind)}</strong> · {PROOF[String(p.status)] ?? String(p.status)}
          <p><code>{String(p.artifact_sha256).slice(0, 16)}…</code>{typeof p.tx_hash === 'string' && <> · Transaksi <code>{p.tx_hash.slice(0, 12)}…</code> di chain {String(p.chain_id)}{p.block_number != null && `, blok ${String(p.block_number)}`}</>}</p>
        </div></li>)}</ul> : !busy && <p>Belum ada bukti.</p>}
      </div>
    </section>
  </>
}
