import { useEffect, useState } from 'react'
import { useAccount } from './accountContext'
import { AFTER_SIGN_IN } from './DeleteAccount'
import { ALERT_KINDS, parseAlertPreferences, type AlertPreferences as Preferences } from '../lib/overview'

export default function AlertPreferences() {
  const account = useAccount(), { client, signedIn, loaded } = account
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!client || !signedIn || !loaded) return
    let current = true
    setPreferences(null); setError(''); setNotice('')
    client.rpc('my_alert_preferences').then(value => { const next = parseAlertPreferences(value); if (current) setPreferences(next) }).catch(() => { if (current) setError('Pengaturan belum dapat dimuat. Coba lagi.') })
    return () => { current = false }
  }, [client, signedIn, loaded, retry])
  if (!signedIn || !client) return <section className="panel care-panel"><h2>Pengaturan peringatan</h2><p>Masuk untuk mengatur email peringatan akun Anda.</p>{client && <a className="button" href="#masuk" onClick={() => { try { sessionStorage.setItem(AFTER_SIGN_IN, '#pengaturan-peringatan') } catch { /* storage unavailable */ } }}>Masuk</a>}</section>
  return <form className="panel care-panel" aria-label="Pengaturan peringatan" onSubmit={event => {
    event.preventDefault(); if (!preferences) return
    setBusy(true); setError(''); setNotice('')
    client.rpc('set_my_alert_preferences', { p_email_enabled: preferences.email_enabled, p_kinds: preferences.kinds }).then(value => {
      setPreferences(parseAlertPreferences(value)); setNotice('Pengaturan peringatan disimpan.')
    }).catch(() => setError('Pengaturan belum tersimpan. Coba lagi.')).finally(() => setBusy(false))
  }}>
    <p>Email mati secara bawaan. Pilih jenis peringatan untuk perangkat Anda. Email dikirim berkala dan dapat tertunda. Waktu peringatan memakai WIB.</p>
    {preferences ? <><fieldset disabled={busy} onChange={() => { setNotice('Ada perubahan yang belum disimpan.'); setError('') }} className="care-fields"><legend>Email peringatan</legend>
      <label><input type="checkbox" checked={preferences.email_enabled} onChange={e => setPreferences({ ...preferences, email_enabled: e.target.checked })} />Kirim email peringatan</label>
      {Object.entries(ALERT_KINDS).map(([kind, label]) => <label key={kind}><input type="checkbox" checked={preferences.kinds.includes(kind as keyof typeof ALERT_KINDS)} onChange={e => setPreferences({ ...preferences, kinds: e.target.checked ? [...preferences.kinds, kind as keyof typeof ALERT_KINDS] : preferences.kinds.filter(k => k !== kind) })} />{label}</label>)}
    </fieldset><button className="button primary" type="submit" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan pengaturan'}</button></> : !error && <p aria-live="polite">Memuat pengaturan...</p>}
    {error && <p role="alert">{error}</p>}{!preferences && error && <button className="button" type="button" onClick={() => setRetry(n => n + 1)}>Coba lagi</button>}
    {notice && <p aria-live="polite">{notice}</p>}
  </form>
}
