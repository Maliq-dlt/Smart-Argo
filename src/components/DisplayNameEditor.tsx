import { useState } from 'react'

/** The "Nama" value in Profil › Akun, with the field to change it in place. Validation lives in the client
 * (`updateDisplayName`), so the message the person sees is the one the rule produces. */
export default function DisplayNameEditor({ name, onSave }: { name: string; onSave(next: string): Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true); setError('')
    try { await onSave(value); setEditing(false) }
    catch (err) { setError(err instanceof Error ? err.message : 'Nama belum tersimpan. Coba lagi.') }
    finally { setBusy(false) }
  }

  if (!editing) return <span className="name-editor">
    <span>{name}</span>
    <button type="button" className="link-button" onClick={() => { setValue(name); setError(''); setEditing(true) }}>Ubah nama</button>
  </span>
  return <form className="name-editor" onSubmit={event => { event.preventDefault(); void save() }}>
    <label className="miro-field"><span className="sr-only">Nama</span><input value={value} autoComplete="name" autoFocus onChange={event => setValue(event.target.value)} /></label>
    <button type="submit" className="button primary" disabled={busy}>Simpan</button>
    <button type="button" className="button" disabled={busy} onClick={() => setEditing(false)}>Batal</button>
    {error && <small className="field-error" role="alert">{error}</small>}
  </form>
}
