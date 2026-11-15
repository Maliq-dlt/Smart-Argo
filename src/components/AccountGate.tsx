import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import AccountSignIn, { type GuardMood } from './AccountSignIn'
import AgroMark from './AgroMark'
import ThemeToggle from './ThemeToggle'
import { useAccount } from './accountContext'
import { behindCurtain } from '../lib/curtainSignal'

const back = () => `${location.origin}${location.pathname}#statistik`
/** Auth answers in English; the common ones get a sentence that says what to do next. Others pass through. */
const plain: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email atau kata sandi salah. Belum punya akun? Pilih Daftar.'],
  [/email not confirmed/i, 'Email belum dikonfirmasi. Masukkan kode yang kami kirim, atau pilih Kirim ulang kode.'],
  [/token has expired or is invalid|otp_expired/i, 'Kode salah atau sudah kedaluwarsa. Periksa kodenya, atau pilih Kirim ulang.'],
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
  const [codeEmail, setCodeEmail] = useState<string | null>(null)
  const [codeWait, setCodeWait] = useState(0)
  const [welcome, setWelcome] = useState(false)
  const [existing, setExisting] = useState<{ email: string } | null>(null)
  const [google, setGoogle] = useState<boolean | null>(client.googleKnown)

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
  /** The guard sprouts while the loading screen closes over the gate, and the app opens behind it (with reduced motion
   * there is no curtain: the app just opens). */
  async function opened(text: string) {
    setNotice({ error: false, text })
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setWelcome(true)
    try { await behindCurtain('Menyiapkan ruang tanam…', account.refresh) } catch (err) { setWelcome(false); throw err }
  }

  const mood: GuardMood = pending ? 'busy' : welcome ? 'welcome' : notice?.error ? 'error' : 'idle'
  return <main id="main" tabIndex={-1} className="entry-gate" aria-label="Masuk ke Smart Agro">
    {/* ThemeToggle also applies the stored theme, which the app topbar does once the gate is passed. */}
    <header className="entry-top"><a className="entry-home" href="#"><ArrowLeft aria-hidden="true" /><AgroMark /><span>Smart Agro</span></a><ThemeToggle /></header>
    <div className="entry-card">
      <AccountSignIn mood={mood} google={google} mfaStep={mfaStep} codeEmail={codeEmail} codeWait={codeWait} notice={notice} existing={existing}
        onGoogle={() => void run(() => client.startGoogle(back()))}
        onGuest={onGuest}
        onPassword={(email, password, signup, name) => run(async () => {
          let result: Awaited<ReturnType<typeof client.authenticate>>
          try { result = await client.authenticate(email, password, signup, back(), name) } catch (err) {
            // Someone who never finished verifying gets the code step (with send again ready), not a dead end.
            if (!signup && err instanceof Error && /email not confirmed/i.test(err.message)) { setCodeWait(0); setCodeEmail(email) }
            // An address that already has an account is not an error: move to "Masuk" with it filled in, and say why.
            if (signup && (err as { code?: string }).code === 'email_exists') {
              setExisting({ email })
              setNotice({ error: false, text: `Email ini sudah terdaftar, jadi kami arahkan ke Masuk. Lupa kata sandinya? Pilih "Lupa kata sandi?".${google ? ' Dulu mendaftar lewat Google? Pilih "Lanjut dengan Google".' : ''}` })
              return
            }
            throw err
          }
          if (result === 'mfa') { setMfaStep(true); return }
          if (result === 'confirm') { setCodeWait(60); setCodeEmail(email); setNotice({ error: false, text: 'Kode sudah dikirim ke email Anda.' }); return }
          await opened(signup ? 'Akun siap digunakan. Aktifkan 2FA di Profil sebelum menukar poin.' : 'Berhasil masuk.')
        })}
        onVerifyEmail={code => run(async () => {
          const result = await client.verifySignupCode(codeEmail!, code)
          if (result === 'mfa') { setCodeEmail(null); setMfaStep(true); return }
          await opened('Email terverifikasi. Selamat datang!')
        })}
        onResendEmail={() => run(async () => { await client.resendSignupCode(codeEmail!); setNotice({ error: false, text: 'Kode baru sudah dikirim ke email Anda.' }) })}
        onChangeEmail={() => { setCodeEmail(null); setNotice(null) }}
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
