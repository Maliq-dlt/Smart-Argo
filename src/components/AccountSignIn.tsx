import { CaretDown, GoogleLogo } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { useState } from 'react'

export type GuardMood = 'idle' | 'busy' | 'error' | 'welcome'
type Field = 'email' | 'secret' | null
const spring = { type: 'spring', stiffness: 260, damping: 22 } as const

/** The pot mascot as a guard: it reads along with the email, covers its eyes for passwords and codes,
 * droops after a failed attempt and sprouts on success. Decorative; the form's own messages carry the state. */
function Guardian({ look, hide, mood }: { look: number; hide: boolean; mood: GuardMood }) {
  const mouth = mood === 'error' ? 'M76 112Q80 108 84 112' : mood === 'welcome' ? 'M68 108Q80 123 92 108' : hide ? 'M76 113a4 4 0 1 0 8 0a4 4 0 1 0 -8 0' : 'M70 109Q80 118 90 109'
  const hand = (x: number, flip: boolean) => <g transform={`translate(${x} 101)${flip ? ' scale(-1 1)' : ''}`}>
    <motion.g initial={false} animate={{ rotate: hide ? -4 : 112 }} transition={spring} style={{ originX: 0, originY: 0.5 }}>
      <path d="M0 0C8 -9 22 -9 29 0C22 9 8 9 0 0Z" fill="var(--leaf)" />
      <path d="M3 0H24" stroke="var(--leaf-vein)" strokeWidth="1.4" strokeLinecap="round" />
    </motion.g>
  </g>
  return <svg className="guardian" viewBox="22 10 116 136" aria-hidden="true" data-mood={mood}>
    <motion.g initial={false} animate={{ rotate: mood === 'error' ? -16 : 0 }} transition={spring} style={{ originX: 0.5, originY: 1 }}>
      <path d="M80 81V44" fill="none" stroke="var(--stem)" strokeWidth="4" strokeLinecap="round" />
      <path d="M80 63C52 63 44 42 48 27C70 29 83 42 80 63Z" fill="var(--leaf-light)" />
      <path d="M80 51C81 30 96 19 115 23C115 45 102 56 80 51Z" fill="var(--leaf)" />
      <path d="M80 62L57 37M81 49L104 30" fill="none" stroke="var(--leaf-vein)" strokeWidth="1.5" strokeLinecap="round" />
      <motion.path d="M80 45C77 34 82 24 93 21C95 33 89 42 80 45Z" fill="var(--accent-2)" initial={false}
        animate={{ scale: mood === 'welcome' ? 1 : 0 }} transition={spring} style={{ originX: 0, originY: 1 }} />
    </motion.g>
    <path d="M44 78H116L108 122Q80 136 52 122Z" fill="var(--pot)" />
    <rect x="41" y="73" width="78" height="12" rx="5" fill="var(--pot-light)" />
    <g fill="var(--pot-light)"><circle cx="66" cy="98" r="6.5" /><circle cx="94" cy="98" r="6.5" /></g>
    <motion.g fill="var(--soil-wet)" initial={false} animate={{ x: look * 3, y: mood === 'busy' ? -2 : 0 }} transition={spring}>
      <circle cx="66" cy="98" r="3.2" /><circle cx="94" cy="98" r="3.2" />
    </motion.g>
    <motion.path key={mouth} d={mouth} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} fill="none" stroke="var(--soil-wet)" strokeWidth="3" strokeLinecap="round" />
    {hand(43, false)}{hand(117, true)}
  </svg>
}

const caption = (mood: GuardMood, field: Field) => mood === 'error' ? 'Belum berhasil. Coba sekali lagi.'
  : mood === 'busy' ? 'Sebentar, saya periksa dulu.' : mood === 'welcome' ? 'Selamat datang.'
  : field === 'secret' ? 'Mata saya tertutup. Silakan ketik.' : field === 'email' ? 'Saya ikut membaca.' : 'Saya menjaga akun dan pot Anda.'

interface Props {
  mood: GuardMood
  google: boolean | null
  mfaStep: boolean
  onGoogle: () => void
  onPassword: (email: string, password: string, signup: boolean) => Promise<void>
  onCode: (code: string) => Promise<void>
  onCancelCode: () => void
  /** Shown at the simulator gate: continue without an account, data stays in this browser. */
  onGuest?: () => void
}

