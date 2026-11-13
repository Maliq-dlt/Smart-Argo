import QrScanner from './QrScanner'
import ProductTransfer from './ProductTransfer'
import { useState } from 'react'
import { useAccount } from './accountContext'
import { parseProductChallenge, parsePublicStatus, type ProductChallenge, type PublicStatus } from '../lib/productAccountClient'

function initialSerial() {
  const value = new URLSearchParams(window.location.search).get('serial') ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) ? value.toUpperCase() : ''
}

export default function ProductAccount() {
  const account = useAccount()
  const client = account.client!
  const { products } = account
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [serial, setSerial] = useState(initialSerial)
  const [challenge, setChallenge] = useState<ProductChallenge | null>(null)
  const [sealedCode, setSealedCode] = useState('')
  const [signature, setSignature] = useState('')
  const [status, setStatus] = useState<PublicStatus | null>(null)

  const loadProducts = () => account.refresh()
  async function run(action: () => Promise<void>) {
    setPending(true); setMessage(''); setError(false)
    try { await action() } catch (err) {
      if (!client.session) { setChallenge(null); account.expire() }
      setError(true); setMessage(err instanceof Error ? err.message : 'Permintaan gagal.')
    } finally { setPending(false) }
  }

  /** ID-01: registry status of the serial, available before signing in. */
  async function checkStatus(value: string, warning?: string) {
    await run(async () => {
      setStatus(null)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value.trim())) throw new Error('Nomor seri tidak valid.')
      try { setStatus(parsePublicStatus(await client.publicStatus(value.trim()))) } catch (err) {
        if ((err as { code?: string }).code === 'not_registered') throw new Error(`Nomor seri ${value.trim().toUpperCase()} tidak ada di registri Smart Agro.`)
        throw err
      }
      if (warning) { setError(true); setMessage(warning) }
    })
  }
  const mine = status && products.some(p => p.serial_public === status.serial_public)
  const statusText = !status ? '' : status.registry_status === 'revoked' ? 'Dicabut oleh penerbit. Jangan diaktifkan; hubungi penjual.'
    : status.registry_status === 'pending' ? 'Terdaftar, tetapi belum aktif di registri.'
    : mine ? 'Terdaftar dan milik akun Anda.'
    : status.claimed ? 'Terdaftar dan sudah dimiliki akun lain. Untuk membeli bekas, minta pemilik membuat kode transfer.'
    : 'Terdaftar dan belum diklaim. Aktivasi memakai kode tersegel di kemasan.'

  return <section className="panel miro-card" aria-labelledby="product-account-heading">
    <div className="panel-heading"><h2 id="product-account-heading">Produk & kepemilikan</h2><span className="tag">ONLINE</span></div>
    <div className="miro-card-body" aria-busy={pending}>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
      <form onSubmit={event => { event.preventDefault(); void checkStatus(serial) }}><fieldset className="product-account-form" disabled={pending}><legend>Produk</legend>
        <label className="miro-field"><span>Nomor seri produk / QR</span><input value={serial} maxLength={120} required onChange={e => { setSerial(e.target.value); setStatus(null); setChallenge(null); setSealedCode(''); setSignature('') }} /></label>
        <div className="miro-actions-row"><QrScanner onSerial={(value, warning) => { setSerial(value); setChallenge(null); setSealedCode(''); setSignature(''); void checkStatus(value, warning) }} />
        <button className="button" type="submit">Periksa status</button></div>
        {status && <div className="miro-callout product-status" data-status={status.registry_status}><strong>{status.serial_public} · {status.variant === 'single_pot' ? 'Satu pot' : 'Kebun'}</strong><p>{statusText}</p><small>Status registri bukan bukti keaslian fisik perangkat.</small></div>}
      </fieldset></form>
      <div className="miro-actions-row"><button className="button" disabled={pending} onClick={() => void run(loadProducts)}>Muat ulang produk</button></div>
      <h3>Produk saya</h3>
      {products.length ? <ul aria-label="Produk saya">{products.map(product => <li key={product.ownership_id}>{product.serial_public} · {product.variant === 'single_pot' ? 'Satu pot' : 'Kebun'}</li>)}</ul> : <p>Belum ada produk yang diklaim.</p>}
      <form onSubmit={event => {
        event.preventDefault()
        void run(async () => {
          setChallenge(null); setSealedCode(''); setSignature('')
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(serial.trim())) throw new Error('Nomor seri tidak valid.')
          const value = await client.rpc('issue_activation_nonce', { p_serial: serial.trim().toUpperCase() })
          setChallenge(parseProductChallenge(value))
        })
      }}><fieldset className="product-account-form" disabled={pending || !serial.trim()}><legend>Aktivasi produk</legend>
        <p>Klaim {serial.trim() ? <strong>{serial.trim().toUpperCase()}</strong> : 'produk dengan nomor seri di atas'} memakai kode tersegel dan tanda tangan perangkat.</p>
        <button className="button" type="submit">Minta challenge perangkat</button>
      </fieldset></form>
      {challenge && <form onSubmit={event => {
        event.preventDefault()
        void run(async () => {
          try {
            if (Date.parse(challenge.expires_at) <= Date.now()) throw new Error('Challenge kedaluwarsa. Minta challenge baru.')
            if (!/^[A-Za-z0-9+/]{86}==$/.test(signature.trim())) throw new Error('Tanda tangan harus base64 Ed25519 (64 byte).')
            await client.claim(challenge.nonce_id, sealedCode, signature.trim())
            setChallenge(null); await loadProducts(); setMessage('Produk berhasil diklaim dan tersimpan pada akun.')
          } finally { setSealedCode(''); setSignature('') }
        })
      }}><fieldset className="product-account-form" disabled={pending}><legend>Bukti perangkat</legend>
        <p>Kirim teks challenge persis ke perangkat. Masukkan tanda tangan Ed25519 dari perangkat; aplikasi tidak membuat tanda tangan.</p>
        <label className="miro-field"><span>Challenge (berlaku sampai {new Date(challenge.expires_at).toLocaleTimeString('id-ID')})</span><textarea readOnly rows={5} value={challenge.challenge} /></label>
        <button className="button" type="button" onClick={() => void run(async () => { await navigator.clipboard.writeText(challenge.challenge); setMessage('Challenge disalin.') })}>Salin challenge</button>
        <div className="miro-form-two">
          <label className="miro-field"><span>Kode aktivasi tersegel</span><input type="password" autoComplete="off" required maxLength={256} value={sealedCode} onChange={e => setSealedCode(e.target.value)} /></label>
          <label className="miro-field"><span>Tanda tangan perangkat (base64)</span><input autoComplete="off" required maxLength={88} value={signature} onChange={e => setSignature(e.target.value)} /></label>
        </div><button className="button" type="submit">Verifikasi & klaim produk</button>
      </fieldset></form>}
      <ProductTransfer client={client} products={products} serial={serial} onChanged={loadProducts} />
    </div>
  </section>
}
