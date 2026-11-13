import ProductExplanation from './ProductExplanation'
import { useEffect, useRef, useState } from 'react'
import type { OwnedProduct } from '../lib/productAccountClient'
import { parseDeviceUnits, parseDeviceReadings, parsePublishedProfiles, type DeviceUnit, type DeviceReading, type PublishedProfile, type TelemetryClient } from '../lib/deviceTelemetryClient'
import { SelectField } from './ui/select'

const names = { moisture: 'Indeks kelembapan', soil_temperature: 'Suhu tanah', soil_ph: 'pH tanah' }
const states = { ok: 'Dilaporkan OK', error: 'Galat', not_measured: 'Tidak diukur' }
const time = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'UTC' }) + ' UTC'

export default function ProductTelemetry({ client, products, onSessionExpired }: { client: TelemetryClient; products: OwnedProduct[]; onSessionExpired: () => void }) {
  const [units,setUnits] = useState<DeviceUnit[]>([])
  const [profiles,setProfiles] = useState<PublishedProfile[]>([])
  const [selected,setSelected] = useState('')
  const [readings,setReadings] = useState<DeviceReading[]>([])
  const [product,setProduct] = useState(products[0]?.product_id ?? '')
  const [profile,setProfile] = useState('')
  const [label,setLabel] = useState('')
  const [pending,setPending] = useState(true)
  const [message,setMessage] = useState('')
  const [error,setError] = useState(false)
  const [reviewedAt,setReviewedAt] = useState(Date.now())
  const generation = useRef(0)
  const expired = useRef(onSessionExpired)
  expired.current = onSessionExpired
  function failure(err: unknown, request: number) {
    if (generation.current !== request) return
    setError(true); setMessage(err instanceof Error ? err.message : 'Data perangkat gagal dimuat.')
    if (!client.session) { setReadings([]); setUnits([]); setProfiles([]); setSelected(''); expired.current() }
  }
  useEffect(() => {
    const requestCounter = generation
    const request = ++generation.current
    setPending(true)
    Promise.all([client.rpc('my_device_units'),client.rpc('published_profile_versions')]).then(([u,p]) => {
      const nextUnits = parseDeviceUnits(u.units), nextProfiles = parsePublishedProfiles(p.profiles)
      if (generation.current !== request) return
      setUnits(nextUnits); setProfiles(nextProfiles); setProfile(nextProfiles[0]?.id ?? '')
    }).catch(err => failure(err,request)).finally(() => { if (generation.current===request) setPending(false) })
    return () => { requestCounter.current++ }
    // The client remains stable for the lifetime of the signed-in panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[client])

  async function refresh(key: string) {
    const request = ++generation.current
    setSelected(key); setReadings([]); setMessage(''); setError(false); setPending(true)
    try {
      const unit = units.find(u => `${u.unit_id}:${u.device_id}`===key)
      if (!unit) return
      const result = await client.rpc('unit_measurements',{p_unit_id:unit.unit_id})
      const next = parseDeviceReadings(result.readings)
      if (generation.current===request) { setReadings(next); setReviewedAt(Date.now()); setMessage(next.length ? 'Bacaan tersimpan dimuat.' : 'Belum ada bacaan perangkat untuk unit ini.') }
    } catch(err) { failure(err,request) } finally { if (generation.current===request) setPending(false) }
  }
  const selectedProduct = products.some(p => p.product_id === product) ? product : products[0]?.product_id ?? ''
  const active = units.find(u => `${u.unit_id}:${u.device_id}`===selected)
  return <section className="panel miro-card" aria-labelledby="stored-telemetry-heading">
    <div className="panel-heading"><h3 id="stored-telemetry-heading">Data perangkat tersimpan</h3></div>
    <div className="miro-card-body" aria-busy={pending}>
      <p>Status laporan perangkat, bukan kalibrasi. Riwayat berikut khusus perangkat dan terpisah dari simulator.</p>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
      {pending && <p role="status">Memuat data perangkat…</p>}
      <label className="miro-field"><span id="telemetry-unit-label">Unit & perangkat milik saya</span><SelectField label="Unit & perangkat milik saya" placeholder="Pilih unit & perangkat" value={selected} disabled={pending} onValueChange={v=>void refresh(v)} options={[...units.map(u=>({value:`${u.unit_id}:${u.device_id}`,label:`${u.serial_public} · ${u.location_label} · ${u.device_id} · ${u.device_status}`}))]} /></label>
      {!pending && !units.length && <p>Belum ada unit perangkat. Buat unit setelah produk dimiliki dan profil diterbitkan.</p>}
      <button className="button" disabled={pending || !selected} onClick={() => void refresh(selected)}>Muat ulang bacaan</button>
      {active && <p>Perangkat terpilih: {active.device_status}. Bacaan mencakup seluruh perangkat pada unit {active.location_label}.</p>}
      {!!readings.length && <details><summary>Riwayat sensor — {readings.length} bacaan terakhir</summary><ul className="miro-list">
        {readings.map(r => <li key={r.id}><div><strong>{names[r.sensor_id]}: {r.value_nullable===null ? 'NULL' : r.value_nullable}{r.value_nullable!==null && r.sensor_id==='soil_temperature' ? ' °C' : r.value_nullable!==null && r.sensor_id==='moisture' ? '/100' : ''}</strong> · {states[r.quality_status]}
          {r.error_message && <p>Galat perangkat: {r.error_message}</p>}
          <p>Diukur {time(r.measured_at)} · Diterima {time(r.received_at)}</p>
          <p>Jam {r.clock_status==='synced' ? 'tersinkron menurut perangkat' : 'belum tersinkron'} · {reviewedAt-Date.parse(r.measured_at)>300000 ? 'Usang (>5 menit saat dimuat)' : 'Belum usang saat dimuat'} · Urutan {r.sequence} · Boot {r.boot_id}</p>
        </div></li>)}
      </ul></details>}
      {active && <ProductExplanation key={selected} client={client} unitId={active.unit_id} deviceId={active.device_id} onSessionExpired={onSessionExpired} />}
      <form onSubmit={event => {
        event.preventDefault()
        const request = ++generation.current
        setPending(true); setMessage(''); setError(false)
        void (async () => {
          try {
            if (!products.some(p => p.product_id===selectedProduct) || !profiles.some(p => p.id===profile) || !label.trim() || label.trim().length>120) throw new Error('Pilih produk, profil terbit, dan label unit yang valid.')
            await client.rpc('create_my_unit',{p_product_id:selectedProduct,p_profile_version_id:profile,p_label:label.trim()})
            const result = await client.rpc('my_device_units'); const nextUnits = parseDeviceUnits(result.units)
            if (generation.current===request) { setUnits(nextUnits); setLabel(''); setMessage('Unit berhasil dibuat. Pilih unit untuk membaca data perangkat.') }
          } catch(err) { failure(err,request) } finally { if (generation.current===request) setPending(false) }
        })()
      }}><fieldset className="product-account-form" disabled={pending || !profiles.length || !products.length}><legend>Buat unit dari profil terbit</legend>
        <label className="miro-field"><span id="telemetry-product-label">Produk</span><SelectField label="Produk" placeholder="Pilih produk" value={selectedProduct} onValueChange={v=>setProduct(v)} options={[...products.map(p=>({value:p.product_id,label:`${p.serial_public}`}))]} /></label>
        <label className="miro-field"><span id="telemetry-profile-label">Profil tanaman</span><SelectField label="Profil tanaman" placeholder="Pilih profil" value={profile} onValueChange={v=>setProfile(v)} options={[...profiles.map(p=>({value:p.id,label:`${p.species_variety} · v${p.version} · Bukti: ${p.evidence_level}`}))]} /></label>
        <label className="miro-field"><span>Label lokasi unit</span><input required maxLength={120} value={label} onChange={e => setLabel(e.target.value)} /></label>
        <button className="button" type="submit">Buat unit</button>
      </fieldset></form>
      {!pending && !profiles.length && <p>Profil belum diterbitkan. Operator perlu menerbitkan profil berbukti sebelum unit dibuat; tidak ada saran perawatan perangkat saat ini.</p>}
    </div>
  </section>
}
