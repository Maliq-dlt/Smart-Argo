import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** After a password-reset link signed the person in (APP-01): set the new password before anything else. Closing it
 * keeps the session but leaves the old password in place. */
export default function NewPasswordDialog({ onSave, onClose }: { onSave: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const short = password.length < 10
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="step-up-dialog">
      <DialogTitle>Buat kata sandi baru</DialogTitle>
      <DialogDescription>Anda masuk lewat tautan reset. Kata sandi baru berlaku untuk masuk berikutnya; penukaran dan transfer ditahan 24 jam.</DialogDescription>
      <form className="signin-fields" onSubmit={event => {
        event.preventDefault(); if (short) return
        setBusy(true); setError('')
        onSave(password).catch(err => setError(err instanceof Error ? err.message : 'Kata sandi gagal disimpan.')).finally(() => setBusy(false))
      }}>
        <label className="miro-field"><span>Kata sandi baru</span>
          <input autoFocus type="password" autoComplete="new-password" required minLength={10} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} aria-describedby="new-password-hint" />
        </label>
        <small id="new-password-hint" className="signin-hint" data-ok={!short || undefined}>{short ? `Minimal 10 karakter${password ? ` · kurang ${10 - password.length}` : ''}.` : 'Panjang kata sandi sudah cukup.'}</small>
        {error && <p role="alert">{error}</p>}
        <div className="miro-actions-row"><button className="button primary" type="submit" disabled={busy} aria-disabled={short || undefined}>Simpan</button><button className="button" type="button" onClick={onClose}>Nanti</button></div>
      </form>
    </DialogContent>
  </Dialog>
}
