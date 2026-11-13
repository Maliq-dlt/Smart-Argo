import { ArrowUpRight, CaretDown, Drop, Flask, Pulse, ShieldCheck, Thermometer } from '@phosphor-icons/react'
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
    <section className="studio-readings"><header><h2>Kondisi media</h2><span>Sensor terakhir</span></header>
      <div className="studio-metrics"><div className="studio-reading"><span><Drop />Kelembapan</span><strong>{last.valid ? last.moisture.toLocaleString('id-ID') : 'Gagal'}<small>{last.valid ? '/ 100' : ''}</small></strong><p>Indeks lokal · acuan air {decision.evidence.low}</p></div>
      <div className="studio-reading"><span><Thermometer />Suhu tanah</span><strong>{last.valid ? last.temp_c.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : 'Gagal'}<small>{last.valid ? '°C' : ''}</small></strong><p>Acuan panas {data.profile.hot_c} °C</p></div>
      <div className="studio-reading"><span><Flask />pH media</span><strong>{ph?.ph?.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) ?? '—'}<small>pH</small></strong><p>{!ph ? 'Belum diukur' : !data.profile.ph_validated ? 'Belum tervalidasi' : !freshPh ? 'Lebih dari 24 jam lalu' : `${Math.round((data.now_h - ph.t_h) * 60)} menit lalu · tervalidasi`}</p></div></div>
      <p className="studio-data-status"><ShieldCheck />{last.valid ? `${Math.round((data.now_h - last.t_h) * 60)} menit sejak sampel valid` : 'Sampel gagal · periksa sensor'}</p>
    </section>
    <details className="studio-trend"><summary><span><Pulse />Pola kelembapan<small>{rows.length} sampel · 12 jam terakhir</small></span><CaretDown aria-hidden="true" /></summary><div>
      <svg viewBox="0 0 200 94" role="img" aria-label={`Kelembapan 12 jam terakhir, ${rows.length} sampel. Garis terputus pada sampel gagal atau jeda lebih dari satu jam.`}>
        {[20, 50, 80].map(v => <line key={v} x1="8" x2="192" y1={y(v)} y2={y(v)} stroke="var(--border-soft)" strokeDasharray="2 4" />)}
        {chartSegments(rows, 'moisture').map((segment, i) => <polyline key={i} points={segment.map(s => `${x(s.t_h)},${y(s.moisture)}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />)}
        {rows.map(s => s.valid ? <circle key={s.t_h} cx={x(s.t_h)} cy={y(s.moisture)} r="2.5" fill="var(--primary)" /> : <path key={s.t_h} d={`M${x(s.t_h)-3} ${y(s.moisture)-3}l6 6m-6 0 6-6`} stroke="var(--danger)" strokeWidth="1.5" />)}
      </svg>
      <strong>{slope_per_h === null ? 'Tren belum tersedia' : `${slope_per_h > 0 ? '+' : ''}${slope_per_h} poin/jam`}</strong><p>{slope_per_h === null ? 'Perlu riwayat yang layak untuk proyeksi.' : `Tren keputusan sesi · R² ${r2}`} · {data.samples.length} sampel tersimpan</p>
      <a href="#statistik">Statistik lengkap<ArrowUpRight /></a>
    </div></details>
  </aside>
}
