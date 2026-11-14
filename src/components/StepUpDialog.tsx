import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** Asked when an operator or curator write needs a fresh authenticator code (the server's step-up rule); the call
 * is repeated once the code is verified. Cancelling leaves the action undone. */
export default function StepUpDialog({ onDone }: { onDone: (code: string | null) => void }) {
  const [code, setCode] = useState('')
  return <Dialog open onOpenChange={open => { if (!open) onDone(null) }}>
    <DialogContent className="step-up-dialog">
      <DialogTitle>Konfirmasi dengan 2FA</DialogTitle>
      <DialogDescription>Aksi ini memerlukan kode terbaru dari aplikasi autentikator. Kode berlaku untuk aksi berikutnya selama 5 menit.</DialogDescription>
      <form className="signin-fields" onSubmit={event => { event.preventDefault(); onDone(code) }}>
        <label className="miro-field"><span>Kode autentikator</span>
          <input autoFocus inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="miro-actions-row"><button className="button primary" type="submit">Konfirmasi</button><button className="button" type="button" onClick={() => onDone(null)}>Batal</button></div>
      </form>
    </DialogContent>
  </Dialog>
}
