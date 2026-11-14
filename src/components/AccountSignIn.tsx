import { GoogleLogo } from '@phosphor-icons/react'
import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import Mascot, { type Face } from './Mascot'

export type GuardMood = 'idle' | 'busy' | 'error' | 'welcome'
type Field = 'email' | 'secret' | null
type Mode = 'signin' | 'signup'
/** GoTrue's own minimum for new passwords (supabase/config.toml and the hosted Auth settings). */
const NEW_PASSWORD_MIN = 10

const faceOf: Record<GuardMood, Face> = { idle: 'smile', busy: 'think', error: 'sad', welcome: 'happy' }
const caption = (mood: GuardMood, field: Field, mode: Mode) => mood === 'error' ? 'Ups, belum cocok. Coba sekali lagi, ya.'
  : mood === 'busy' ? 'Sebentar, saya cek dulu…' : mood === 'welcome' ? 'Asyik, selamat datang!'
  : field === 'secret' ? 'Mata saya tutup. Janji tidak mengintip… hehe.' : field === 'email' ? 'Wah, saya ikut membaca!'
  : mode === 'signup' ? 'Halo! Ayo siapkan pot pertama Anda.' : 'Halo! Saya penjaga pot Anda.'

let ruler: CanvasRenderingContext2D | null = null
/** Where the caret sits across the input, -1 (left edge) to 1 (right edge), so the mascot reads along. */
function caretAt(input: HTMLInputElement) {
  ruler ??= document.createElement('canvas').getContext('2d')
  if (!ruler) return 0
  const style = getComputedStyle(input)
  ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const text = input.value.slice(0, input.selectionEnd ?? input.value.length)
  const x = parseFloat(style.paddingLeft) + ruler.measureText(text).width - input.scrollLeft
  return Math.max(-1, Math.min(1, x / Math.max(1, input.clientWidth) * 2 - 1))
}

interface Props {
  mood: GuardMood
  google: boolean | null
  mfaStep: boolean
  onGoogle: () => void
  onPassword: (email: string, password: string, signup: boolean) => Promise<void>
  onCode: (code: string) => Promise<void>
  onCancelCode: () => void
  /** Lost authenticator: spend a one-time recovery code instead of the 6-digit code (APP-01). */
  onRecoveryCode?: (code: string) => Promise<void>
  /** Send a password-reset link to this email (APP-01). */
  onForgot?: (email: string) => Promise<void>
  /** Continue without an account; data stays in this browser. */
  onGuest?: () => void
}

/** Sign-in and sign-up on one card: Google first when the server offers it, then the email form, always open, with
 * "Masuk" and "Daftar" as tabs so creating an account is never hidden behind a fold. */
