import { ShieldCheck } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { encode } from 'uqr'
import { qrPath } from '../lib/productQr'
import type { ProductAccountClient, TotpEnrollment } from '../lib/productAccountClient'

const KINDS: Record<string, string> = {
  sign_in: 'Masuk', mfa_enabled: '2FA diaktifkan', mfa_removed: '2FA dimatikan', password_changed: 'Kata sandi diganti',
  redemption_reserved: 'Reservasi penukaran', transfer_created: 'Kode transfer dibuat', transfer_accepted: 'Transfer kepemilikan',
}
const BROWSERS: [RegExp, string][] = [[/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']]
const SYSTEMS: [RegExp, string][] = [[/Android/, 'Android'], [/iPhone|iPad/, 'iOS'], [/Windows/, 'Windows'], [/Mac OS X/, 'macOS'], [/Linux/, 'Linux']]
const named = (agent: string, list: [RegExp, string][]) => list.find(([pattern]) => pattern.test(agent))?.[1]
const device = (agent: string) => [named(agent, BROWSERS), named(agent, SYSTEMS)].filter(Boolean).join(' · ') || 'Perangkat lain'
const when = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })

interface SecurityEvent { kind: string; detail: string | null; created_at: string }
interface SecurityState { mfa_enabled: boolean; hold_until: string | null; events: SecurityEvent[] }
function parseSecurity(value: Record<string, unknown>): SecurityState {
  const events = Array.isArray(value.events) ? value.events : []
  const valid = (e: unknown): e is SecurityEvent => Boolean(e && typeof e === 'object' && typeof (e as SecurityEvent).kind === 'string' && typeof (e as SecurityEvent).created_at === 'string')
  if (typeof value.mfa_enabled !== 'boolean' || !events.every(valid)) throw new Error('Status keamanan tidak valid.')
  return { mfa_enabled: value.mfa_enabled, hold_until: typeof value.hold_until === 'string' ? value.hold_until : null, events }
}

/** TOTP two-factor, the redemption hold, other sessions, and the account's recent security activity. */
export default function ProductSecurity({ client, onChanged }: { client: ProductAccountClient; onChanged: () => void }) {
  const [state, setState] = useState<SecurityState | null>(null)
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null)
  const load = useCallback(async () => setState(parseSecurity(await client.rpc('security_workspace'))), [client])
  useEffect(() => { load().catch(() => setNote({ error: true, text: 'Status keamanan gagal dimuat.' })) }, [load])
  const run = async (action: () => Promise<string>) => {
    setPending(true); setNote(null)
    try { const text = await action(); await load(); onChanged(); setNote({ error: false, text }) } catch (error) {
      setNote({ error: true, text: error instanceof Error ? error.message : 'Permintaan keamanan gagal.' })
    } finally { setPending(false); setCode('') }
  }
  const qr = useMemo(() => {
    if (!enrollment) return null
    const matrix = encode(enrollment.uri, { ecc: 'M', border: 4 })
    return { size: matrix.size, d: qrPath(matrix.data) }
  }, [enrollment])
  const codeField = <label className="miro-field"><span>Kode autentikator</span><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>

  return <section className="product-security" aria-labelledby="product-security-heading">
    <h3 id="product-security-heading"><ShieldCheck weight="duotone" aria-hidden="true" />Keamanan akun</h3>
    {note && <p role={note.error ? 'alert' : undefined} aria-live="polite">{note.text}</p>}
    {state && <p>{state.mfa_enabled ? '2FA aktif. Masuk dan penukaran poin meminta kode dari aplikasi autentikator.' : '2FA belum aktif. Penukaran poin hanya bisa dilakukan setelah 2FA aktif.'}</p>}
    {state?.hold_until && <p className="miro-callout">Penukaran poin ditahan sampai {when(state.hold_until)} karena ada perubahan keamanan.</p>}
    {state && !state.mfa_enabled && !enrollment && <button className="button" disabled={pending} onClick={() => void run(async () => {
      setEnrollment(await client.enrollMfa())
      return 'Pindai kode QR dengan aplikasi autentikator, lalu masukkan kode 6 angkanya.'
    })}>Aktifkan 2FA</button>}
    {enrollment && qr && <form onSubmit={event => {
      event.preventDefault()
      void run(async () => { await client.confirmMfa(enrollment.id, code); setEnrollment(null); return '2FA aktif. Demi keamanan, penukaran poin baru terbuka 24 jam lagi.' })
    }}><fieldset className="product-account-form" disabled={pending}><legend>Pasang aplikasi autentikator</legend>
      <figure className="product-qr">
        <svg viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label="Kode QR pendaftaran 2FA"><rect className="product-qr-field" width={qr.size} height={qr.size} /><path className="product-qr-modules" d={qr.d} /></svg>
        <figcaption>Pindai dengan Google Authenticator, Authy, atau aplikasi TOTP lain, atau ketik kunci ini:<code className="transfer-code" data-totp-secret>{enrollment.secret.match(/.{1,4}/g)!.join(' ')}</code><small>Jangan bagikan kunci ini. Siapa pun yang memilikinya bisa membuat kode Anda.</small></figcaption>
      </figure>
      {codeField}
      <div className="miro-actions-row"><button className="button" type="submit">Konfirmasi 2FA</button><button className="button" type="button" onClick={() => setEnrollment(null)}>Batal</button></div>
    </fieldset></form>}
    {state?.mfa_enabled && <form onSubmit={event => {
      event.preventDefault()
      void run(async () => { await client.removeMfa(code); return '2FA dimatikan. Penukaran poin memerlukan 2FA lagi.' })
    }}><fieldset className="product-account-form" disabled={pending}><legend>Matikan 2FA</legend>
      {codeField}
      <button className="button" type="submit">Matikan 2FA</button>
    </fieldset></form>}
    <button className="button" disabled={pending} onClick={() => void run(async () => { await client.signOutOthers(); return 'Sesi di perangkat lain sudah dikeluarkan.' })}>Keluar dari perangkat lain</button>
    {state && state.events.length > 0 && <>
      <h4>Aktivitas terakhir</h4>
      <ul className="security-events">{state.events.map((e, i) => <li key={`${e.created_at}-${i}`}>
        <strong>{KINDS[e.kind] ?? e.kind}</strong>
        <span>{e.kind === 'sign_in' ? device(e.detail ?? '') : e.detail}</span>
        <time dateTime={e.created_at}>{when(e.created_at)}</time>
      </li>)}</ul>
    </>}
  </section>
}
