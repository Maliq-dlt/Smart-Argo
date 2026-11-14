import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { ProductAccountClient } from '../lib/productAccountClient'
import SegmentedControl from './ui/segmented-control'

// Operator tools for U03/U04 (ID-03, ID-04, ID-05, RW-04) and A08. Every write needs an operator account with a fresh
// authenticator code; the server enforces that (privileged_write_gate) and the client asks for a code when it says so.
type Client = Pick<ProductAccountClient, 'rpc' | 'provision' | 'mfa'>
type Row = Record<string, unknown>
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === 'object') : []
const when = (v: unknown) => typeof v === 'string' ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const STATUS: Record<string, string> = { open: 'Terbuka', in_review: 'Ditinjau', upheld: 'Diterima', rejected: 'Ditolak', approved: 'Disetujui', withdrawn: 'Dibatalkan' }
const TABS = [{ value: 'reward', label: 'Kasus poin' }, { value: 'recovery', label: 'Pemulihan' }, { value: 'registry', label: 'Registri' }, { value: 'outbox', label: 'Bukti chain' }]

/** Same request id for a retried identical action, a new one for anything else (server idempotency). */
function useRequestId() {
  const last = useRef<{ key: string; id: string } | null>(null)
  return { id: (key: string) => (last.current = last.current?.key === key ? last.current : { key, id: crypto.randomUUID() }).id, done: () => { last.current = null } }
}

export default function OperatorWorkspace({ client }: { client: Client }) {
  const [tab, setTab] = useState('reward')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const run = async (task: () => Promise<string | void>) => {
    setBusy(true); setMessage('')
    try { const done = await task(); if (alive.current && done) setMessage(done) }
    catch (err) { if (alive.current) setMessage(err instanceof Error ? err.message : 'Permintaan gagal.') }
    finally { if (alive.current) setBusy(false) }
  }
  const shared = { client, busy, run }
  // The server only grants operator reads and writes to a 2FA (AAL2) session; without it every tab would fail.
  if (!client.mfa) return <section className="panel operator-workspace" aria-labelledby="operator-heading">
    <h2 id="operator-heading">Operator</h2>
    <p className="miro-callout">Alat operator terbuka setelah 2FA aktif. Aktifkan di bagian Keamanan, lalu kembali ke sini.</p>
  </section>
  return <section className="panel operator-workspace" aria-labelledby="operator-heading" aria-busy={busy}>
    <h2 id="operator-heading">Operator</h2>
    <p>Setiap aksi tercatat dengan alasan. Aksi tulis meminta kode autentikator terbaru.</p>
    <SegmentedControl label="Bagian operator" value={tab} onValueChange={setTab} options={TABS} />
    <p className="sr-only" aria-live="polite">{message}</p>
    {message && <p aria-hidden="true" className="operator-message">{message}</p>}
    {tab === 'reward' && <CaseQueue {...shared} kind="reward" />}
    {tab === 'recovery' && <CaseQueue {...shared} kind="recovery" />}
    {tab === 'registry' && <Registry {...shared} />}
    {tab === 'outbox' && <Outbox {...shared} />}
  </section>
}

type Shared = { client: Client; busy: boolean; run: (task: () => Promise<string | void>) => Promise<void> }

