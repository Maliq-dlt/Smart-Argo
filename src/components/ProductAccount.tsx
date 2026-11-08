import ProductRewards from './ProductRewards'
import ProductEnergy from './ProductEnergy'
import ProductKnowledge from './ProductKnowledge'
import ProductTelemetry from './ProductTelemetry'
import { useEffect, useState } from 'react'
import { ProductAccountClient, productAccountConfigured, parseOwnedProducts, parseProductChallenge, type OwnedProduct, type ProductChallenge } from '../lib/productAccountClient'

function initialSerial() {
  const value = new URLSearchParams(window.location.search).get('serial') ?? ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) ? value.toUpperCase() : ''
}

export default function ProductAccount() {
  const [client] = useState(() => new ProductAccountClient())
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serial, setSerial] = useState(initialSerial)
  const [challenge, setChallenge] = useState<ProductChallenge | null>(null)
  const [sealedCode, setSealedCode] = useState('')
  const [signature, setSignature] = useState('')
  const [products, setProducts] = useState<OwnedProduct[]>([])

  function clearAccount() { setSignedIn(false); setChallenge(null); setProducts([]); setSealedCode(''); setSignature('') }
  async function loadProducts() {
    await client.rpc('ensure_my_account')
    const result = await client.rpc('my_products')
    setProducts(parseOwnedProducts(result.products))
  }
  async function run(action: () => Promise<void>) {
    setPending(true); setMessage(''); setError(false)
    try { await action() } catch (err) {
      if (!client.session) clearAccount()
      setError(true); setMessage(err instanceof Error ? err.message : 'Permintaan gagal.')
    } finally { setSignedIn(Boolean(client.session)); setPending(false) }
  }

  useEffect(() => {
    if (!productAccountConfigured) return
    let active = true
    client.restore().then(async () => {
      if (client.session) {
        await client.rpc('ensure_my_account')
        const result = await client.rpc('my_products')
        const restoredProducts = parseOwnedProducts(result.products)
        if (active) setProducts(restoredProducts)
      }
    }).catch(err => {
      if (active) { setError(true); setMessage(err instanceof Error ? err.message : 'Sesi gagal dipulihkan.') }
    }).finally(() => { if (active) { setReady(true); setSignedIn(Boolean(client.session)) } })
    return () => { active = false }
  }, [client])

  useEffect(() => {
    if (!signedIn) return
    let active = true
    const timer = window.setInterval(() => {
      client.refreshIfNeeded().catch(err => { if (!active) return; clearAccount(); setError(true); setMessage(err instanceof Error ? err.message : 'Sesi berakhir.') })
    }, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [client, signedIn])

  if (!productAccountConfigured) return <section className="panel miro-card" aria-label="Akun produk online"><div className="panel-heading"><h2>Akun produk online</h2></div><div className="miro-card-body"><p>Layanan akun belum tersedia pada instalasi ini. Simulator lokal tetap dapat digunakan.</p></div></section>

  return <section className="panel miro-card" aria-labelledby="product-account-heading">
    <div className="panel-heading"><h2 id="product-account-heading">Akun & kepemilikan produk online</h2><span className="tag">ONLINE</span></div>
    <div className="miro-card-body" aria-busy={pending || !ready}>
      <p>Kepemilikan tersimpan pada layanan akun, terpisah dari simulasi lokal di bawah.</p>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
      {!ready ? <p role="status">Memeriksa sesi akun…</p> : !signedIn ? <form onSubmit={event => {
        event.preventDefault()
        void run(async () => {
          try { await client.authenticate(email.trim(), password, false); await loadProducts(); setMessage('Berhasil masuk.') } finally { setPassword('') }
        })
      }}>
        <fieldset className="product-account-form" disabled={pending}>
          <legend>Masuk atau daftar akun</legend>
          <div className="miro-form-two">
            <label className="miro-field"><span>Email</span><input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="miro-field"><span>Kata sandi</span><input type="password" required minLength={8} maxLength={256} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          </div>
          <div className="miro-actions-row">
            <button className="button" type="submit">Masuk</button>
            <button className="button" type="button" disabled={!email.trim() || password.length < 8} onClick={() => void run(async () => {
              try {
                const loggedIn = await client.authenticate(email.trim(), password, true)
                if (loggedIn) await loadProducts()
                setMessage(loggedIn ? 'Akun siap digunakan.' : 'Periksa email untuk konfirmasi akun, lalu masuk kembali.')
              } finally { setPassword('') }
            })}>Daftar</button>
          </div>
        </fieldset>
      </form> : <>
        <div className="miro-actions-row"><button className="button" disabled={pending} onClick={() => void run(async () => {
          clearAccount()
          try { await client.logout(); setMessage('Berhasil keluar.') } catch { throw new Error('Sesi pada browser sudah dihapus. Keluar dari layanan gagal; periksa koneksi sebelum masuk kembali.') }
        })}>Keluar</button><button className="button" disabled={pending} onClick={() => void run(loadProducts)}>Muat ulang produk</button></div>
        <h3>Produk saya</h3>
        {products.length ? <ul>{products.map(product => <li key={product.ownership_id}>{product.serial_public} · {product.variant === 'single_pot' ? 'Satu pot' : 'Kebun'}</li>)}</ul> : <p>Belum ada produk yang diklaim.</p>}
        <form onSubmit={event => {
          event.preventDefault()
          void run(async () => {
            setChallenge(null); setSealedCode(''); setSignature('')
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(serial.trim())) throw new Error('Nomor seri tidak valid.')
            const value = await client.rpc('issue_activation_nonce', { p_serial: serial.trim().toUpperCase() })
            setChallenge(parseProductChallenge(value))
          })
        }}><fieldset className="product-account-form" disabled={pending}><legend>Aktivasi produk</legend>
          <label className="miro-field"><span>Nomor seri produk / QR</span><input value={serial} maxLength={120} required onChange={e => { setSerial(e.target.value); setChallenge(null); setSealedCode(''); setSignature('') }} /></label>
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
        <ProductTelemetry client={client} products={products} onSessionExpired={clearAccount} />
        <ProductKnowledge client={client} onSessionExpired={clearAccount} />
        <ProductEnergy client={client} onSessionExpired={clearAccount} />
        <ProductRewards client={client} onSessionExpired={clearAccount} />
      </>}
    </div>
  </section>
}
