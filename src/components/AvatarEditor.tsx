import { Camera, Trash } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { useAccount } from './accountContext'
import { avatarFromFile, avatarSrc, googlePhoto, initialsOf } from '../lib/avatar'
import { tokenClaims } from '../lib/productAccountClient'

/** The profile photo: pick a picture (phones offer the camera too), keep its centre square, or go back to initials
 * (or the Google photo for Google accounts). Only the owner can read it back. */
export default function AvatarEditor() {
  const account = useAccount()
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null)
  const { client, identity, avatar, setAvatar } = account
  if (!client || !identity) return null
  const google = googlePhoto(tokenClaims(client.session?.access_token))
  const own = Boolean(avatar && avatar !== google)
  const run = async (action: () => Promise<string>) => {
    setPending(true); setNote(null)
    try { setNote({ error: false, text: await action() }) } catch (err) { setNote({ error: true, text: err instanceof Error ? err.message : 'Foto gagal disimpan.' }) } finally { setPending(false) }
  }
  return <div className="avatar-editor">
    {avatar ? <img className="avatar-large" src={avatar} alt={`Foto profil ${identity.name}`} referrerPolicy="no-referrer" />
      : <span className="avatar-large" role="img" aria-label={`Inisial ${identity.name}`}>{initialsOf(identity.name)}</span>}
    <div className="avatar-actions">
      <input ref={input} type="file" accept="image/*" hidden onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void run(async () => {
          const photo = await avatarFromFile(file)
          await client.rpc('set_my_avatar', { p_mime: photo.mime, p_data: photo.data })
          setAvatar(avatarSrc(photo))
          return 'Foto profil disimpan.'
        })
      }} />
      <button type="button" className="button" disabled={pending} onClick={() => input.current?.click()}><Camera aria-hidden="true" />{own ? 'Ganti foto' : 'Pilih foto'}</button>
      {own && <button type="button" className="button" disabled={pending} onClick={() => void run(async () => {
        await client.rpc('clear_my_avatar'); setAvatar(google); return google ? 'Foto dihapus. Foto Google dipakai lagi.' : 'Foto dihapus. Inisial dipakai lagi.'
      })}><Trash aria-hidden="true" />Hapus foto</button>}
      {note && <small className={note.error ? 'field-error' : 'muted'} role={note.error ? 'alert' : undefined} aria-live="polite">{note.text}</small>}
    </div>
  </div>
}
