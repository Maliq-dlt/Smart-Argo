import { useEffect, useRef, useState } from 'react'
import { Upload, Download } from 'lucide-react'
import { parseTelemetry, deviceStatuses, type DeviceSnapshot } from '../lib/telemetry'
import { clockDate, clockTime, utcLabel, type SessionClock } from '../lib/sessionClock'

export default function DevicePanel({ snapshot, clock, onImport }: { snapshot?: DeviceSnapshot; clock: SessionClock; onImport: (snapshot: DeviceSnapshot) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(''), [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const load = async (input?: File) => {
    if (!input) return
    try {
      if (input.size > 65536) throw new Error('Paket maksimum 64 KB.')
      const packet = parseTelemetry(JSON.parse((await input.text()).replace(/^\uFEFF/, '')))
      const importedAt = Date.now(); onImport({ packet, importedAt }); setNow(importedAt); setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Paket JSON tidak dapat dibaca.') }
    if (file.current) file.current.value = ''
  }
  const packet = snapshot?.packet, stamp = packet ? { ...clock, startedAtMs: Date.parse(packet.measured_at) } : null
  return <section className="panel device-panel" aria-label="Pratinjau paket perangkat"><div className="device-body">
    <p>Buka paket JSON untuk memeriksa format dan status yang dilaporkan. Pratinjau berkas tidak menghubungkan perangkat atau mengendalikan tetesan; data simulasi tetap terpisah.</p>
    <div className="device-actions"><button className="button" onClick={() => file.current?.click()}><Upload />Buka paket JSON</button><a className="button" href="telemetry-example.json" download><Download />Contoh paket</a></div>
    <input className="sr-only" type="file" accept=".json,application/json" aria-label="Impor paket perangkat" ref={file} onChange={e => void load(e.target.files?.[0])} />
    {error && <p role="alert" className="field-error">{error} Pratinjau sebelumnya tetap tersimpan.</p>}
    {packet && stamp ? <><div className="packet-heading"><strong>{packet.device_id}</strong><span className="tag">{packet.source === 'example' ? 'CONTOH' : 'DARI BERKAS'}</span></div>
      <p className="packet-time">Waktu pengukuran: {clockDate(stamp, 0)} {clockTime(stamp, 0)} {utcLabel(stamp, 0)}<br />ID sampel: {packet.sample_id}</p>
      <ul className="device-statuses">{deviceStatuses(packet, now).map(row => <li key={row.label} data-severity={row.severity}><span>{row.severity === 'ok' ? 'Dilaporkan' : row.severity === 'error' ? 'Gangguan' : 'Periksa'}</span><div><strong>{row.label}</strong><p>{row.message}</p></div></li>)}</ul>
      <p className="section-hint">Status berasal dari satu paket. Koneksi hidup, kalibrasi, serta aliran aktual perlu diverifikasi perangkat. Error paket tercatat di Log sesi sebagai pratinjau.</p>
    </> : <p className="device-empty">Belum ada paket dimuat. Kelembapan, suhu, pH, dan status tetesan akan ditampilkan setelah berkas lolos validasi.</p>}
  </div></section>
}
