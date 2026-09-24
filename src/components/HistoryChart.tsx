import { useEffect, useRef, useState } from 'react'
import { ChartNoAxesCombined, Circle, X, Diamond } from 'lucide-react'
import type { PotCase, Decision } from '../lib/agronomyEngine'
import { chartSegments, METRICS, type Metric } from '../lib/chartData'
import { clockTime, clockDate, utcLabel, type SessionClock } from '../lib/sessionClock'

export default function HistoryChart({ clock, data, decision, metric = 'moisture', onMetricChange }: { clock: SessionClock; data: PotCase; decision: Decision; metric?: Metric; onMetricChange?: (value: Metric) => void }) {
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [width, setWidth] = useState(720)
  const chart = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = chart.current!
    const observer = new ResizeObserver(() => setWidth(Math.max(240, element.clientWidth - 32)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rows = data.samples.slice(-120), spec = METRICS[metric]
  const selected = rows.find(r => r.t_h === selectedTime) ?? rows.at(-1)!
  const start = rows[0].t_h, end = Math.max(start + .5, data.now_h)
  const x = (hour: number) => 38 + (hour - start) / (end - start) * (width - 66)
  const y = (value: number) => 184 - (value - spec.min) / (spec.max - spec.min) * 150
  const tickCount = width < 440 ? 3 : 6
  const segments = chartSegments(rows, metric)
  const { low, wet, slope_per_h, r2, eta_h } = decision.evidence
  const limits = metric === 'moisture' ? [low, wet] : metric === 'temp_c' ? [data.profile.hot_c] : data.profile.ph_range
  const status = !selected.valid ? 'Gagal · tidak digunakan untuk keputusan' : selected[metric] === null ? 'Tidak diukur · bukan nilai nol' : metric === 'ph' && !data.profile.ph_validated ? 'Terukur · pH belum tervalidasi' : 'Valid'
  return <section className="panel history-panel" aria-labelledby="history-title">
    <div className="panel-heading"><h2 id="history-title"><ChartNoAxesCombined />Riwayat sensor</h2><label className="metric-picker">Parameter<select aria-label="Parameter grafik" value={metric} onChange={e => onMetricChange?.(e.target.value as Metric)}>{Object.entries(METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label></div>
    <p className="chart-help">Waktu {utcLabel(clock, data.now_h)}. Ketuk titik untuk membaca tanggal, nilai, dan status. {rows.length} dari {data.samples.length} sampel ditampilkan.</p>
    <div className="chart-wrap" ref={chart}><svg viewBox={`0 0 ${width} 245`} role="group" aria-label={`Grafik ${spec.label} terhadap waktu sesi`}>
      {[0, 1, 2, 3, 4].map(i => { const n = spec.min + (spec.max - spec.min) * i / 4; return <g key={i}><text x="28" y={y(n) + 4} textAnchor="end">{n}</text><line x1="38" x2={width - 28} y1={y(n)} y2={y(n)} stroke="var(--border-soft)" /></g> })}
      <text x="38" y="17">{spec.unit}</text>
      {limits.map((limit, i) => <line key={i} className="threshold-line" x1="38" x2={width - 28} y1={y(limit)} y2={y(limit)} stroke={i === 0 ? 'var(--amber)' : 'var(--muted)'} strokeDasharray="4 5" />)}
      {segments.map((points, i) => <polyline className="valid-segment" key={i} points={points.map(r => `${x(r.t_h)},${y(r[metric]!)}`).join(' ')} stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinejoin="round" />)}
      {rows.map((r, i) => {
        const value = r[metric], px = x(r.t_h), py = value === null ? 207 : y(value)
        const label = `Sampel ${data.samples.length - rows.length + i + 1}, jam ${`${clockDate(clock, r.t_h)} ${clockTime(clock, r.t_h)}`}, ${spec.label} ${value === null ? 'tidak diukur' : `${value} ${spec.unit}`}, ${r.valid ? 'valid' : 'gagal'}`
        return <g key={r.t_h} className="chart-point" role="button" tabIndex={0} aria-label={label} aria-pressed={selected.t_h === r.t_h} onClick={() => setSelectedTime(r.t_h)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTime(r.t_h) } }}>
          <circle cx={px} cy={py} r="12" fill="transparent" />
          {selected.t_h === r.t_h && <circle className="point-selection" cx={px} cy={py} r="9" fill="var(--sage)" stroke="var(--accent)" />}
          {!r.valid ? <path className="failed-marker" d={`M${px - 5} ${py - 5}l10 10m-10 0 10-10`} stroke="var(--danger)" strokeWidth="2.5" /> : value === null ? <path className="missing-marker" d={`M${px} ${py - 5}l5 5-5 5-5-5Z`} stroke="var(--muted)" fill="var(--surface)" /> : <circle cx={px} cy={py} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />}
        </g>
      })}
      {Array.from({ length: tickCount }, (_, i) => <text key={i} x={38 + (width - 66) * i / (tickCount - 1)} y="223" textAnchor="middle"><tspan>{clockDate(clock, start + (end - start) * i / (tickCount - 1)).slice(0, 5)}</tspan><tspan x={38 + (width - 66) * i / (tickCount - 1)} dy="14">{clockTime(clock, start + (end - start) * i / (tickCount - 1)).slice(0, 5)}</tspan></text>)}
      {data.watering && data.watering.t_h >= start && <line x1={x(data.watering.t_h)} x2={x(data.watering.t_h)} y1="27" y2="187" stroke="var(--water)" strokeDasharray="3 4"><title>Siram {data.watering.volume_ml} mL pada jam {`${clockDate(clock, data.watering.t_h)} ${clockTime(clock, data.watering.t_h)}`}</title></line>}
    </svg></div>
    <div className="chart-legend"><span><Circle />Terukur</span><span><X />Gagal</span><span><Diamond />Tidak diukur</span><span><i className="legend-line amber" />{metric === 'moisture' ? `Acuan air ${low} / basah ${wet}` : metric === 'temp_c' ? `Acuan panas ${limits[0]} °C` : `Acuan pH ${limits.join('–')}`}</span></div>
    <div className="point-detail"><label>Pilih sampel<select aria-label="Pilih sampel grafik" value={selected.t_h} onChange={e => setSelectedTime(Number(e.target.value))}>{rows.map(r => <option key={r.t_h} value={r.t_h}>Jam {`${clockDate(clock, r.t_h)} ${clockTime(clock, r.t_h)}`}</option>)}</select></label><div aria-live="polite"><strong>{spec.label}: {selected[metric] === null ? 'Tidak diukur' : `${selected[metric]} ${spec.unit}`}</strong><span>{status}</span><span>Waktu {`${clockDate(clock, selected.t_h)} ${clockTime(clock, selected.t_h)}`} {utcLabel(clock, selected.t_h)} · umur {Math.round((data.now_h - selected.t_h) * 60)} menit</span></div></div>
    <p className="chart-help">Garis terputus pada sampel gagal, tanpa pengukuran, atau jeda lebih dari 1 jam. Tren keputusan memakai riwayat sesi lengkap.</p>
    {metric === 'moisture' && <div className="trend-stats"><span>Tren sesi <b>{slope_per_h === null ? 'Belum tersedia' : `${slope_per_h} poin/jam`}</b></span><span>R² <b>{r2 ?? '—'}</b></span><span>Menuju acuan <b>{eta_h === null ? 'Tidak diproyeksikan' : `${eta_h} jam`}</b></span></div>}
  </section>
}
