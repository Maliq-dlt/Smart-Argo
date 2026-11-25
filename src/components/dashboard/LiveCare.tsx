import { useEffect, useRef, useState } from 'react'
import { parseUnits, type OwnedUnit } from '../../lib/deviceTelemetryClient'
import type { ProductAccountClient } from '../../lib/productAccountClient'
import { bandSourceLabel, careAnswer, careRecord, careTime, outlookLabel, parseCarePlants, parseOutlook, parseUnitHealth, type OverviewPlant, type WateringOutlook } from '../../lib/overview'
import Overview from '../overview/Overview'
import './care.css'

type Rise = { from: string; to: string; delta: number }
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Belum tersedia'
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : 'Belum tersedia'
const message = (error: unknown) => error instanceof Error ? error.message : 'Data belum dapat dimuat.'

/** `plantedOn` (slot → planting date) changes with the garden, so adding or switching a plant reloads at once, not a minute later. */
export default function LiveCare({ client, detail, selected, plantedOn, onSelect, onAdd }: { client: ProductAccountClient; detail: boolean; selected: string | null; plantedOn: Record<string, string | undefined>; onSelect(id: string): void; onAdd(): void }) {
  const [devices, setDevices] = useState<{ total: number; issues: Record<string, unknown>[] } | null>(null)
  const [plants, setPlants] = useState<OverviewPlant[] | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setError('')
    client.rpc('my_overview').then(value => { const next = parseCarePlants(value, plantedOn), device = careRecord(careAnswer(value).devices); if (typeof device.total !== 'number' || !Array.isArray(device.issues)) throw new Error('Ringkasan perangkat tidak valid.'); const issues = device.issues.map(careRecord); if (current) { setPlants(next); setDevices({ total: device.total, issues }) } }).catch(err => { if (current) setError(message(err)) })
    const timer = window.setInterval(() => setRevision(n => n + 1), 60000)
    return () => { current = false; clearInterval(timer) }
  }, [client, revision, plantedOn])
  const active = plants?.find(p => p.id === selected) ?? plants?.[0]
  return <div className="live-care">
    <div className="care-top"><p>Data perangkat akun · waktu dalam WIB</p><button type="button" className="button" onClick={() => setRevision(n => n + 1)}>Muat ulang</button></div>
    {error && <p role="alert">{error} Data yang sudah tampil mungkin belum diperbarui.</p>}
    {!plants && !error && <p aria-live="polite">Memuat data tanaman...</p>}
    {plants && !plants.length && <section className="panel care-panel"><h2>Belum ada tanaman</h2><p>Tambahkan pot atau kebun untuk mulai mengamati.</p><button type="button" className="button" onClick={onAdd}>Tambah tanaman</button><a className="button" href="#ekosistem">Kelola produk</a></section>}
    {plants && plants.length > 0 && (!detail ? <Overview plants={plants} products={null} onAdd={onAdd} onOpen={plant => { onSelect(plant.id); location.hash = '#tanaman' }} /> : active && <>
      <label className="care-picker">Tanaman<select value={active.id} onChange={e => onSelect(e.target.value)}>{plants.map(p => <option key={p.id} value={p.id}>{p.name}{p.tag ? ` · ${p.tag}` : ''}</option>)}</select></label>
      <section className="panel care-panel"><h2>{active.name}</h2><p>{active.status.word}</p><p>Kelembapan: {number(active.moisture)}</p><p>{bandSourceLabel(active.bandSource ?? null)}</p></section>
      <SlotUnit key={active.id} client={client} plant={active} plants={plants} onSaved={() => setRevision(n => n + 1)} />
      {active.unitId ? <UnitCare key={active.unitId} client={client} unit={active.unitId} revision={revision} /> : <p>Pilih unit di atas. Jika belum ada unit, buat dari produk Anda di Produk & ekosistem.</p>}
    </>)}
    {!detail && devices && <section className="panel care-panel"><h2>Perangkat</h2><p>{devices.total} perangkat terdaftar.</p>{devices.issues.length ? <ul>{devices.issues.map((issue, i) => <li key={i}>{issue.kind === 'battery_low' ? 'Baterai rendah' : issue.kind === 'gap' ? 'Kiriman sering terputus' : issue.kind === 'silent' ? 'Perangkat berhenti mengirim' : 'Periksa perangkat'} sejak {date(issue.since)}{plants?.find(p => p.unitId === issue.unit_id) && <button type="button" className="button" onClick={() => { onSelect(plants.find(p => p.unitId === issue.unit_id)!.id); location.hash = '#tanaman' }}>Periksa tanaman</button>}</li>)}</ul> : <p>Belum ada masalah perangkat yang dilaporkan.</p>}<a className="button" href="#ekosistem">Kelola produk</a></section>}
    <a className="button" href="#pengaturan-peringatan">Pengaturan peringatan</a>
  </div>
}
function UnitCare({ client, unit, revision }: { client: ProductAccountClient; unit: string; revision: number }) {
  const [outlook, setOutlook] = useState<WateringOutlook | null>(null), [health, setHealth] = useState<Record<string, unknown> | null>(null), [rises, setRises] = useState<Rise[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [volume, setVolume] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Rise | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef<{ rise: Rise; id: string; amount: number } | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    let current = true
    setError('')
    const read = async () => {
      const results = await Promise.allSettled([
        client.rpc('my_watering_outlook', { p_unit_id: unit, p_timezone: 'Asia/Jakarta' }).then(value => { const result = parseOutlook(careAnswer(value).outlook); if (current) setOutlook(result) }),
        client.rpc('my_unit_health', { p_unit_id: unit, p_timezone: 'Asia/Jakarta' }).then(value => { const result = parseUnitHealth(value); if (current) setHealth(result) }),
        client.rpc('my_unlogged_rises', { p_unit_id: unit }).then(value => {
          const valueRises = careAnswer(value).rises
          if (!Array.isArray(valueRises)) throw new Error('Usulan siram tidak valid.')
          const next = valueRises.map(value => {
            const r = careRecord(value)
            if (typeof r.from !== 'string' || typeof r.to !== 'string' ||
              !Number.isFinite(Date.parse(r.from)) || !Number.isFinite(Date.parse(r.to)) || Date.parse(r.to) < Date.parse(r.from) ||
              typeof r.delta !== 'number' || !Number.isFinite(r.delta) || r.delta < 5) throw new Error('Usulan siram tidak valid.')
            return { from: r.from, to: r.to, delta: r.delta }
          })
          if (current) setRises(next)
        }),
      ])
      if (current && results.some(r => r.status === 'rejected')) setError('Sebagian data perawatan belum dapat dimuat. Muat ulang untuk mencoba lagi.')
    }
    void read()
    return () => { current = false }
  }, [client, unit, revision, retry])
  const shareRise = async (text: string) => {
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        setNotice('Jejak air disalin.')
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError('Jejak air belum dibagikan. Anda bisa menyalin teksnya langsung.')
    }
  }
  const dismiss = async (rise: Rise) => {
    setBusy(true); setError('')
    try { careAnswer(await client.rpc('dismiss_my_rise', { p_unit_id: unit, p_at: rise.to })); setRises(old => old.filter(r => r.to !== rise.to)); setNotice('Usulan diabaikan tanpa membuat catatan siram.') } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  const send = async () => {
    const action = request.current
    if (!action) return
    setPending(null); setBusy(true); setError(''); setNotice('')
    try {
      careAnswer(await client.rpc('append_my_care_journal', { p_unit_id: unit, p_request_id: action.id, p_kind: 'watering', p_observed_at: action.rise.to, p_amount_ml: action.amount, p_notes: '' }))
      setRises(old => old.filter(r => r.to !== action.rise.to)); request.current = null; setNotice('Siram dicatat.'); setRetry(n => n + 1)
    } catch { setError('Siram belum terkonfirmasi. Coba kirim ulang dengan permintaan yang sama.') } finally { setBusy(false) }
  }
  const battery = Array.isArray(health?.battery) ? health.battery.map(careRecord).at(-1) : null
  const gaps = Array.isArray(health?.upload_gaps) ? health.upload_gaps.map(careRecord) : []
  const energy = Array.isArray(health?.energy_days) ? health.energy_days.map(careRecord) : []
  const packets = Array.isArray(health?.packets) ? health.packets : []
  const calibration = health?.calibration ? careRecord(health.calibration) : null
  const volumeOk = Number(volume) > 0 && Number(volume) <= 100000  // Number('') is 0, so an empty field stays off
  return <>
    <section className="panel care-panel"><h2>Perkiraan siram</h2><p>{outlookLabel(outlook)}</p>{outlook && <p>{bandSourceLabel(outlook.band_source)}</p>}</section>
    <section className="panel care-panel device-health"><h2>Perangkat</h2>{health ? <><dl className="care-facts"><div><dt>Kiriman terakhir diterima</dt><dd>{date(packets.at(-1))}</dd></div><div><dt>Baterai terakhir</dt><dd>{number(battery?.volts)}{battery ? ' V' : ''}</dd></div><div><dt>Waktu baterai</dt><dd>{date(battery?.at)}</dd></div><div><dt>Perkiraan menuju 3,4 V</dt><dd>{typeof health.battery_days_left === 'number' ? `${number(health.battery_days_left)} hari` : 'Data tren belum cukup'}</dd></div><div><dt>Kalibrasi kelembapan</dt><dd>{date(calibration?.moisture_at)}</dd></div><div><dt>Kalibrasi pH</dt><dd>{date(calibration?.ph_at)}</dd></div></dl><h3>Jeda kiriman</h3>{gaps.length ? <ul>{gaps.map((gap, i) => <li key={i}>{date(gap.from)} sampai {gap.ongoing ? 'Masih menunggu kiriman' : date(gap.to)}</li>)}</ul> : <p>Tidak ada jeda lebih dari 90 menit pada riwayat yang tersedia.</p>}<h3>Energi harian</h3>{energy.length ? <ul>{energy.map((day, i) => <li key={i}>{String(day.day)}: surya {number(day.solar_wh)} Wh, beban {number(day.load_wh)} Wh ({number(day.windows)} dari 96 jendela 15 menit).</li>)}</ul> : <p>Belum ada data energi terverifikasi.</p>}<p>Diperiksa: {date(health.checked_at)}</p></> : <p>Kesehatan perangkat belum tersedia.</p>}</section>
    {rises.length > 0 && <section className="panel care-panel"><h2>Kenaikan tanpa catatan</h2><p>Kenaikan sensor belum membuktikan penyiraman. Konfirmasi hanya bila Anda benar-benar menyiram.</p><label className="care-picker">Volume aktual (mL)<input type="number" min="1" max="100000" step="any" value={volume} onChange={e => setVolume(e.target.value)} /></label>{!volumeOk && <p>Isi volume air yang Anda siramkan untuk mengaktifkan Catat.</p>}
      {rises.map(rise => {
        const text = `Jejak air di pot saya. Indeks kelembapan naik ${number(rise.delta)} poin, dari ${date(rise.from)} hingga ${date(rise.to)}.`
        return <div className="care-rise" key={rise.to}><p>{text}</p>
          <button className="button" type="button" onClick={() => void shareRise(text)}>Bagikan jejak air</button>
          <p>Anda menyiram sekitar pukul {careTime(rise.to)} WIB?</p>
          <div className="care-actions"><button className="button" type="button" disabled={busy || !!pending || !!request.current || !volumeOk} onClick={() => { request.current = { rise, amount: Number(volume), id: crypto.randomUUID() }; setPending(rise); setNotice('Siram akan dicatat dalam 5 detik. Meninggalkan halaman membatalkan pengiriman.'); timer.current = setTimeout(() => void send(), 5000) }}>Catat</button><button className="button" type="button" disabled={busy || !!pending || !!request.current} onClick={() => void dismiss(rise)}>Bukan</button></div>
        </div>
      })}
    </section>}
    {pending && <button className="button" type="button" onClick={() => { if (timer.current) clearTimeout(timer.current); request.current = null; setPending(null); setNotice('Pencatatan dibatalkan.') }}>Urungkan</button>}
    {error && <div role="alert"><p>{error}</p>{request.current && !pending && <button className="button" type="button" disabled={busy} onClick={() => void send()}>Kirim ulang catatan</button>}<button className="button" type="button" onClick={() => setRetry(n => n + 1)}>Muat ulang perawatan</button></div>}
    {notice && <p aria-live="polite">{notice}</p>}
  </>
}

