import { SelectField } from './ui/select'
import SegmentedControl from './ui/segmented-control'
import { useMemo, useState, type ReactNode } from 'react'
import { Activity, Clock3, MoveVertical, ShieldCheck } from 'lucide-react'
import type { Decision, PotCase } from '../lib/agronomyEngine'
import { METRICS, summarizeSamples, type Metric } from '../lib/chartData'
import type { SessionClock } from '../lib/sessionClock'
import HistoryChart from './HistoryChart'

export default function StatisticsDashboard({ clock, data, decision, care, readings, playback }: { clock: SessionClock; data: PotCase; decision: Decision; care: ReactNode; readings: ReactNode; playback: ReactNode }) {
  const [metric, setMetric] = useState<Metric>('moisture')
  const [windowHours, setWindowHours] = useState(0)
  const [bin, setBin] = useState<number | null>(null)
  const rows = useMemo(() => data.samples.filter(r => !windowHours || r.t_h >= data.now_h - windowHours), [data, windowHours])
  const stats = useMemo(() => summarizeSamples(rows, metric), [rows, metric])
  const spec = METRICS[metric], format = (v: number | null) => v === null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: 1 })
  const quality = [
    { label: 'Valid & terukur', count: stats.count, color: 'var(--accent)' },
    { label: 'Gagal', count: stats.failed, color: 'var(--danger)' },
    { label: 'Tidak diukur', count: stats.missing, color: 'var(--border)' },
  ]
  const measuredPercent = rows.length ? stats.count / rows.length * 100 : 0
  const highestBin = Math.max(1, ...stats.bins.map(b => b.count))
  let offset = 0
  return <>
    <div className="analysis-toolbar"><div><h2>Ikhtisar statistik</h2><p>{rows.length} sampel · {windowHours ? `${windowHours} jam terakhir` : 'seluruh sesi'} · filter untuk statistik</p></div>
      <div className="analysis-filters"><label><span>Parameter</span><SelectField label="Parameter statistik" value={metric} onValueChange={value => { setMetric(value as Metric); setBin(null) }} options={Object.entries(METRICS).map(([value, item]) => ({ value, label: item.label }))} /></label>
      <div className="range-filter"><span>Rentang statistik</span><SegmentedControl label="Rentang statistik" value={String(windowHours)} onValueChange={value => setWindowHours(Number(value))} options={[{ value: '0', label: 'Semua' }, { value: '24', label: '24 jam' }, { value: '72', label: '72 jam' }]} /></div></div>
    </div>
    <div className="analytics-metrics">
      <div className="metric-featured"><div className="stat-card-heading"><span>Rata-rata {spec.label.toLowerCase()}</span><Activity /></div><strong>{format(stats.mean)} <small>{spec.unit}</small></strong><p>Dari {stats.count} pengukuran valid</p></div>
      <div><div className="stat-card-heading"><span>Terendah — tertinggi</span><MoveVertical /></div><strong>{format(stats.min)} <small>—</small> {format(stats.max)}</strong><p>{spec.unit} · hanya nilai valid</p></div>
      <div><div className="stat-card-heading"><span>Pengukuran valid</span><ShieldCheck /></div><strong>{format(measuredPercent)}<small>%</small></strong><p>{stats.count} dari {rows.length} sampel</p></div>
      <div><div className="stat-card-heading"><span>Durasi teramati</span><Clock3 /></div><strong>{format(rows.length > 1 ? rows.at(-1)!.t_h - rows[0].t_h : 0)}<small>jam</small></strong><p>{rows.length > 1 ? 'Sampel pertama hingga terakhir' : 'Perlu sampel berikutnya'}</p></div>
    </div>
    <div className="dashboard-grid">
      <section className="panel analytic-card distribution-card" aria-labelledby="distribution-title"><header><h3 id="distribution-title">Sebaran {spec.label.toLowerCase()}</h3><p>Jumlah pengukuran per rentang nilai</p></header>
        <div className="histogram" aria-label={`Histogram ${spec.label}`}>
          {stats.bins.map((b, i) => <button key={i} className="histogram-bin" aria-pressed={bin === i} aria-label={`${format(b.low)} hingga ${format(b.high)} ${spec.unit}, ${b.count} pengukuran${i < 4 ? ', batas atas tidak termasuk' : ''}`} onClick={() => setBin(i)}><span className="bin-count">{b.count}</span><span className="bin-track"><i style={{ height: `${b.count / highestBin * 100}%` }} /></span><span className="bin-label">{format(b.low)}<br />{format(b.high)}</span></button>)}
        </div><p className="analytic-note" aria-live="polite">{bin === null ? `${stats.count} nilai valid · ketuk batang untuk rincian.` : `${format(stats.bins[bin].low)} ${bin < 4 ? '≤ nilai <' : '≤ nilai ≤'} ${format(stats.bins[bin].high)} ${spec.unit}: ${stats.bins[bin].count} pengukuran.`}</p>
      </section>
      {care}
      {readings}
      <section className="panel analytic-card quality-card" aria-labelledby="quality-title"><header><h3 id="quality-title">Kualitas pengukuran</h3><p>{spec.label} · proporsi seluruh sampel</p></header><div className="quality-chart">
        <svg viewBox="0 0 160 160" role="img" aria-label={`${stats.count} valid, ${stats.failed} gagal, ${stats.missing} tidak diukur`}><circle cx="80" cy="80" r="58" fill="none" stroke="var(--border-soft)" strokeWidth="15" />
          {quality.map(q => { const length = rows.length ? q.count / rows.length * 100 : 0, start = offset; offset += length; return <circle key={q.label} cx="80" cy="80" r="58" pathLength="100" fill="none" stroke={q.color} strokeWidth="15" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 80 80)" /> })}
          <text x="80" y="78" textAnchor="middle" className="donut-value">{format(measuredPercent)}%</text><text x="80" y="100" textAnchor="middle" className="donut-label">valid</text>
        </svg><dl>{quality.map(q => <div key={q.label}><dt><i style={{ background: q.color }} />{q.label}</dt><dd>{q.count}</dd></div>)}</dl>
      </div><p className="analytic-note">Tidak diukur berarti kosong, bukan nol. Validitas sampel tidak menyatakan kalibrasi sensor.</p></section>
      <section className="panel analytic-card range-card" aria-labelledby="range-title"><header><h3 id="range-title">Rentang per 24 jam</h3><p>Minimum, rata-rata, maksimum · {spec.unit}</p></header>
        {stats.days.length ? <div className="daily-ranges"><div className="range-axis"><span>Jam sesi</span><span>{spec.min}</span><span>{spec.max}</span></div>{stats.days.map(d => <div className="daily-row" key={d.hour}><span>{d.hour}–{d.hour + 24}</span><div className="daily-track" role="img" aria-label={`Jam ${d.hour} hingga ${d.hour + 24}: minimum ${format(d.min)}, rata-rata ${format(d.sum / d.count)}, maksimum ${format(d.max)}, ${d.count} nilai valid`}><i style={{ left: `${(d.min - spec.min) / (spec.max - spec.min) * 100}%`, width: `${(d.max - d.min) / (spec.max - spec.min) * 100}%` }} /><b style={{ left: `${(d.sum / d.count - spec.min) / (spec.max - spec.min) * 100}%` }} /></div><span>{format(d.min)}–{format(d.max)}</span></div>)}</div> : <p className="empty-chart">Belum ada pengukuran valid.</p>}
        <p className="analytic-note">Maksimal 7 kelompok terakhir yang memiliki data. Titik menunjukkan rata-rata, bukan proyeksi.</p>
      </section>
      {playback}
    </div>
    {rows.length ? <HistoryChart clock={clock} data={{ ...data, samples: rows }} decision={decision} metric={metric} onMetricChange={setMetric} /> : <p className="empty-chart">Belum ada sampel pada rentang ini. Pilih seluruh sesi.</p>}
  </>
}
