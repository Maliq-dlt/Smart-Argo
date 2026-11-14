import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { TrendDown } from '@phosphor-icons/react'
import type { Sample } from '../../lib/agronomyEngine'
import { chartSegments } from '../../lib/chartData'
import { ZONE_NAME, agoLabel, zoneOf, type Zone } from '../../lib/dashboardFacts'
import SegmentedControl from '../ui/segmented-control'
import { useWidth } from './useWidth'

const RANGES = [{ value: '12', label: '12 jam' }, { value: '24', label: '24 jam' }, { value: '0', label: 'Semua' }]
const L = 44, R = 12, T = 14, B = 30, BINS = 48
const nf = (value: number) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Moisture against the profile's own limits: three zones (dry below the watering limit, wet above the drained one),
 * the line broken wherever a reading failed or is missing, and a ribbon that shows the zone at a glance.
 * Values are readable by pointer, by tap and by keyboard; the live region speaks the same text. */
export default function ConditionBand({ samples, now, low, wet, slope }: { samples: Sample[]; now: number; low: number; wet: number; slope: number | null }) {
  const [range, setRange] = useState('24')
  const [pick, setPick] = useState<number | null>(null)
  const [spoken, setSpoken] = useState('')
  const [frame, width] = useWidth<HTMLDivElement>()
  const hours = Number(range)
  const rows = useMemo(() => samples.filter(r => !hours || r.t_h >= now - hours).slice(-336), [samples, hours, now])
  const valid = useMemo(() => rows.filter(r => r.valid), [rows])
  const segments = useMemo(() => chartSegments(rows, 'moisture'), [rows])
  const W = Math.max(300, width || 960), H = W < 560 ? 210 : 250, pw = W - L - R, ph = H - T - B
  const start = rows[0]?.t_h ?? now, end = Math.max(start + .5, now)
  const X = (t: number) => L + (t - start) / (end - start) * pw, Y = (v: number) => T + ph * (1 - v / 100)
  const describe = (p: Sample) => `${end - p.t_h < 1e-6 ? 'Sekarang' : '−' + agoLabel(end - p.t_h)} · ${nf(p.moisture)}`
  const show = (index: number, speak = false) => {
    const i = clamp(index, 0, valid.length - 1)
    setPick(i)
    if (speak) setSpoken(`${describe(valid[i])} dari 100, zona ${ZONE_NAME[zoneOf(valid[i].moisture, low, wet)]}`)
  }
  const nearest = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), t = start + ((event.clientX - box.left) / box.width * W - L) / pw * (end - start)
    let best = 0
    valid.forEach((p, i) => { if (Math.abs(p.t_h - t) < Math.abs(valid[best].t_h - t)) best = i })
    return best
  }
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { setPick(null); return }
    const step = event.shiftKey ? 12 : 1, current = pick ?? valid.length - 1
    const next = event.key === 'ArrowLeft' ? current - step : event.key === 'ArrowRight' ? current + step : event.key === 'Home' ? 0 : event.key === 'End' ? valid.length - 1 : null
    if (next === null) return
    event.preventDefault()
    show(next, true)
  }
  const bins = useMemo(() => Array.from({ length: BINS }, (_, b): Zone | 'gap' => {
    const t = start + (end - start) * (b + 1) / BINS
    let found: Sample | undefined
    for (const p of valid) { if (p.t_h <= t + 1e-6) found = p; else break }
    // A bin with no reading in the last hour is shown as a gap, not as the old zone.
    return found && t - found.t_h <= (end - start) / BINS + 1 ? zoneOf(found.moisture, low, wet) : 'gap'
  }), [valid, start, end, low, wet])
  const tip = pick === null ? null : valid[pick]
  const lo = valid.length ? Math.min(...valid.map(p => p.moisture)) : 0, hi = valid.length ? Math.max(...valid.map(p => p.moisture)) : 0
  const span = hours ? `${hours} jam terakhir` : 'seluruh sesi'
  const last = valid.at(-1)
  return <section className="panel condition-band" aria-labelledby="band-title">
    <header>
      <div><h3 id="band-title">Kelembapan <em>media</em></h3>
        <div className="band-now">
          <span className="band-rate">{slope === null ? '—' : <>{slope > 0 ? '+' : '−'}<b className="band-rate-value">{nf(Math.abs(slope))}</b></>}<small>{slope === null ? 'laju belum tersedia' : 'poin tiap jam'}</small></span>
          {valid.length > 0 && <span className="band-range"><TrendDown aria-hidden="true" />Terendah {nf(lo)} · tertinggi {nf(hi)}, {span}</span>}
        </div></div>
      <SegmentedControl label="Rentang tren" value={range} onValueChange={value => { setRange(value); setPick(null) }} options={RANGES} />
    </header>
    <div className="band-frame" ref={frame}>
      {valid.length < 2 ? <p className="band-empty">Grafik muncul setelah sampel kedua tercatat.</p> : <>
        <div className="band-chart" tabIndex={0} role="group" onKeyDown={onKey} onFocus={() => show(valid.length - 1, true)} onBlur={() => setPick(null)}
          aria-label={`Grafik kelembapan media, ${span}${last ? `, saat ini ${nf(last.moisture)} dari 100` : ''}. Tekan panah kiri atau kanan untuk membaca tiap nilai, Shift untuk loncat 6 jam.`}>
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" onPointerDown={e => show(nearest(e))} onPointerMove={e => show(nearest(e))} onPointerLeave={e => { if (e.pointerType === 'mouse') setPick(null) }}>
            <defs><linearGradient id="band-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="band-fill-top" /><stop offset="1" className="band-fill-bottom" /></linearGradient></defs>
            <rect className="band-zone wet" x={L} y={Y(100)} width={pw} height={Y(wet) - Y(100)} />
            <rect className="band-zone ok" x={L} y={Y(wet)} width={pw} height={Y(low) - Y(wet)} />
            <rect className="band-zone dry" x={L} y={Y(low)} width={pw} height={Y(0) - Y(low)} />
            {[25, 50, 75].map(v => <line key={v} className="band-grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} />)}
            {[wet, low].map(v => <line key={v} className="band-limit" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} />)}
            <text className="band-label" x={L + 8} y={Y(wet) - 7}>Batas basah {wet}</text>
            <text className="band-label" x={L + 8} y={Y(low) + 16}>Batas siram {low}</text>
            {[0, 25, 50, 75, 100].map(v => <text key={v} className="band-axis" x={L - 10} y={Y(v) + 4} textAnchor="end">{v}</text>)}
            {[0, 1, 2, 3].map(i => { const t = start + (end - start) * i / 3; return <text key={i} className="band-axis" x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>{i === 3 ? 'sekarang' : `−${agoLabel(end - t)}`}</text> })}
            {segments.map((segment, i) => segment.length < 2
              ? <circle key={i} className="band-solo" cx={X(segment[0].t_h)} cy={Y(segment[0].moisture)} r="3" />
              : <g key={i}>
                <path className="band-area" d={`${segment.map((p, k) => `${k ? 'L' : 'M'}${X(p.t_h).toFixed(1)} ${Y(p.moisture).toFixed(1)}`).join('')}L${X(segment.at(-1)!.t_h).toFixed(1)} ${Y(0)}L${X(segment[0].t_h).toFixed(1)} ${Y(0)}Z`} />
                <path className="band-line" d={segment.map((p, k) => `${k ? 'L' : 'M'}${X(p.t_h).toFixed(1)} ${Y(p.moisture).toFixed(1)}`).join('')} />
              </g>)}
            {tip && <g><line className="band-hover" x1={X(tip.t_h)} x2={X(tip.t_h)} y1={T} y2={Y(0)} /><circle className="band-dot" cx={X(tip.t_h)} cy={Y(tip.moisture)} r="5" /></g>}
            {last && <circle className="band-dot" cx={X(last.t_h)} cy={Y(last.moisture)} r="5.5" />}
          </svg>
          {tip && <div className="band-tip" style={{ left: clamp(X(tip.t_h), 56, W - 56), top: Y(tip.moisture) - 12 }}>{describe(tip)}</div>}
          <p className="sr-only" aria-live="polite">{spoken}</p>
        </div>
        <div className="band-ribbon" aria-hidden="true">{bins.map((zone, i) => <i key={i} data-zone={zone} />)}</div>
        <ul className="band-legend"><li data-zone="dry"><i />Kering, di bawah {low}</li><li data-zone="ok"><i />Ideal, {low}–{wet}</li><li data-zone="wet"><i />Basah, di atas {wet}</li></ul>
      </>}
    </div>
  </section>
}