function SlotUnit({ client, plant, plants, onSaved }: { client: ProductAccountClient; plant: OverviewPlant; plants: OverviewPlant[]; onSaved(): void }) {
  const [units, setUnits] = useState<OwnedUnit[]>([]), [selected, setSelected] = useState(plant.unitId ?? '')
  const [error, setError] = useState(''), [busy, setBusy] = useState(true), [notice, setNotice] = useState('')
  useEffect(() => {
    let current = true
    client.rpc('my_units').then(value => { const parsed = parseUnits(value); if (current) setUnits(parsed.units.filter(u => !u.archived_at || u.unit_id === plant.unitId)) }).catch(() => { if (current) setError('Daftar unit belum dapat dimuat. Buka ulang tanaman untuk mencoba lagi.') }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [client, plant.unitId])
  const available = units.filter(u => !plants.some(p => p.id !== plant.id && p.unitId === u.unit_id))
  return <form className="panel care-panel" aria-label="Hubungkan unit ke tanaman" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    client.rpc('set_my_slot_unit', { p_slot_id: plant.slotId, p_unit_id: selected || null }).then(careAnswer).then(() => { setNotice('Hubungan unit disimpan.'); onSaved() }).catch(err => setError(message(err))).finally(() => setBusy(false))
  }}><h2>Unit tanaman</h2><p>Satu unit untuk satu pot atau zona. Penempatan probe di dalam unit diatur di Produk & ekosistem.</p>
    <label className="care-picker">Unit untuk tanaman ini<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Belum dihubungkan</option>{available.map(u => <option key={u.unit_id} value={u.unit_id}>{u.location_label} · {u.serial_public}{u.archived_at ? ' (diarsipkan)' : ''}</option>)}</select></label>
    <button className="button" type="submit" disabled={busy || selected === (plant.unitId ?? '')}>Simpan hubungan unit</button><a href="#ekosistem">Kelola produk dan probe</a>
    {error && <p role="alert">{error}</p>}{notice && <p aria-live="polite">{notice}</p>}
  </form>
}