export default function AccountSignIn({ mood, google, mfaStep, onGoogle, onPassword, onCode, onCancelCode, onRecoveryCode, onForgot, onGuest }: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [recovering, setRecovering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [field, setField] = useState<Field>(null)
  const [caret, setCaret] = useState(0)
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ signin: null, signup: null })
  const id = useId(), hint = `${id}-hint`
  // Droops on each new failure and perks up once the person starts correcting the form.
  const [sad, setSad] = useState(mood === 'error')
  const [lastMood, setLastMood] = useState(mood)
  if (mood !== lastMood) { setLastMood(mood); setSad(mood === 'error') }
  const shown: GuardMood = mood === 'error' && !sad ? 'idle' : mood
  const focus = (value: Field) => ({ onFocus: () => setField(value), onBlur: () => setField(null) })
  const follow = (event: SyntheticEvent<HTMLInputElement>) => setCaret(caretAt(event.currentTarget))
  const signup = mode === 'signup', short = signup && password.length < NEW_PASSWORD_MIN
  // Reading: along the line it types into (below and to the right of the mascot); thinking: up and away.
  const look = shown === 'busy' ? { x: .8, y: -1 } : field === 'email' ? { x: .3 + caret * .7, y: .9 } : { x: .35, y: .2 }
  const pick = (next: Mode) => { setMode(next); setSad(false); tabs.current[next]?.focus() }
  const arrows = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); pick(signup ? 'signin' : 'signup') } }

  return <div className="signin">
    <div className="signin-guard">
      {/* Typing the email it beams and reads along; on the password it shuts its eyes, shy, and now and then peeks. */}
      <Mascot className="guardian" face={field === 'email' && shown === 'idle' ? 'joy' : faceOf[shown]} look={look} hands hide={field === 'secret' && shown !== 'busy'} bud={shown === 'welcome'} />
      <p aria-hidden="true">{caption(shown, field, mode)}</p>
    </div>
    <div className="signin-body">
      <h3>{mfaStep ? 'Satu langkah lagi' : signup ? 'Buat akun Smart Agro' : 'Masuk ke Smart Agro'}</h3>
      {mfaStep ? <form onSubmit={event => { event.preventDefault(); void (recovering && onRecoveryCode ? onRecoveryCode(otp) : onCode(otp)).finally(() => setOtp('')) }}>
        <fieldset className="signin-fields" disabled={mood === 'busy'}>
          <legend className="sr-only">Verifikasi dua langkah</legend>
          {recovering ? <>
            <p>Masukkan salah satu kode pemulihan. Kode hanya berlaku sekali.</p>
            <label className="miro-field"><span>Kode pemulihan</span><input autoComplete="off" autoCapitalize="characters" required pattern="[0-9A-Fa-f]{4}[\s-]?[0-9A-Fa-f]{4}[\s-]?[0-9A-Fa-f]{4}" maxLength={16} value={otp} {...focus('secret')} onChange={e => { setOtp(e.target.value); setSad(false) }} /></label>
          </> : <>
            <p>Masukkan kode 6 angka dari aplikasi autentikator Anda.</p>
            <label className="miro-field"><span>Kode autentikator</span><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={otp} {...focus('secret')} onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setSad(false) }} /></label>
          </>}
          <div className="miro-actions-row"><button className="button primary" type="submit">Verifikasi</button><button className="button" type="button" onClick={() => { setOtp(''); setRecovering(false); onCancelCode() }}>Batal</button></div>
          {onRecoveryCode && <small className="signin-switch"><button type="button" className="link-button" onClick={() => { setOtp(''); setRecovering(r => !r) }}>{recovering ? 'Pakai kode autentikator' : 'Autentikator hilang? Pakai kode pemulihan'}</button></small>}
        </fieldset>
      </form> : <>
        <p className="signin-lede">Satu akun untuk pot, data sensor, dan poin Anda.</p>
        <div className="signin-quick">
          {google && <button className="button primary signin-google" type="button" disabled={mood === 'busy'} onClick={onGoogle}><GoogleLogo weight="bold" aria-hidden="true" />Lanjut dengan Google</button>}
          {onGuest && <button className="button signin-guest" type="button" disabled={mood === 'busy'} onClick={onGuest}>Coba tanpa akun</button>}
        </div>
        {(google || onGuest) && <small className="signin-note">{google ? 'Akun Google dibuat otomatis saat pertama masuk. ' : ''}{onGuest ? 'Data tamu hanya tersimpan di browser ini.' : ''}</small>}
        {google === null && <small className="signin-note">Memuat pilihan masuk…</small>}
        <div className="signin-or"><span>{google || onGuest ? 'atau pakai email' : 'Pakai email'}</span></div>
        <div className="signin-mode" role="tablist" aria-label="Masuk atau daftar" data-mode={mode}>
          <button ref={el => { tabs.current.signin = el }} type="button" role="tab" id={`${id}-signin`} aria-selected={!signup} aria-controls={`${id}-form`} tabIndex={signup ? -1 : 0} onClick={() => pick('signin')} onKeyDown={arrows}>Masuk</button>
          <button ref={el => { tabs.current.signup = el }} type="button" role="tab" id={`${id}-signup`} aria-selected={signup} aria-controls={`${id}-form`} tabIndex={signup ? 0 : -1} onClick={() => pick('signup')} onKeyDown={arrows}>Daftar</button>
        </div>
        <form id={`${id}-form`} role="tabpanel" aria-labelledby={`${id}-${mode}`} onSubmit={event => { event.preventDefault(); if (!short) void onPassword(email.trim(), password, signup).finally(() => setPassword('')) }}>
          <fieldset className="signin-fields" disabled={mood === 'busy'}>
            <legend className="sr-only">{signup ? 'Daftar akun baru' : 'Masuk dengan email'}</legend>
            <label className="miro-field"><span>Email</span><input type="email" required autoComplete="email" value={email} {...focus('email')}
              onChange={e => { setEmail(e.target.value); setSad(false); follow(e) }} onSelect={follow} onKeyUp={follow} onClick={follow} /></label>
            <label className="miro-field"><span>Kata sandi</span><input type="password" required minLength={signup ? NEW_PASSWORD_MIN : 1} maxLength={256}
              autoComplete={signup ? 'new-password' : 'current-password'} aria-describedby={signup ? hint : undefined} value={password} {...focus('secret')}
              onChange={e => { setPassword(e.target.value); setSad(false) }} /></label>
            {signup && <small id={hint} className="signin-hint" data-ok={!short || undefined}>
              {short ? `Minimal ${NEW_PASSWORD_MIN} karakter${password ? ` · kurang ${NEW_PASSWORD_MIN - password.length}` : ''}.` : 'Panjang kata sandi sudah cukup.'} Setelah daftar, buka tautan konfirmasi di email Anda.
            </small>}
            <button className="button primary signin-submit" type="submit" aria-disabled={short || undefined}>{signup ? 'Buat akun' : 'Masuk'}</button>
            {!signup && onForgot && <button type="button" className="link-button signin-forgot" onClick={() => void onForgot(email.trim())}>Lupa kata sandi?</button>}
            <small className="signin-switch">{signup ? 'Sudah punya akun? ' : 'Belum punya akun? '}
              <button type="button" className="link-button" onClick={() => pick(signup ? 'signin' : 'signup')}>{signup ? 'Masuk' : 'Daftar sekarang'}</button>
            </small>
          </fieldset>
        </form>
      </>}
      <ol className="signin-steps" aria-label="Langkah memulai">
        <li aria-current="step">{signup ? 'Daftar' : 'Masuk'}</li><li>Siapkan pot</li><li>Amankan akun dengan 2FA</li>
      </ol>
    </div>
  </div>
}