function CaseQueue({ client, busy, run, kind }: Shared & { kind: 'reward' | 'recovery' }) {
  const [status, setStatus] = useState('open')
  const [cases, setCases] = useState<Row[]>([])
  const [reason, setReason] = useState<Record<string, string>>({})
  const [points, setPoints] = useState<Record<string, string>>({})
  const request = useRequestId()
  const names = kind === 'reward'
    ? { list: 'operator_reward_cases', take: 'operator_take_reward_case', decide: 'operator_decide_reward_case', yes: 'upheld', no: 'rejected' } as const
    : { list: 'operator_recovery_cases', take: 'operator_take_recovery_case', decide: 'operator_decide_recovery_case', yes: 'approved', no: 'rejected' } as const
  const load = async () => setCases(list((await client.rpc(names.list, { p_status: status })).cases))
  useEffect(() => { void run(load) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const decide = (c: Row, decision: string) => run(async () => {
    const why = (reason[String(c.id)] ?? '').trim(), pts = points[String(c.id)] ? Number(points[String(c.id)]) : null
    if (!why) throw new Error('Tulis alasan keputusan.')
    const body = kind === 'reward' ? { p_case_id: c.id, p_decision: decision, p_points: decision === 'upheld' ? pts : null, p_reason: why } : { p_case_id: c.id, p_decision: decision, p_reason: why }
    await client.rpc(names.decide, { ...body, p_request_id: request.id(JSON.stringify(body)) })
    request.done(); await load(); return 'Keputusan tersimpan.'
  })
  return <div className="operator-section">
    <SegmentedControl label="Status kasus" value={status} onValueChange={setStatus} options={['open', 'in_review', kind === 'reward' ? 'upheld' : 'approved', 'rejected'].map(value => ({ value, label: STATUS[value] }))} />
    {cases.length ? <ul className="miro-list" aria-label="Antrean kasus">{cases.map(c => <li key={String(c.id)}><div>
      <strong>{kind === 'reward' ? (c.kind === 'anomaly' ? 'Klaim janggal' : 'Keberatan') : `Pemulihan ${String(c.serial_public)}`}</strong> · {STATUS[String(c.status)]} · {when(c.created_at)}
      {typeof c.statement === 'string' && <p>{c.statement}</p>}
      {kind === 'reward' ? <RewardFacts c={c} /> : <RecoveryFacts c={c} />}
      {typeof c.decision_reason === 'string' && <p>Keputusan: {c.decision_reason}</p>}
      {c.status === 'open' && <button type="button" className="button" disabled={busy} onClick={() => void run(async () => {
        await client.rpc(names.take, { p_case_id: c.id, p_request_id: request.id('take:' + String(c.id)) }); request.done(); await load(); return 'Kasus diambil. Hanya Anda yang dapat memutusnya.' })}>Ambil kasus</button>}
      {c.status === 'in_review' && <fieldset className="product-account-form" disabled={busy}><legend className="sr-only">Putuskan</legend>
        <label className="miro-field"><span>Alasan keputusan</span><textarea maxLength={1000} rows={2} value={reason[String(c.id)] ?? ''} onChange={e => setReason(r => ({ ...r, [String(c.id)]: e.target.value }))} /></label>
        {kind === 'reward' && <label className="miro-field"><span>Poin bila diterima (kosong = usulan sistem)</span><input type="number" min={1} max={100000} value={points[String(c.id)] ?? ''} onChange={e => setPoints(p => ({ ...p, [String(c.id)]: e.target.value }))} /></label>}
        <div className="unit-actions"><button type="button" className="button primary" onClick={() => void decide(c, names.yes)}>{kind === 'reward' ? 'Terima' : 'Setujui pemulihan'}</button>
          <button type="button" className="button" onClick={() => void decide(c, names.no)}>Tolak</button></div>
      </fieldset>}
    </div></li>)}</ul> : !busy && <p>Tidak ada kasus dengan status ini.</p>}
  </div>
}

function RewardFacts({ c }: { c: Row }) {
  const e = c.energy as Row | null, r = c.redemption as Row | null
  return <p className="operator-facts">{e ? <>Panen {Number(e.solar_wh).toFixed(1)} Wh, beban {Number(e.load_wh).toFixed(1)} Wh dari batas meter {Number(e.bound_wh).toFixed(1)} Wh · hasil: {String(e.result)}</>
    : r ? <>Penukaran {String(r.item)} · {String(r.points)} poin · {String(r.status)}</> : null}
    {c.proposed_points != null && <> · usulan {String(c.proposed_points)} poin</>} · akun {String(c.account_id).slice(0, 8)}</p>
}

function RecoveryFacts({ c }: { c: Row }) {
  const evidence = list(c.evidence)
  return <><p className="operator-facts">Pemohon {c.claimant_activated ? 'pernah mengaktifkan' : 'tidak pernah mengaktifkan'} produk ini, {c.claimant_past_owner ? 'pernah memilikinya' : 'belum pernah memilikinya'}.
    {' '}Pemilik sekarang {c.owner_account_id ? `sejak ${when(c.owner_since)}, ${c.owner_has_2fa ? 'dengan' : 'tanpa'} 2FA` : 'tidak ada'} · {String(c.open_cases_for_product)} permintaan terbuka untuk produk ini.</p>
    {evidence.length > 0 && <ul aria-label="Bukti">{evidence.map((e, i) => <li key={i}>{String(e.kind)}: {String(e.reference)}{typeof e.sha256 === 'string' && <> · <code>{e.sha256.slice(0, 12)}…</code></>}</li>)}</ul>}</>
}

function Registry({ client, busy, run }: Shared) {
  const [form, setForm] = useState({ manifest: '', signature: '', code: '', device: '', expected: '', next: '', product: '', reason: '' })
  const [history, setHistory] = useState<Row[] | null>(null)
  const request = useRequestId()
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }))
  const field = (key: keyof typeof form, label: string, props: Record<string, unknown> = {}): ReactNode =>
    <label className="miro-field"><span>{label}</span>{props.rows ? <textarea value={form[key]} onChange={set(key)} {...props} /> : <input value={form[key]} onChange={set(key)} {...props} />}</label>
  const action = (name: 'operator_rotate_device_key' | 'operator_revoke_device' | 'operator_revoke_product', body: Row, done: string) => (e: FormEvent) => {
    e.preventDefault()
    void run(async () => { if (!form.reason.trim()) throw new Error('Tulis alasan.'); await client.rpc(name, { ...body, p_reason: form.reason.trim(), p_request_id: request.id(name + JSON.stringify(body) + form.reason) }); request.done(); return done })
  }
  return <div className="operator-section">
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      // The activation code goes on the packaging; only its SHA-256 reaches the server (claim compares the same hash).
      const code = form.code.trim(); if (code.length < 16) throw new Error('Kode aktivasi minimal 16 karakter.')
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))), b => b.toString(16).padStart(2, '0')).join('')
      const body = { manifest: form.manifest, signature: form.signature.trim(), activation_secret_hash: hash }
      const r = await client.provision({ ...body, request_id: request.id(JSON.stringify(body)) }); request.done()
      return `Produk ${String(r.serial_public)} terdaftar dengan ${String(r.devices)} perangkat.`
    }) }}><fieldset className="product-account-form" disabled={busy}><legend>Daftarkan produk dari manifest penerbit</legend>
      {field('manifest', 'Manifest (persis seperti yang ditandatangani)', { rows: 4, required: true, spellCheck: false })}
      {field('signature', 'Tanda tangan penerbit (base64)', { required: true, spellCheck: false })}
      {field('code', 'Kode aktivasi untuk kemasan', { required: true, minLength: 16, autoComplete: 'off' })}
      <button className="button primary" type="submit">Daftarkan</button></fieldset></form>
    <form onSubmit={action('operator_rotate_device_key', { p_device_id: form.device, p_expected_public_key: form.expected, p_new_public_key: form.next }, 'Kunci perangkat diganti.')}>
      <fieldset className="product-account-form" disabled={busy}><legend>Ganti kunci perangkat</legend>
        {field('device', 'ID perangkat', { required: true })}{field('expected', 'Kunci lama', { required: true })}{field('next', 'Kunci baru', { required: true })}{field('reason', 'Alasan', { required: true, maxLength: 1000 })}
        <button className="button" type="submit">Ganti kunci</button></fieldset></form>
    <form onSubmit={action('operator_revoke_device', { p_device_id: form.device }, 'Perangkat dicabut.')}><fieldset className="product-account-form" disabled={busy}><legend>Cabut perangkat</legend>
      {field('device', 'ID perangkat', { required: true })}{field('reason', 'Alasan', { required: true, maxLength: 1000 })}<button className="button" type="submit">Cabut perangkat</button></fieldset></form>
    <form onSubmit={action('operator_revoke_product', { p_product_id: form.product }, 'Produk dicabut.')}><fieldset className="product-account-form" disabled={busy}><legend>Cabut produk</legend>
      {field('product', 'ID produk', { required: true })}{field('reason', 'Alasan', { required: true, maxLength: 1000 })}
      <div className="unit-actions"><button className="button" type="submit">Cabut produk</button>
        <button type="button" className="button" disabled={!form.product} onClick={() => void run(async () => setHistory(list((await client.rpc('operator_registry_history', { p_product_id: form.product })).events)))}>Lihat riwayat registri</button></div></fieldset></form>
    {history && <ul className="miro-list" aria-label="Riwayat registri">{history.length ? history.map(h => <li key={String(h.id)}><div><strong>{String(h.action)}</strong> · {when(h.created_at)}<p>{String(h.reason)}</p></div></li>) : <li>Belum ada riwayat.</li>}</ul>}
  </div>
}

function Outbox({ client, run }: Shared) {
  const [data, setData] = useState<{ counts: Record<string, number>; problems: Row[] } | null>(null)
  useEffect(() => { void run(async () => { const r = await client.rpc('operator_outbox_status'); setData({ counts: (r.counts ?? {}) as Record<string, number>, problems: list(r.problems) }) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  return <div className="operator-section">
    <dl className="unit-sensors">{['pending', 'sent', 'confirmed', 'mismatch', 'failed'].map(s => <div key={s}><dt>{{ pending: 'Menunggu', sent: 'Terkirim', confirmed: 'Terkonfirmasi', mismatch: 'Tidak cocok', failed: 'Gagal' }[s]}</dt><dd>{data.counts[s] ?? 0}</dd></div>)}</dl>
    {data.problems.length > 0 && <ul className="miro-list" aria-label="Masalah outbox">{data.problems.map(p => <li key={String(p.event_key)}><div><strong>{String(p.event_key)}</strong> · {String(p.status)} · percobaan {String(p.attempts)}<p>{String(p.last_error ?? '')}</p></div></li>)}</ul>}
  </div>
}
