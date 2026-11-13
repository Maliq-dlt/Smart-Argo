import { ArrowLeft } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import AccountSignIn, { type GuardMood } from './AccountSignIn'
import AgroMark from './AgroMark'
import ThemeToggle from './ThemeToggle'
import { useAccount } from './accountContext'

const back = () => `${location.origin}${location.pathname}#statistik`
const pause = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

/** The door into the simulator: Google, email, or (without `signInRequired`) a guest visit that keeps data in this browser. */
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
    try { await action() } catch (err) { setNotice({ error: true, text: err instanceof Error ? err.message : 'Permintaan gagal.' }) }
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
          const result = await client.authenticate(email, password, signup)
          if (result === 'mfa') { setMfaStep(true); return }
          if (result === 'confirm') { setNotice({ error: false, text: 'Periksa email untuk konfirmasi akun, lalu masuk kembali.' }); return }
          await opened(signup ? 'Akun siap digunakan. Aktifkan 2FA di Profil sebelum menukar poin.' : 'Berhasil masuk.')
        })}
        onCode={code => run(async () => { await client.verifyMfa(code); await opened('Berhasil masuk.') })}
        onCancelCode={() => { setMfaStep(false); void client.logout().catch(() => undefined) }} />
    </div>
  </main>
}
