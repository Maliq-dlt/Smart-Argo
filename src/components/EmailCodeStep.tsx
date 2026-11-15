import { useEffect, useRef, useState } from 'react'
import { normalizeEmailCode } from '../lib/signupForm'

/** The sign-up step after "Buat akun": the six-digit code from the confirmation email. The code is sent as soon as the
 * sixth digit is in, once; a wrong code clears the field and the cursor returns to it. */
export default function EmailCodeStep({ email, busy, waitSeconds, onVerify, onResend, onBack }: {
  email: string; busy: boolean
  /** Seconds before "send again" opens: 60 right after an email went out, 0 when the person only came back to this step. */
  waitSeconds: number
  onVerify(code: string): Promise<void>; onResend(): Promise<void>; onBack(): void
}) {
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(waitSeconds)
  const input = useRef<HTMLInputElement>(null)
  const sent = useRef('') // the code in flight: auto-send on the sixth digit and Enter must not both send it

  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])
  // On arrival and after each answer (the field is disabled while a request is out), the cursor is in the code field.
  useEffect(() => { if (!busy) input.current?.focus() }, [busy])

  async function verify(value: string) {
    if (value.length !== 6 || busy || sent.current === value) return
    sent.current = value
    try { await onVerify(value) } finally { sent.current = ''; setCode('') }
  }

  return <form onSubmit={event => { event.preventDefault(); void verify(code) }}>
    <fieldset className="signin-fields" disabled={busy}>
      <legend className="sr-only">Verifikasi email</legend>
      <p>Kami kirim kode 6 angka ke <b>{email}</b>. Berlaku 10 menit.</p>
      <label className="miro-field code-field"><span>Kode verifikasi</span>
        <input ref={input} inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" value={code}
          onChange={event => { const next = normalizeEmailCode(event.target.value); setCode(next); void verify(next) }} />
      </label>
      <button className="button primary signin-submit" type="submit">Verifikasi email</button>
      <div className="miro-actions-row">
        <button className="button" type="button" disabled={wait > 0} onClick={() => { setWait(60); void onResend() }}>
          {wait > 0 ? `Kirim ulang dalam ${wait} dtk` : 'Kirim ulang kode'}
        </button>
        <button className="link-button" type="button" onClick={onBack}>Ganti email</button>
      </div>
    </fieldset>
  </form>
}
