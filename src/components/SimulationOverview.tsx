import { Activity, ArrowUpRight, Droplets, FlaskConical, ShieldCheck, Thermometer } from 'lucide-react'
import type { Decision, PotCase } from '../lib/agronomyEngine'
import { chartSegments } from '../lib/chartData'

export default function SimulationOverview({ data, decision }: { data: PotCase; decision: Decision }) {
  const last = data.samples.at(-1)!
  const ph = [...data.samples].reverse().find(s => s.valid && s.ph !== null)
  const freshPh = ph && data.now_h - ph.t_h <= 24
  const rows = data.samples.filter(s => s.t_h >= data.now_h - 12).slice(-24)
  const start = rows[0]?.t_h ?? data.now_h
  const x = (t: number) => 8 + (t - start) / Math.max(.5, data.now_h - start) * 184
  const y = (v: number) => 80 - v * .65
  const { slope_per_h, r2 } = decision.evidence
  return <aside className="studio-overview" aria-label="Ringkasan sensor simulasi">
    <section className="panel studio-readings"><header><h2>Kondisi media</h2><span>Sensor terakhir</span></header>
      <div className="studio-reading"><span><Droplets />Kelembapan</span><strong>{last.valid ? last.moisture : 'Gagal'}<small>{last.valid ? '/ 100' : ''}</small></strong><p>Indeks lokal · acuan air {decision.evidence.low}</p></div>
      <div className="studio-reading"><span><Thermometer />Suhu tanah</span><strong>{last.valid ? last.temp_c.toFixed(1) : 'Gagal'}<small>{last.valid ? '°C' : ''}</small></strong><p>Acuan panas {data.profile.hot_c} °C</p></div>
      <div className="studio-reading"><span><FlaskConical />pH media</span><strong>{ph?.ph?.toFixed(1) ?? '—'}<small>pH</small></strong><p>{!ph ? 'Belum diukur' : !data.profile.ph_validated ? 'Belum tervalidasi' : !freshPh ? 'Lebih dari 24 jam lalu' : `${Math.round((data.now_h - ph.t_h) * 60)} menit lalu · tervalidasi`}</p></div>
      <p className="studio-data-status"><ShieldCheck />{last.valid ? `${Math.round((data.now_h - last.t_h) * 60)} menit sejak sampel valid` : 'Sampel gagal · periksa sensor'}</p>
    </section>
    <section className="panel studio-trend"><header><h2><Activity />Pola kelembapan</h2><span>12 jam terakhir</span></header>
      <svg viewBox="0 0 200 94" role="img" aria-label={`Kelembapan 12 jam terakhir, ${rows.length} sampel. Garis terputus pada sampel gagal atau jeda lebih dari satu jam.`}>
        {[20, 50, 80].map(v => <line key={v} x1="8" x2="192" y1={y(v)} y2={y(v)} stroke="var(--border-soft)" strokeDasharray="2 4" />)}
        {chartSegments(rows, 'moisture').map((segment, i) => <polyline key={i} points={segment.map(s => `${x(s.t_h)},${y(s.moisture)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />)}
        {rows.map(s => s.valid ? <circle key={s.t_h} cx={x(s.t_h)} cy={y(s.moisture)} r="2.5" fill="var(--accent)" /> : <path key={s.t_h} d={`M${x(s.t_h)-3} ${y(s.moisture)-3}l6 6m-6 0 6-6`} stroke="var(--danger)" strokeWidth="1.5" />)}
      </svg>
      <strong>{slope_per_h === null ? 'Tren belum tersedia' : `${slope_per_h > 0 ? '+' : ''}${slope_per_h} poin/jam`}</strong><p>{slope_per_h === null ? 'Perlu riwayat yang layak untuk proyeksi.' : `Tren keputusan sesi · R² ${r2}`} · {data.samples.length} sampel tersimpan</p>
      <a href="#statistik">Statistik lengkap<ArrowUpRight /></a>
    </section>
  </aside>
}
