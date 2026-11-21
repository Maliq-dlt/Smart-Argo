import { useEffect, useRef, useState } from 'react'
import { parseOverview, parseUnits, type OwnedDevice, type OwnedUnit, type UnitOverview } from '../lib/deviceTelemetryClient'
import type { ProductAccountClient } from '../lib/productAccountClient'
import { SelectField } from './ui/select'

const ALERT_TEXT = { no_data: 'Belum ada data', stale: 'Data usang', sensor_error: 'Sensor galat', device_revoked: 'Perangkat dicabut', energy_deficit: 'Beban melebihi panen (24 jam)', battery_low: 'Baterai lemah' }
const SENSOR = { moisture: ['Kelembapan', '/100'], soil_temperature: ['Suhu tanah', ' °C'], soil_ph: ['pH', ''] } as const
const MOOD: Record<string, string> = { bingung_menunggu: 'Menunggu data', tenang_senang: 'Rutin', sedih_perhatian: 'Perlu perhatian', waspada_marah: 'Prioritas periksa' }
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'baru saja' : m < 60 ? `${m} menit lalu` : m < 2880 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu` }
const UNPLACED = 'none'

/** APP-03 overview of every active unit, and APP-02 management: rename, archive or restore, place devices. */
export default function ProductUnits({ client, onSessionExpired, version = 0, onUnitsChanged }: { client: Pick<ProductAccountClient, 'rpc' | 'session'>; onSessionExpired: () => void; version?: number; onUnitsChanged?: () => void }) {
  const [overview, setOverview] = useState<UnitOverview[] | null>(null)
  const [owned, setOwned] = useState<{ units: OwnedUnit[]; devices: OwnedDevice[] }>({ units: [], devices: [] })
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<Record<string, { action: string; created_at: string }[]>>({})
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const alive = useRef(true)

  async function run(task: () => Promise<string | void>) {
    setBusy(true); setMessage('')
    try { const done = await task(); if (alive.current && done) setMessage(done) }
    catch (err) { if (!alive.current) return; setMessage(err instanceof Error ? err.message : 'Permintaan gagal.'); if (!client.session) onSessionExpired() }
    finally { if (alive.current) setBusy(false) }
  }
  const load = async () => {
    const [o, u] = await Promise.all([client.rpc('my_unit_overview'), client.rpc('my_units')])
    if (!alive.current) return
    setOverview(parseOverview(o)); setOwned(parseUnits(u))
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    // A reload keeps the last action's message: `version` also changes right after this panel's own edits.
    setBusy(true)
    load().catch(err => { if (!alive.current) return; setMessage(err instanceof Error ? err.message : 'Permintaan gagal.'); if (!client.session) onSessionExpired() })
      .finally(() => { if (alive.current) setBusy(false) })
    // The client is stable for the signed-in panel; `version` changes whenever either unit panel edits units.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
  const act = (name: Parameters<typeof client.rpc>[0], body: Record<string, unknown>, done: string) => run(async () => {
    await client.rpc(name, body)
    if (onUnitsChanged) onUnitsChanged(); else await load()
    return done
  })
  const archived = owned.units.filter(u => u.archived_at)

  return <section className="panel miro-card unit-overview" aria-labelledby="unit-overview-heading" aria-busy={busy}>
    <div className="panel-heading"><h3 id="unit-overview-heading">Kondisi unit</h3>
      <button type="button" className="button" disabled={busy} onClick={() => void run(async () => { await load(); return 'Diperbarui.' })}>Muat ulang</button></div>
    <div className="miro-card-body">
      <p className="sr-only" aria-live="polite">{message}</p>
      {message && <p aria-hidden="true">{message}</p>}
      {overview && !overview.length && <p>Belum ada unit aktif. Buat unit dari produk Anda di bawah.</p>}
      <ul className="unit-grid" aria-label="Unit aktif">{overview?.map(u => {
        const unit = owned.units.find(x => x.unit_id === u.unit_id), devices = owned.devices.filter(d => d.product_id === unit?.product_id)
        const units = owned.units.filter(x => x.product_id === unit?.product_id && !x.archived_at)
        return <li key={u.unit_id} className="unit-card" data-alert={u.alerts.length > 0 || undefined}>
          <header><strong>{u.location_label}</strong><small>{u.serial_public}{unit ? ` · ${unit.species_variety}` : ''}</small></header>
          {u.alerts.length > 0 ? <ul className="unit-alerts" aria-label="Peringatan">{u.alerts.map(a => <li key={a}>{ALERT_TEXT[a]}</li>)}</ul> : <p className="unit-ok">Tidak ada peringatan</p>}
          {u.sensors.length > 0 && <dl className="unit-sensors">{u.sensors.map(s => <div key={s.sensor_id}><dt>{SENSOR[s.sensor_id][0]}</dt>
            <dd>{s.quality_status === 'ok' ? `${s.value_nullable?.toLocaleString('id-ID', { maximumFractionDigits: 1 })}${SENSOR[s.sensor_id][1]}` : s.quality_status === 'error' ? 'Galat' : 'Tidak diukur'}</dd></div>)}</dl>}
          <p className="unit-meta">{u.last_packet_at ? `Paket terakhir ${ago(u.last_packet_at)}` : 'Belum ada paket'}
            {u.energy.windows > 0 && ` · Energi 24 jam: panen ${u.energy.solar_wh?.toFixed(1)} Wh, beban ${u.energy.load_wh?.toFixed(1)} Wh`}
            {u.energy.battery_soc_pct !== null && ` · Baterai ${Math.round(u.energy.battery_soc_pct)}%`}
            {u.battery && ` · Baterai ${u.battery.voltage.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} V`}
            {u.assessment && ` · Penilaian: ${MOOD[u.assessment.state] ?? u.assessment.state}`}</p>
          <details><summary>Kelola unit</summary>
            <form onSubmit={e => { e.preventDefault(); void act('rename_my_unit', { p_unit_id: u.unit_id, p_label: labels[u.unit_id] ?? u.location_label }, 'Nama unit disimpan.') }}>
              <fieldset className="product-account-form" disabled={busy}><legend className="sr-only">Ubah nama {u.location_label}</legend>
                <label className="miro-field"><span>Nama</span><input required maxLength={120} value={labels[u.unit_id] ?? u.location_label} onChange={e => setLabels(l => ({ ...l, [u.unit_id]: e.target.value }))} /></label>
                <button className="button" type="submit">Simpan nama</button></fieldset></form>
            {devices.map(d => <label key={d.device_id} className="miro-field"><span>Perangkat {d.device_id.slice(0, 8)} · {d.status}</span>
              <SelectField label={`Penempatan perangkat ${d.device_id.slice(0, 8)}`} value={d.unit_id ?? UNPLACED} disabled={busy || d.status !== 'active'}
                onValueChange={v => void act('place_my_device', { p_device_id: d.device_id, p_unit_id: v === UNPLACED ? null : v }, 'Penempatan perangkat disimpan.')}
                options={[{ value: UNPLACED, label: 'Belum ditempatkan (semua unit)' }, ...units.map(x => ({ value: x.unit_id, label: x.location_label }))]} /></label>)}
            <div className="unit-actions">
              <button type="button" className="button" disabled={busy} onClick={() => void run(async () => {
                const r = await client.rpc('my_unit_history', { p_unit_id: u.unit_id })
                if (alive.current) setHistory(h => ({ ...h, [u.unit_id]: Array.isArray(r.events) ? r.events.slice(0, 20) as { action: string; created_at: string }[] : [] }))
              })}>Lihat riwayat</button>
              <button type="button" className="button" disabled={busy} onClick={() => { if (confirm(`Arsipkan ${u.location_label}? Data tetap tersimpan, paket baru ditolak.`)) void act('archive_my_unit', { p_unit_id: u.unit_id }, 'Unit diarsipkan.') }}>Arsipkan</button>
            </div>
            {history[u.unit_id] && <ul className="miro-list" aria-label={`Riwayat ${u.location_label}`}>{history[u.unit_id].length ? history[u.unit_id].map((h, i) => <li key={i}><div>
              <strong>{{ renamed: 'Ganti nama', archived: 'Diarsipkan', restored: 'Dipulihkan', device_placed: 'Perangkat ditempatkan', device_removed: 'Perangkat dipindahkan' }[h.action] ?? h.action}</strong> · {new Date(h.created_at).toLocaleString('id-ID')}</div></li>) : <li>Belum ada riwayat.</li>}</ul>}
          </details>
        </li>
      })}</ul>
      {archived.length > 0 && <details><summary>Unit diarsipkan ({archived.length})</summary><ul className="miro-list">{archived.map(u => <li key={u.unit_id}><div>
        <strong>{u.location_label}</strong> · {u.serial_public} <button type="button" className="button" disabled={busy} onClick={() => void act('restore_my_unit', { p_unit_id: u.unit_id }, 'Unit dipulihkan.')}>Pulihkan</button></div></li>)}</ul></details>}
    </div>
  </section>
}
