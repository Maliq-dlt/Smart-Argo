import { GoogleLogo } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import EmailCodeStep from './EmailCodeStep'
import Mascot, { type Face } from './Mascot'
import { DISPLAY_NAME_MAX, checkSignup } from '../lib/signupForm'

export type GuardMood = 'idle' | 'busy' | 'error' | 'welcome'
type Field = 'email' | 'secret' | null
type Mode = 'signin' | 'signup'
/** GoTrue's own minimum for new passwords (supabase/config.toml and the hosted Auth settings). */
const NEW_PASSWORD_MIN = 10

const faceOf: Record<GuardMood, Face> = { idle: 'smile', busy: 'think', error: 'sad', welcome: 'happy' }
const caption = (mood: GuardMood, field: Field, mode: Mode, codeStep: boolean) => mood === 'error' ? 'Ups, belum cocok. Coba sekali lagi, ya.'
  : mood === 'busy' ? 'Sebentar, saya cek dulu…' : mood === 'welcome' ? 'Asyik, selamat datang!'
  : codeStep ? 'Hampir selesai! Cek email Anda, ya.' : field === 'secret' ? 'Mata saya tutup. Janji tidak mengintip… hehe.' : field === 'email' ? 'Wah, saya ikut membaca!'
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

/** A row that opens and closes in place (grid rows 0fr to 1fr, see .collapse). The form keeps one shape in both modes,
 * so switching tabs grows and shrinks the card smoothly instead of swapping fields in and out. Closed rows are hidden
 * from the keyboard and screen readers once the motion is over. */
function Collapse({ open, tight, children }: { open: boolean; tight?: boolean; children: ReactNode }) {
  return <div className="collapse" data-open={open || undefined} data-tight={tight || undefined}><div>{children}</div></div>
}

/** Eases the card to its new height when the view changes (form, email code, second factor), so it never snaps. */
function useHeightMorph(view: string) {
  const box = useRef<HTMLDivElement>(null), seen = useRef(0), was = useRef(view), run = useRef<Animation | null>(null)
  useEffect(() => {
    const el = box.current!
    seen.current = el.offsetHeight
    const watch = new ResizeObserver(() => { seen.current = el.offsetHeight })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (was.current === view) return
    was.current = view
    const el = box.current!, from = seen.current
    run.current?.cancel()
    const to = el.offsetHeight
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    run.current = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)' })
  }, [view])
  return box
}

