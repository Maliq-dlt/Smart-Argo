import { useState } from 'react'
import { SlidersHorizontal, Droplets, Plus, FlaskConical, Thermometer, ChevronDown, CircleAlert, Unplug, Clock3, Layers3 } from 'lucide-react'
import { type Reading } from '../lib/sessionStore'
import { clockTime, clockDate, utcLabel, type SessionClock } from '../lib/sessionClock'

export default function SensorControls({ clock, reading, setReading, onSample, onWater, onFault, canAdd, now, freshPh, setFreshPh, volume, setVolume }: {
  clock: SessionClock; reading: Reading; setReading: (reading: Reading) => void; onSample: (freshPh: boolean) => void
  onWater: (volume: number) => void; onFault: (fault: 'stale' | 'invalid' | 'jump' | 'media') => void; canAdd: boolean
  now: number; freshPh: boolean; setFreshPh: (value: boolean) => void; volume: string; setVolume: (value: string) => void
}) {
  const [error, setError] = useState('')
  return <section className="panel controls-panel" aria-labelledby="controls-heading">
    <div className="panel-heading"><h2 id="controls-heading"><SlidersHorizontal />Masukan sampel</h2><span className="tag subtle">SINTETIS</span></div>
    <div className="controls-body">
      <p className="section-hint">Atur pembacaan berikutnya, lalu tambahkan ke riwayat.</p>
      <div className="sensor-control"><label htmlFor="moisture"><span><Droplets />Kelembapan</span><output>{reading.moisture}<small> / 100</small></output></label>
        <input id="moisture" aria-label="Kelembapan" type="range" min="0" max="100" step="1" value={reading.moisture} onChange={e => setReading({ ...reading, moisture: Number(e.target.value) })} aria-valuetext={`${reading.moisture} poin indeks lokal`} /><div className="range-ends"><span>Kering · 0</span><span>Basah · 100</span></div></div>
      <div className="sensor-control"><label htmlFor="temperature"><span><Thermometer />Suhu media</span><output>{reading.temp_c.toFixed(1)}<small> °C</small></output></label>
        <input id="temperature" aria-label="Suhu media" type="range" min="-20" max="60" step=".5" value={reading.temp_c} onChange={e => setReading({ ...reading, temp_c: Number(e.target.value) })} /><div className="range-ends"><span>−20 °C</span><span>60 °C</span></div></div>
      <div className="sensor-control"><label htmlFor="ph"><span><FlaskConical />Keasaman pH</span><output>{(reading.ph ?? 6.2).toFixed(1)}</output></label>
        <input id="ph" aria-label="Keasaman pH" type="range" min="0" max="14" step=".1" value={reading.ph ?? 6.2} onChange={e => { setReading({ ...reading, ph: Number(e.target.value) }); setFreshPh(true) }} /><div className="range-ends"><span>Asam · 0</span><span>Basa · 14</span></div></div>
      <label className="check-label"><input type="checkbox" checked={freshPh} onChange={e => setFreshPh(e.target.checked)} />Sertakan pengukuran pH baru</label>
      <div className="sample-clock"><Clock3 /><span>Waktu sensor <strong>{clockTime(clock, now)}</strong><small>{clockDate(clock, now)} · {utcLabel(clock, now)}</small><small>Sampel berikutnya: {clockTime(clock, now + .5)} · tidak mengubah HST.</small></span></div>
      <button className="button primary add-sample" disabled={!canAdd} onClick={() => { onSample(freshPh); setFreshPh(false) }}><Plus />Tambah sampel<span>+30 menit</span></button>
      {!canAdd && <p className="field-error">Batas 10.000 sampel tercapai. Ekspor lalu mulai sesi baru.</p>}
      <div className="watering-control"><h3><Droplets />Catat penyiraman</h3><form onSubmit={e => { e.preventDefault(); const v = Number(volume); if (!Number.isFinite(v) || v < .1 || v > 5000) { setError('Volume harus 0,1–5.000 mL.'); return } setError(''); onWater(v) }}>
        <label className="unit-input"><span className="sr-only">Volume siraman</span><input type="number" min=".1" max="5000" step=".1" value={volume} onChange={e => setVolume(e.target.value)} required /><span>mL</span></label><button className="button" type="submit">Catat siram</button></form>
        {error && <p role="alert" className="field-error">{error}</p>}<p>Volume catatan, bukan dosis anjuran. Tambahkan sampel sesudah siram untuk melihat respons.</p></div>
      <details className="faults"><summary><CircleAlert />Uji gangguan<ChevronDown /></summary><div className="fault-buttons">
        <button onClick={() => onFault('stale')}><Clock3 />Data basi</button><button disabled={!canAdd} onClick={() => onFault('invalid')}><Unplug />Bacaan gagal</button>
        <button disabled={!canAdd} onClick={() => onFault('jump')}><SlidersHorizontal />Lonjakan probe</button><button onClick={() => onFault('media')}><Layers3 />Ganti media</button>
      </div></details>
    </div>
  </section>
}
