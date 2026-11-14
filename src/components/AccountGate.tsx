import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import AccountSignIn, { type GuardMood } from './AccountSignIn'
import AgroMark from './AgroMark'
import ThemeToggle from './ThemeToggle'
import { useAccount } from './accountContext'

const back = () => `${location.origin}${location.pathname}#statistik`
const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))
/** Auth answers in English; the common ones get a sentence that says what to do next. Others pass through. */
const plain: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email atau kata sandi salah. Belum punya akun? Pilih Daftar.'],
  [/email not confirmed/i, 'Email belum dikonfirmasi. Buka tautan konfirmasi di email Anda, lalu masuk.'],
  [/already registered|already been registered/i, 'Email ini sudah terdaftar. Pilih Masuk.'],
  [/password should be at least|weak password/i, 'Kata sandi terlalu pendek: minimal 10 karakter.'],
  [/rate limit|too many/i, 'Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.'],
  [/signups? not allowed/i, 'Pendaftaran sedang ditutup.'],
]
const friendly = (text: string) => plain.find(([pattern]) => pattern.test(text))?.[1] ?? text

/** The door into the simulator: Google, email, or a guest visit that keeps data in this browser. */
export default function AccountGate({ onGuest }: { onGuest?: () => void }) {
  const account = useAccount()
  const client = account.client!
  const { notice, setNotice } = account
  const [pending, setPending] = useState(false)
  const [mfaStep, setMfaStep] = useState(account.mfaPending)
  const [welcome, setWelcome] = useState(false)
  const [google, setGoogle] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    client.googleEnabled().then(value => { if (active) setGoogle(value) }, () => { if (active) setGoogle(false) })
    return () => { active = false }
  }, [client])

  async function run(action: () => Promise<void>) {
    setPending(true); setNotice(null)
    try { await action() } catch (err) { setNotice({ error: true, text: friendly(err instanceof Error ? err.message : 'Permintaan gagal.') }) }
    finally { setPending(false) }
  }
  /** The guard sprouts for a moment before the app opens (skipped with reduced motion). */
  async function opened(text: string) {
    setNotice({ error: false, text })
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { setWelcome(true); await pause(900) }
    await account.refresh()
  }

  const mood: GuardMood = pending ? 'busy' : welcome ? 'welcome' : notice?.error ? 'error' : 'idle'
  return <main id="main" tabIndex={-1} className="entry-gate" aria-label="Masuk ke Smart Agro">
    {/* ThemeToggle also applies the stored theme, which the app topbar does once the gate is passed. */}
    <header className="entry-top"><a className="entry-home" href="#"><ArrowLeft aria-hidden="true" /><AgroMark /><span>Smart Agro</span></a><ThemeToggle /></header>
    <div className="entry-card">
      {notice && <p className="entry-notice" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      <AccountSignIn mood={mood} google={google} mfaStep={mfaStep}
        onGoogle={() => void run(() => client.startGoogle(back()))}
        onGuest={onGuest}
        onPassword={(email, password, signup) => run(async () => {
          const result = await client.authenticate(email, password, signup, back())
          if (result === 'mfa') { setMfaStep(true); return }
          if (result === 'confirm') { setNotice({ error: false, text: 'Periksa email untuk konfirmasi akun, lalu masuk kembali.' }); return }
          await opened(signup ? 'Akun siap digunakan. Aktifkan 2FA di Profil sebelum menukar poin.' : 'Berhasil masuk.')
        })}
        onCode={code => run(async () => { await client.verifyMfa(code); await opened('Berhasil masuk.') })}
        onRecoveryCode={code => run(async () => { await client.recoverMfa(code); setMfaStep(false); await opened('Masuk dengan kode pemulihan. Autentikator lama dihapus; aktifkan lagi di Profil. Penukaran dan transfer ditahan 24 jam.') })}
        onForgot={email => run(async () => {
          if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Isi email akun Anda dulu, lalu pilih Lupa kata sandi.')
          await client.requestPasswordReset(email, back())
          setNotice({ error: false, text: 'Jika email itu terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Buka di browser ini.' })
        })}
        onCancelCode={() => { setMfaStep(false); void client.logout().catch(() => undefined) }} />
    </div>
  </main>
}
