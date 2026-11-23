import { CheckCircle, GoogleLogo, Package, ShieldCheck, SignOut, Trash, UserCircle, UsersThree, Plant, Notebook } from '@phosphor-icons/react'
import { useState } from 'react'
import { useAccount } from './accountContext'
import { tokenClaims, type AccountDeletion } from '../lib/productAccountClient'

export const AFTER_SIGN_IN = 'smart-agro.after-sign-in'
const longDate = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
const inFourteenDays = () => longDate(new Date(Date.now() + 14 * 86400000).toISOString())
/** A sign-in from the last nine minutes (the server allows ten), read from the token only as a hint for which step to show. */
function signedInRecently(token: string | undefined) {
  const amr = tokenClaims(token).amr
  return Array.isArray(amr) && amr.some(m => m && typeof m === 'object' && ['password', 'oauth', 'otp', 'totp'].includes(String((m as { method?: unknown }).method))
    && Number((m as { timestamp?: unknown }).timestamp) > Date.now() / 1000 - 540)
}

/** Google Play asks for deletion in the app and on the web; this page is the web half (#hapus-akun), in four steps:
 * what happens, verify, confirm, done. The server repeats every check (request_account_deletion). */
export default function DeleteAccount() {
  const account = useAccount()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<AccountDeletion | null>(null)
  const { client, identity, products } = account

  if (!client || !account.signedIn || !identity) return <section className="panel delete-account" aria-labelledby="delete-heading">
    <h2 id="delete-heading">Hapus akun</h2>
    <p>Masuk dulu dengan akun yang ingin dihapus. Setelah masuk, halaman ini terbuka lagi.</p>
    {client && <a className="button primary" href="#masuk" onClick={() => { try { sessionStorage.setItem(AFTER_SIGN_IN, '#hapus-akun') } catch { /* blocked: open Profil after signing in */ } }}>Masuk</a>}
  </section>

  const viaCode = client.mfa, viaPassword = !viaCode && !client.passwordless
  const fresh = signedInRecently(client.session?.access_token)
  const run = async (action: () => Promise<void>) => {
    setPending(true); setError('')
    try { await action() } catch (err) {
      const reauth = (err as { code?: string }).code === 'reauth_required'
      setError(reauth ? 'Verifikasi sudah lewat dari 10 menit. Verifikasi lagi.' : err instanceof Error ? err.message : 'Permintaan gagal.')
      if (reauth) setStep(2)
    } finally { setPending(false) }
  }
  const serials = products.map(p => p.serial_public)
  const steps = <ol className="delete-steps" aria-label={`Langkah ${step} dari 3`}>{[1, 2, 3].map(n => <li key={n} aria-current={n === step ? 'step' : undefined} />)}</ol>

  return <section className="panel delete-account" aria-labelledby="delete-heading">
    {step === 1 && <>
      {steps}
      <h2 id="delete-heading">Sebelum menghapus akun</h2>
      <p>Akun langsung nonaktif. Data dihapus permanen pada {inFourteenDays()}, 14 hari dari sekarang. Masuk lagi sebelum tanggal itu untuk membatalkan.</p>
      <h3>Dihapus</h3>
      <ul className="delete-list">
        <li><UserCircle aria-hidden="true" />Profil, nama, dan foto</li>
        <li><Plant aria-hidden="true" />Kebun, pot, dan nama tanaman</li>
        <li><Notebook aria-hidden="true" />Jurnal perawatan dan pertanyaan ke asisten</li>
        <li><SignOut aria-hidden="true" />Sesi di semua perangkat</li>
      </ul>
      <h3>Kepemilikan dilepas</h3>
      {serials.length ? <ul className="delete-list">{serials.map(s => <li key={s}><Package aria-hidden="true" />{s}</li>)}</ul> : <p className="muted">Akun ini tidak memiliki produk.</p>}
      {serials.length > 0 && <p className="muted">Setelah dilepas, pemilik baru bisa mendaftarkan perangkat ini.</p>}
      <h3>Tetap ada, tanpa data pribadi</h3>
      <ul className="delete-list">
        <li><ShieldCheck aria-hidden="true" />Bukti kepemilikan on-chain (hanya hash; catatan chain tidak bisa dihapus)</li>
        <li><UsersThree aria-hidden="true" />Angka komunitas yang sudah digabung, serta catatan poin dan pengajuan tanpa nama</li>
      </ul>
      <div className="miro-actions-row"><button type="button" className="button primary" onClick={() => setStep(2)}>Lanjutkan</button><a className="button" href="#profil">Batal</a></div>
    </>}

    {step === 2 && <form onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        try {
          if (viaCode) await client.verifyMfa(code)
          else if (viaPassword && (await client.authenticate(identity.email, password, false)) !== 'ok') throw new Error('Masuk belum selesai. Coba lagi.')
        } finally { setPassword(''); setCode('') }
        await account.refresh()
        setStep(3)
      })
    }}>
      {steps}
      <h2 id="delete-heading">Pastikan ini Anda</h2>
      <p>Verifikasi berlaku 10 menit.</p>
      {viaPassword && <label className="miro-field"><span>Kata sandi</span><input type="password" required minLength={8} maxLength={256} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>}
      {viaCode && <label className="miro-field"><span>Kode autentikator</span><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="miro-actions-row">
        {(viaPassword || viaCode) && <button type="submit" className="button primary" disabled={pending}>Verifikasi</button>}
        {!viaPassword && !viaCode && (fresh
          ? <button type="button" className="button primary" onClick={() => setStep(3)}><CheckCircle aria-hidden="true" />Google terverifikasi, lanjutkan</button>
          : <button type="button" className="button primary" disabled={pending} onClick={() => void run(() => client.startGoogle(`${location.origin}${location.pathname}#hapus-akun`))}><GoogleLogo aria-hidden="true" />Masuk ulang dengan Google</button>)}
        <button type="button" className="button" onClick={() => setStep(1)}>Kembali</button>
      </div>
    </form>}

    {step === 3 && <>
      {steps}
      <h2 id="delete-heading">Hapus akun {identity.name}?</h2>
      <p>Anda keluar dari semua perangkat sekarang{serials.length ? ` dan ${serials.length} produk dilepas` : ''}. Data dihapus permanen pada {inFourteenDays()}.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="miro-actions-row">
        <button type="button" className="button danger" disabled={pending} onClick={() => void run(async () => { setDone(await client.requestDeletion()); setStep(4) })}><Trash aria-hidden="true" />{pending ? 'Menghapus…' : 'Hapus akun'}</button>
        <a className="button" href="#profil">Batal</a>
      </div>
    </>}

    {step === 4 && done && <div role="status" className="delete-done">
      <CheckCircle weight="fill" aria-hidden="true" />
      <h2 id="delete-heading">Akun dijadwalkan dihapus</h2>
      <p>Masuk lagi sebelum {longDate(done.purgeAfter)} untuk membatalkan. Sesudah tanggal itu data tidak bisa dipulihkan.</p>
      <button type="button" className="button primary" onClick={() => { location.hash = '#masuk'; void account.refresh() }}>Selesai</button>
    </div>}
  </section>
}

