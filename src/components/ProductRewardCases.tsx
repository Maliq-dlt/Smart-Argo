import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ProductAccountClient } from '../lib/productAccountClient'
import { SelectField } from './ui/select'

type Case = { id: string; kind: 'anomaly' | 'appeal'; energy_window_id: string | null; redemption_id: string | null; statement: string | null; status: string; decision_reason: string | null; credited_points: number | null; created_at: string }
const STATUS: Record<string, string> = { open: 'Menunggu operator', in_review: 'Sedang ditinjau', upheld: 'Diterima', rejected: 'Ditolak' }
const REASON: Record<string, string> = { credited: 'dikreditkan', policy_disabled: 'program belum aktif', below_threshold: 'di bawah ambang', daily_cap: 'batas harian', held_for_review: 'ditahan untuk ditinjau' }
const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** RW-04 for owners: appeal an energy result or a redemption, and follow every case (including claims the system held
 * for review). Decisions and their reasons come from an operator; the owner never sees who decided. */
export default function ProductRewardCases({ client, onSessionExpired }: { client: Pick<ProductAccountClient, 'rpc' | 'session'>; onSessionExpired: () => void }) {
  const [cases, setCases] = useState<Case[]>([])
  const [subjects, setSubjects] = useState<{ value: string; label: string }[]>([])
  const [subject, setSubject] = useState('')
  const [statement, setStatement] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const alive = useRef(true), retry = useRef<{ key: string; id: string } | null>(null)

  async function run(task: () => Promise<string | void>) {
    setBusy(true); setMessage('')
    try { const done = await task(); if (alive.current && done) setMessage(done) }
    catch (err) { if (!alive.current) return; setMessage(err instanceof Error ? err.message : 'Permintaan gagal.'); if (!client.session) onSessionExpired() }
    finally { if (alive.current) setBusy(false) }
  }
  const load = async () => {
    const [mine, energy, rewards] = await Promise.all([client.rpc('my_reward_cases'), client.rpc('energy_workspace'), client.rpc('reward_workspace')])
    if (!alive.current) return
    setCases(list(mine.cases).filter(c => typeof c.id === 'string' && typeof c.status === 'string') as unknown as Case[])
    const windows = list(energy.windows).slice(0, 30).map(w => ({ value: `w:${w.id}`, label: `Energi ${when(String(w.start_at))} · ${REASON[String(w.reward_reason)] ?? 'belum diproses'}` }))
    const redemptions = list(rewards.redemptions).filter(r => r.status !== 'compensated').slice(0, 30).map(r => ({ value: `r:${r.id}`, label: `Penukaran ${String(r.title ?? '')} · ${when(String(r.created_at))}` }))
    setSubjects([...windows, ...redemptions])
  }
  useEffect(() => {
    alive.current = true
    void run(load)
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function appeal(event: FormEvent) {
    event.preventDefault()
    const clean = statement.trim(), key = `${subject}|${clean}`
    // A retry of the same appeal reuses its request id, so the server returns the first case instead of a second one.
    const attempt = retry.current?.key === key ? retry.current : { key, id: crypto.randomUUID() }
    retry.current = attempt
    void run(async () => {
      if (!subject || !clean) throw new Error('Pilih hal yang diajukan dan tulis alasannya.')
      await client.rpc('open_reward_appeal', { p_request_id: attempt.id, p_energy_window_id: subject.startsWith('w:') ? subject.slice(2) : null,
        p_redemption_id: subject.startsWith('r:') ? subject.slice(2) : null, p_statement: clean })
      retry.current = null
      await load()
      if (alive.current) { setStatement(''); setSubject('') }
      return 'Keberatan terkirim. Operator akan meninjaunya.'
    })
  }

  return <section className="panel miro-card" aria-labelledby="reward-cases-heading" aria-busy={busy}>
    <div className="panel-heading"><h3 id="reward-cases-heading">Keberatan dan peninjauan</h3></div>
    <div className="miro-card-body">
      <p>Klaim energi yang janggal ditahan dulu dan ditinjau operator. Anda juga bisa mengajukan keberatan atas hasil energi atau penukaran.</p>
      <p className="sr-only" aria-live="polite">{message}</p>
      <form onSubmit={appeal}><fieldset className="product-account-form" disabled={busy}><legend>Ajukan keberatan</legend>
        <label className="miro-field"><span>Hal yang diajukan</span><SelectField label="Hal yang diajukan" placeholder={subjects.length ? 'Pilih hasil energi atau penukaran' : 'Belum ada yang bisa diajukan'} value={subject} onValueChange={setSubject} options={subjects} /></label>
        <label className="miro-field"><span>Alasan</span><textarea required maxLength={2000} rows={3} value={statement} onChange={e => setStatement(e.target.value)} /></label>
        <button className="button" type="submit" disabled={!subjects.length}>Kirim keberatan</button>
      </fieldset></form>
      {message && <p aria-hidden="true">{message}</p>}
      {cases.length > 0 ? <ul className="miro-list" aria-label="Pengajuan saya">{cases.map(c => <li key={c.id}><div>
        <strong>{c.kind === 'anomaly' ? 'Klaim ditahan sistem' : 'Keberatan'} · {STATUS[c.status] ?? c.status}</strong> · {when(c.created_at)}
        {c.statement && <p>{c.statement}</p>}
        {c.decision_reason && <p>Keputusan: {c.decision_reason}{c.credited_points ? ` (+${c.credited_points} poin)` : ''}</p>}
      </div></li>)}</ul> : !busy && <p>Belum ada pengajuan.</p>}
    </div>
  </section>
}