/** Sign-in and sign-up: Google first when the server offers it, email and password otherwise or on request. */
export default function AccountSignIn({ mood, google, mfaStep, onGoogle, onPassword, onCode, onCancelCode, onGuest }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [field, setField] = useState<Field>(null)
  // Droops on each new failure and perks up once the person starts correcting the form.
  const [sad, setSad] = useState(mood === 'error')
  const [lastMood, setLastMood] = useState(mood)
  if (mood !== lastMood) { setLastMood(mood); setSad(mood === 'error') }
  const shown: GuardMood = mood === 'error' && !sad ? 'idle' : mood
  const focus = (value: Field) => ({ onFocus: () => setField(value), onBlur: () => setField(null) })
  const submitPassword = (signup: boolean) => { void onPassword(email.trim(), password, signup).finally(() => setPassword('')) }

  return <div className="signin">
    <div className="signin-guard">
      <Guardian look={field === 'email' ? Math.min(email.length / 22, 1) * 2 - 1 : 0} hide={field === 'secret'} mood={shown} />
      <p aria-hidden="true">{caption(shown, field)}</p>
    </div>
    <div className="signin-body">
      <h3>{mfaStep ? 'Satu langkah lagi' : 'Masuk ke Smart Agro'}</h3>
      {mfaStep ? <form onSubmit={event => { event.preventDefault(); void onCode(otp).finally(() => setOtp('')) }}>
        <fieldset className="signin-fields" disabled={mood === 'busy'}>
          <legend className="sr-only">Verifikasi dua langkah</legend>
          <p>Masukkan kode 6 angka dari aplikasi autentikator Anda.</p>
          <label className="miro-field"><span>Kode autentikator</span><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={otp} {...focus('secret')} onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setSad(false) }} /></label>
          <div className="miro-actions-row"><button className="button primary" type="submit">Verifikasi</button><button className="button" type="button" onClick={() => { setOtp(''); onCancelCode() }}>Batal</button></div>
        </fieldset>
      </form> : <>
        <p className="signin-lede">Satu akun untuk pot, data sensor, dan poin Anda.</p>
        {google && <>
          <button className="button primary signin-google" type="button" disabled={mood === 'busy'} onClick={onGoogle}><GoogleLogo weight="bold" aria-hidden="true" />Lanjut dengan Google</button>
          <small className="signin-note">Belum punya akun? Akun dibuat otomatis saat pertama masuk.</small>
        </>}
        {onGuest && <>
          <button className="button signin-guest" type="button" disabled={mood === 'busy'} onClick={onGuest}>Coba tanpa akun</button>
          <small className="signin-note">Data tamu hanya tersimpan di browser ini.</small>
        </>}
        {google !== null && <details className="signin-email" open={!google || undefined}>
          <summary><span>{google ? 'Pakai email dan kata sandi' : 'Masuk atau daftar dengan email'}</span><CaretDown aria-hidden="true" /></summary>
          <form onSubmit={event => { event.preventDefault(); submitPassword(false) }}>
            <fieldset className="signin-fields" disabled={mood === 'busy'}>
              <legend className="sr-only">Masuk atau daftar akun</legend>
              <label className="miro-field"><span>Email</span><input type="email" required autoComplete="email" value={email} {...focus('email')} onChange={e => { setEmail(e.target.value); setSad(false) }} /></label>
              <label className="miro-field"><span>Kata sandi</span><input type="password" required minLength={8} maxLength={256} autoComplete="current-password" value={password} {...focus('secret')} onChange={e => { setPassword(e.target.value); setSad(false) }} /></label>
              <div className="miro-actions-row">
                <button className="button primary" type="submit">Masuk</button>
                <button className="button" type="button" disabled={!email.trim() || password.length < 10} onClick={() => submitPassword(true)}>Daftar</button>
              </div>
              <small>Akun baru memakai kata sandi minimal 10 karakter.</small>
            </fieldset>
          </form>
        </details>}
      </>}
      <ol className="signin-steps" aria-label="Langkah memulai">
        <li aria-current="step">Masuk</li><li>Siapkan pot</li><li>Amankan akun dengan 2FA</li>
      </ol>
    </div>
  </div>
}