interface Props {
  mood: GuardMood
  google: boolean | null
  mfaStep: boolean
  /** The address whose sign-up code is awaited (also after signing in with an unconfirmed email); null otherwise. */
  codeEmail: string | null
  codeWait: number
  /** What the last action answered; it opens inside the card, so the page never shifts. */
  notice: { error: boolean; text: string } | null
  /** Set when a sign-up turned out to be an existing account: the card moves to "Masuk" with that email filled in. */
  existing: { email: string } | null
  onVerifyEmail: (code: string) => Promise<void>
  onResendEmail: () => Promise<void>
  onChangeEmail: () => void
  onGoogle: () => void
  onPassword: (email: string, password: string, signup: boolean, name?: string) => Promise<void>
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
export default function AccountSignIn({ mood, google, mfaStep, codeEmail, codeWait, notice, existing, onVerifyEmail, onResendEmail, onChangeEmail, onGoogle, onPassword, onCode, onCancelCode, onRecoveryCode, onForgot, onGuest }: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [recovering, setRecovering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [otp, setOtp] = useState('')
  const [field, setField] = useState<Field>(null)
  const [caret, setCaret] = useState(0)
  const tabs = useRef<Record<Mode, HTMLButtonElement | null>>({ signin: null, signup: null })
  const secret = useRef<HTMLInputElement>(null)
  const id = useId(), hint = `${id}-hint`
  // Droops on each new failure and perks up once the person starts correcting the form.
  const [sad, setSad] = useState(mood === 'error')
  const [lastMood, setLastMood] = useState(mood)
  if (mood !== lastMood) { setLastMood(mood); setSad(mood === 'error') }
  const shown: GuardMood = mood === 'error' && !sad ? 'idle' : mood
  // The notice keeps its words while its row closes, so it fades out instead of emptying first.
  const [lastNotice, setLastNotice] = useState(notice)
  if (notice && notice !== lastNotice) setLastNotice(notice)
  // A sign-up for an address that already has an account: show "Masuk" with that address, ready for the password.
  const [lastExisting, setLastExisting] = useState(existing)
  if (existing !== lastExisting) {
    setLastExisting(existing)
    if (existing) { setMode('signin'); setEmail(existing.email); setPassword(''); setConfirm(''); setSad(false) }
  }
  useEffect(() => { if (existing) secret.current?.focus() }, [existing])
  const focus = (value: Field) => ({ onFocus: () => setField(value), onBlur: () => setField(null) })
  const follow = (event: SyntheticEvent<HTMLInputElement>) => setCaret(caretAt(event.currentTarget))
  const signup = mode === 'signup', short = signup && password.length < NEW_PASSWORD_MIN
  const mismatch = signup && confirm.length > 0 && confirm !== password, blocked = short || mismatch
  // Red from the first keystroke until the rule is met, then green; an untouched field stays neutral.
  const passState = signup && password ? (short ? 'bad' : 'ok') : undefined
  const confirmState = signup && confirm ? (mismatch ? 'bad' : 'ok') : undefined
  const busy = mood === 'busy'
  const view = codeEmail ? 'code' : mfaStep ? 'mfa' : 'form'
  const card = useHeightMorph(view)
  // Reading: along the line it types into (below and to the right of the mascot); thinking: up and away.
  const look = shown === 'busy' ? { x: .8, y: -1 } : field === 'email' ? { x: .3 + caret * .7, y: .9 } : { x: .35, y: .2 }
  const pick = (next: Mode) => { setMode(next); setSad(false); tabs.current[next]?.focus() }
  const arrows = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); pick(signup ? 'signin' : 'signup') } }
  const flow = signup || Boolean(codeEmail)
  const steps: [string, boolean][] = [[flow ? 'Daftar' : 'Masuk', true], ['Verifikasi', flow], ['Siapkan pot', true], ['Amankan akun dengan 2FA', true]]

  return <div className="signin" ref={card}>
    <div className="signin-guard">
      {/* Typing the email it beams and reads along; on the password it shuts its eyes, shy, and now and then peeks. */}
      <Mascot className="guardian" face={field === 'email' && shown === 'idle' ? 'joy' : faceOf[shown]} look={look} hands hide={field === 'secret' && shown !== 'busy'} bud={shown === 'welcome'} />
      <p aria-hidden="true">{caption(shown, field, mode, Boolean(codeEmail))}</p>
    </div>
    <div className="signin-body">
      <Collapse open={Boolean(notice)}>
        {lastNotice && <p className="entry-notice" role={notice ? (notice.error ? 'alert' : 'status') : undefined}>{lastNotice.text}</p>}
      </Collapse>
      <h3 key={view}>{codeEmail ? 'Masukkan kode dari email' : mfaStep ? 'Satu langkah lagi' : signup ? 'Buat akun Smart Agro' : 'Masuk ke Smart Agro'}</h3>
      {codeEmail ? <EmailCodeStep email={codeEmail} busy={busy} waitSeconds={codeWait} onVerify={onVerifyEmail} onResend={onResendEmail} onBack={onChangeEmail} /> : mfaStep ? <form onSubmit={event => { event.preventDefault(); void (recovering && onRecoveryCode ? onRecoveryCode(otp) : onCode(otp)).finally(() => setOtp('')) }}>
        <fieldset className="signin-fields" disabled={busy}>
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
          {/* Stacked, and the Google row opens in place when the server says it is on: nothing beside it resizes. */}
          <Collapse open={google === true}><button className="button primary signin-google" type="button" disabled={busy} onClick={onGoogle}><GoogleLogo weight="bold" aria-hidden="true" />Lanjut dengan Google</button></Collapse>
          {onGuest && <button className="button signin-guest" type="button" disabled={busy} onClick={onGuest}>Coba tanpa akun</button>}
        </div>
        {(google || onGuest) && <small className="signin-note">{google ? 'Akun Google dibuat otomatis saat pertama masuk. ' : ''}{onGuest ? 'Data tamu hanya tersimpan di browser ini.' : ''}</small>}
        <div className="signin-or"><span>{google || onGuest ? 'atau pakai email' : 'Pakai email'}</span></div>
        <div className="signin-mode" role="tablist" aria-label="Masuk atau daftar" data-mode={mode}>
          <button ref={el => { tabs.current.signin = el }} type="button" role="tab" id={`${id}-signin`} aria-selected={!signup} aria-controls={`${id}-form`} tabIndex={signup ? -1 : 0} onClick={() => pick('signin')} onKeyDown={arrows}>Masuk</button>
          <button ref={el => { tabs.current.signup = el }} type="button" role="tab" id={`${id}-signup`} aria-selected={signup} aria-controls={`${id}-form`} tabIndex={signup ? 0 : -1} onClick={() => pick('signup')} onKeyDown={arrows}>Daftar</button>
        </div>
        <form id={`${id}-form`} role="tabpanel" aria-labelledby={`${id}-${mode}`} onSubmit={event => {
          event.preventDefault()
          const check = signup ? checkSignup({ name, password, confirm }) : null
          if (blocked || (check && !check.ok)) return
          void onPassword(email.trim(), password, signup, check?.ok ? check.name : undefined).finally(() => { setPassword(''); setConfirm('') })
        }}>
          <fieldset className="signin-fields" disabled={busy}>
            <legend className="sr-only">{signup ? 'Daftar akun baru' : 'Masuk dengan email'}</legend>
            <Collapse open={signup}><label className="miro-field"><span>Nama</span><input required={signup} autoComplete="name" maxLength={DISPLAY_NAME_MAX} pattern=".*[^ ].*" value={name} {...focus('email')}
              onChange={e => { setName(e.target.value); setSad(false); follow(e) }} onSelect={follow} onKeyUp={follow} onClick={follow} /></label></Collapse>
            <label className="miro-field"><span>Email</span><input type="email" required autoComplete="email" value={email} {...focus('email')}
              onChange={e => { setEmail(e.target.value); setSad(false); follow(e) }} onSelect={follow} onKeyUp={follow} onClick={follow} /></label>
            <label className="miro-field" data-state={passState}><span>Kata sandi</span><input ref={secret} type="password" required minLength={signup ? NEW_PASSWORD_MIN : 1} maxLength={256}
              autoComplete={signup ? 'new-password' : 'current-password'} aria-describedby={signup ? hint : undefined} value={password} {...focus('secret')}
              onChange={e => { setPassword(e.target.value); setSad(false) }} />
              {/* One box per required character: they fill red and turn green together with the field. */}
              <Collapse open={signup}><span className="pw-meter" aria-hidden="true" data-state={passState}>{Array.from({ length: NEW_PASSWORD_MIN }, (_, i) => <i key={i} data-on={i < password.length || undefined} />)}</span></Collapse>
            </label>
            <Collapse open={signup}><label className="miro-field" data-state={confirmState}><span>Konfirmasi kata sandi</span><input type="password" required={signup} maxLength={256} autoComplete="new-password" aria-describedby={hint} value={confirm} {...focus('secret')}
              onChange={e => { setConfirm(e.target.value); setSad(false) }} /></label></Collapse>
            <Collapse open={signup} tight><small id={hint} className="signin-hint" data-ok={!blocked || undefined} data-bad={(short && password.length > 0) || mismatch || undefined}>
              {short ? `Minimal ${NEW_PASSWORD_MIN} karakter${password ? ` · kurang ${NEW_PASSWORD_MIN - password.length}` : ''}.` : mismatch ? 'Konfirmasi kata sandi belum sama.' : 'Panjang kata sandi sudah cukup.'} Kami kirim kode 6 angka ke email Anda.
            </small></Collapse>
            <button className="button primary signin-submit" type="submit" aria-disabled={blocked || undefined} aria-busy={busy || undefined} data-busy={busy || undefined}>
              {busy ? (signup ? 'Membuat akun…' : 'Memeriksa…') : signup ? 'Buat akun' : 'Masuk'}
            </button>
            {!signup && onForgot && <button type="button" className="link-button signin-forgot" onClick={() => void onForgot(email.trim())}>Lupa kata sandi?</button>}
            <small className="signin-switch">{signup ? 'Sudah punya akun? ' : 'Belum punya akun? '}
              <button type="button" className="link-button" onClick={() => pick(signup ? 'signin' : 'signup')}>{signup ? 'Masuk' : 'Daftar sekarang'}</button>
            </small>
          </fieldset>
        </form>
      </>}
      <ol className="signin-steps" aria-label="Langkah memulai">
        {steps.map(([label, on], i) => <li key={i} data-off={on ? undefined : true} aria-current={i === (codeEmail ? 1 : 0) ? 'step' : undefined}>{label}</li>)}
      </ol>
    </div>
  </div>
}
