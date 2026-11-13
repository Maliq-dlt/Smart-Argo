import { ArrowsLeftRight, Copy } from '@phosphor-icons/react'
import { useState } from 'react'
import type { OwnedProduct, ProductAccountClient } from '../lib/productAccountClient'
import { SelectField } from './ui/select'

const ERRORS: Record<string, string> = {
  reauth_required: 'Kata sandi perlu dikonfirmasi ulang.', not_owner: 'Produk ini bukan milik akun Anda atau sudah dicabut.',
  invalid_code: 'Kode transfer salah. Setelah lima kali salah, kode tidak berlaku.', transfer_unavailable: 'Tidak ada transfer terbuka untuk seri ini, atau kodenya kedaluwarsa.',
  self_transfer: 'Produk ini sudah milik Anda.', unauthorized: 'Sesi berakhir. Masuk kembali.',
}
const say = (error: unknown) => ERRORS[(error as { code?: string })?.code ?? ''] ?? (error instanceof Error ? error.message : 'Transfer gagal.')
const email = (token: string) => { try { return String(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? '') } catch { return '' } }

/** ID-03: the owner re-confirms (authenticator code, password, or a fresh Google sign-in), then hands a one-time
 * code to the buyer, who enters it with the serial. */
export default function ProductTransfer({ client, products, serial, onChanged }: { client: ProductAccountClient; products: OwnedProduct[]; serial: string; onChanged: () => Promise<void> }) {
  const [productId, setProductId] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [offer, setOffer] = useState<{ productId: string; code: string; expires: string } | null>(null)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null)
  const run = async (action: () => Promise<string>) => {
    setPending(true); setNote(null)
    try { setNote({ error: false, text: await action() }) } catch (error) { setNote({ error: true, text: say(error) }) } finally { setPending(false) }
  }
  const owned = products.find(p => p.product_id === productId)
  // A fresh authenticator code is enough with 2FA; otherwise the password, or for Google accounts a sign-in from the last ten minutes.
  const viaCode = client.mfa, viaPassword = !viaCode && !client.passwordless
  const [needGoogle, setNeedGoogle] = useState(false)

  return <section className="product-transfer" aria-labelledby="product-transfer-heading">
    <h3 id="product-transfer-heading"><ArrowsLeftRight weight="duotone" aria-hidden="true" />Transfer kepemilikan</h3>
    {note && <p role={note.error ? 'alert' : 'status'}>{note.text}</p>}
    {products.length > 0 && <form onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        if (!owned) throw new Error('Pilih produk yang akan ditransfer.')
        try {
          if (viaCode) await client.verifyMfa(otp)
          else if (viaPassword) await client.authenticate(email(client.session?.access_token ?? ''), password, false)
        } finally { setPassword(''); setOtp('') }
        const value = await client.rpc('create_transfer_offer', { p_product_id: productId }).catch(error => {
          if ((error as { code?: string }).code === 'reauth_required' && client.passwordless) { setNeedGoogle(true); throw new Error('Masuk ulang dengan Google untuk mengonfirmasi transfer ini.') }
          throw error
        })
        setNeedGoogle(false)
        setOffer({ productId, code: String(value.code), expires: String(value.expires_at) })
        return 'Kode transfer dibuat. Berikan hanya kepada pembeli; kode berlaku sekali.'
      })
    }}><fieldset className="product-account-form" disabled={pending}><legend>Serahkan produk ke akun lain</legend>
      <div className="miro-form-two">
        <label className="miro-field"><span>Produk</span><SelectField label="Produk yang ditransfer" placeholder="Pilih produk" value={productId} onValueChange={value => { setProductId(value); setOffer(null) }} options={products.map(p => ({ value: p.product_id, label: p.serial_public }))} /></label>
        {viaPassword && <label className="miro-field"><span>Konfirmasi kata sandi</span><input type="password" required minLength={8} maxLength={256} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>}
        {viaCode && <label className="miro-field"><span>Kode 2FA transfer</span><input inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} /></label>}
      </div>
      <div className="miro-actions-row"><button className="button" type="submit">Buat kode transfer</button>
        {needGoogle && <button className="button" type="button" onClick={() => void client.startGoogle(`${location.origin}${location.pathname}#profil`)}>Masuk ulang dengan Google</button>}</div>
    </fieldset></form>}
    {offer && owned && <div className="miro-callout" aria-live="polite">
      <strong>Kode transfer {owned.serial_public}</strong>
      <code className="transfer-code">{offer.code.match(/.{4}/g)!.join('-')}</code>
      <small>Berlaku sampai {new Date(offer.expires).toLocaleString('id-ID')}. Kepemilikan Anda berakhir saat kode diterima.</small>
      <div className="miro-actions-row">
        <button type="button" className="button" onClick={() => void navigator.clipboard.writeText(offer.code).then(() => setNote({ error: false, text: 'Kode disalin.' }))}><Copy aria-hidden="true" />Salin kode</button>
        <button type="button" className="button" disabled={pending} onClick={() => void run(async () => { await client.rpc('cancel_transfer_offer', { p_product_id: offer.productId }); setOffer(null); return 'Transfer dibatalkan; kode tidak berlaku lagi.' })}>Batalkan transfer</button>
      </div>
    </div>}
    <form onSubmit={event => {
      event.preventDefault()
      void run(async () => {
        await client.rpc('accept_transfer', { p_serial: serial.trim(), p_code: code })
        setCode(''); await onChanged()
        return `Produk ${serial.trim().toUpperCase()} sekarang milik akun Anda.`
      })
    }}><fieldset className="product-account-form" disabled={pending}><legend>Terima produk dari pemilik sebelumnya</legend>
      <p>Pakai nomor seri di atas dan kode dari pemilik lama.</p>
      <label className="miro-field"><span>Kode transfer</span><input required autoComplete="off" maxLength={64} value={code} onChange={e => setCode(e.target.value)} /></label>
      <button className="button" type="submit" disabled={!serial.trim()}>Terima kepemilikan</button>
    </fieldset></form>
  </section>
}
