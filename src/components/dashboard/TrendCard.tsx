import { useMemo, useState } from 'react'
import type { Sample } from '../../lib/agronomyEngine'
import { chartSegments } from '../../lib/chartData'
import { clockTime, type SessionClock } from '../../lib/sessionClock'
import { SelectField } from '../ui/select'

const W = 320, H = 150, TOP = 22, BOTTOM = 112
const y = (value: number) => BOTTOM - value / 100 * (BOTTOM - TOP)
const n = (value: number) => Math.round(value * 10) / 10

/** Catmull-Rom through the points, as cubic Béziers; the curve never extends past the measured range. */
function smooth(points: [number, number][]) {
  let d = `M${n(points[0][0])} ${n(points[0][1])}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2
    const clamp = (v: number) => Math.min(BOTTOM, Math.max(TOP - 6, v))
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(clamp(p1[1] + (p2[1] - p0[1]) / 6))} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(clamp(p2[1] - (p3[1] - p1[1]) / 6))} ${n(p2[0])} ${n(p2[1])}`
  }
  return d
}

const RANGES = [{ value: '12', label: '12 jam' }, { value: '24', label: '24 jam' }, { value: '0', label: 'Semua' }]

/** Moisture over a short window: the lime overview card. The full, point-by-point history sits below in Pengamatan sesi. */
export default function TrendCard({ samples, now, low, clock }: { samples: Sample[]; now: number; low: number; clock: SessionClock }) {
  const [range, setRange] = useState('12')
  const hours = Number(range)
  const rows = useMemo(() => samples.filter(r => !hours || r.t_h >= now - hours).slice(-120), [samples, hours, now])
  const segments = useMemo(() => chartSegments(rows, 'moisture'), [rows])
  const start = rows[0]?.t_h ?? now, end = Math.max(start + .5, now)
  // Leave room on the right for the latest value pill.
  const x = (hour: number) => 4 + (hour - start) / (end - start) * (W - 34)
  const lastValid = [...rows].reverse().find(r => r.valid)
  const plotted = segments.reduce((total, s) => total + s.length, 0)
  const ticks = [0, 1, 2, 3].map(i => start + (end - start) * i / 3)
  const label = RANGES.find(r => r.value === range)!.label
  return <section className="panel trend-card" aria-labelledby="trend-title">
    <header>
      <div><h3 id="trend-title">Kelembapan</h3><p>{hours ? `${label} terakhir` : 'Seluruh sesi'} · acuan air {low}</p></div>
      <SelectField label="Rentang tren" value={range} onValueChange={setRange} options={RANGES} />
    </header>
    {plotted < 2 ? <p className="trend-empty">Grafik muncul setelah sampel kedua tercatat.</p> : <figure className="trend-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Kelembapan ${hours ? label + ' terakhir' : 'seluruh sesi'}: ${plotted} sampel valid, terakhir ${lastValid?.moisture ?? '—'} dari 100, acuan air ${low}.`}>
        <defs><linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="trend-fill-top" /><stop offset="1" className="trend-fill-bottom" /></linearGradient></defs>
        <line className="trend-threshold" x1="0" x2={W} y1={y(low)} y2={y(low)} vectorEffect="non-scaling-stroke" />
        {segments.map((segment, i) => {
          const points = segment.map(r => [x(r.t_h), y(r.moisture)] as [number, number])
          if (points.length === 1) return <circle key={i} className="trend-solo" cx={points[0][0]} cy={points[0][1]} r="2" />
          const line = smooth(points)
          return <g key={i}><path className="trend-area" d={`${line}L${n(points.at(-1)![0])} ${H}L${n(points[0][0])} ${H}Z`} fill="url(#trend-fill)" />
            <path className="trend-line" d={line} vectorEffect="non-scaling-stroke" /></g>
        })}
      </svg>
      {lastValid && <span className="trend-tip" style={{ left: `${x(lastValid.t_h) / W * 100}%`, top: `${y(lastValid.moisture) / H * 100}%` }}><b>{lastValid.moisture.toLocaleString('id-ID')}</b></span>}
      <figcaption className="trend-axis" aria-hidden="true">{ticks.map((t, i) => <span key={i} data-current={i === 3 || undefined}>{clockTime(clock, t).slice(0, 5)}</span>)}</figcaption>
    </figure>}
  </section>
}