/** Shown instead of the app when an account inside its grace period signs in. */
export function DeletionPending() {
  const account = useAccount()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const deletion = account.deletion!
  return <main id="main" tabIndex={-1} className="entry-gate" aria-label="Akun dijadwalkan dihapus">
    <div className="entry-card"><section className="panel delete-account" aria-labelledby="pending-heading">
      <h2 id="pending-heading">Akun ini dijadwalkan dihapus</h2>
      <p>Data akan dihapus permanen pada {longDate(deletion.purgeAfter)}. Batalkan untuk memakai akun seperti biasa.</p>
      {deletion.released.length > 0 && <p className="muted">{deletion.restorable.length === deletion.released.length
        ? `Produk ${deletion.released.join(', ')} kembali ke akun ini bila dibatalkan.`
        : deletion.restorable.length
          ? `Produk ${deletion.restorable.join(', ')} kembali bila dibatalkan. Yang lain sudah didaftarkan pemilik baru.`
          : 'Produk yang dilepas sudah didaftarkan pemilik baru dan tidak kembali.'}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="miro-actions-row">
        <button type="button" className="button primary" disabled={pending} onClick={() => {
          setPending(true); setError('')
          account.cancelDeletion().then(restored => account.setNotice({ error: false, text: restored.length ? `Penghapusan dibatalkan. ${restored.join(', ')} kembali ke akun Anda.` : 'Penghapusan dibatalkan.' }),
            err => setError(err instanceof Error ? err.message : 'Pembatalan gagal.')).finally(() => setPending(false))
        }}>{pending ? 'Membatalkan…' : 'Batalkan penghapusan'}</button>
        <button type="button" className="button" disabled={pending} onClick={() => { void account.signOut(); location.hash = '#masuk' }}>Tetap hapus dan keluar</button>
      </div>
    </section></div>
  </main>
}
