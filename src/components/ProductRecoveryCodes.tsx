import { useEffect, useRef, useState } from 'react'
import type { ProductAccountClient } from '../lib/productAccountClient'

/** APP-01: one-time codes for a lost authenticator. Shown once; making new ones voids the old set. */
export default function ProductRecoveryCodes({ client }: { client: Pick<ProductAccountClient, 'rpc'> }) {
  const [status, setStatus] = useState<{ total: number; remaining: number; created_at: string | null } | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const alive = useRef(true)
  const load = async () => { const r = await client.rpc('my_recovery_codes_status'); if (alive.current) setStatus({ total: Number(r.total) || 0, remaining: Number(r.remaining) || 0, created_at: typeof r.created_at === 'string' ? r.created_at : null }) }
  useEffect(() => {
    alive.current = true
    load().catch(() => {}).finally(() => { if (alive.current) setBusy(false) })
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create() {
    if (status?.total && !confirm('Kode lama tidak berlaku lagi. Lanjutkan?')) return
    setBusy(true); setMessage('')
    try {
      // A stale authenticator code is answered by the step-up dialog (ProductAccountClient.rpc).
      const r = await client.rpc('create_my_recovery_codes')
      const next = Array.isArray(r.codes) ? r.codes.filter((c): c is string => typeof c === 'string' && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)) : []
      if (next.length !== 10) throw new Error('Respons kode pemulihan tidak valid.')
      if (alive.current) { setCodes(next); setMessage('Simpan kode ini sekarang. Kode tidak akan ditampilkan lagi.') }
      await load()
    } catch (err) { if (alive.current) setMessage(err instanceof Error ? err.message : 'Kode gagal dibuat.') }
    finally { if (alive.current) setBusy(false) }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`Kode pemulihan Smart Agro (sekali pakai)\r\n${new Date().toLocaleString('id-ID')}\r\n\r\n${codes.join('\r\n')}\r\n`], { type: 'text/plain' }))
    const link = document.createElement('a'); link.href = url; link.download = 'smart-agro-kode-pemulihan.txt'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="recovery-codes" aria-labelledby="recovery-codes-heading" aria-busy={busy}>
    <h3 id="recovery-codes-heading">Kode pemulihan</h3>
    <p>Untuk masuk jika aplikasi autentikator hilang. Satu kode untuk satu kali pakai; pemulihan menahan penukaran dan transfer selama 24 jam.</p>
    {status && <p>{status.total ? `${status.remaining} dari ${status.total} kode masih berlaku.` : 'Belum ada kode pemulihan.'}</p>}
    <p className="sr-only" aria-live="polite">{message}</p>
    {codes.length > 0 && <><ol className="recovery-code-list" aria-label="Kode pemulihan baru">{codes.map(c => <li key={c}><code>{c}</code></li>)}</ol>
      <button type="button" className="button" onClick={download}>Unduh sebagai teks</button></>}
    {message && <p aria-hidden="true">{message}</p>}
    <button type="button" className="button" disabled={busy} onClick={() => void create()}>{status?.total ? 'Buat kode baru' : 'Buat kode pemulihan'}</button>
  </section>
}
