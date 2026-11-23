import { useMemo, useState, type ComponentProps } from 'react'
import { CheckCircle, Drop, Leaf, NotePencil, type Icon } from '@phosphor-icons/react'
import SegmentedControl from '../ui/segmented-control'
import StatisticsDashboard from '../StatisticsDashboard'
import { WEEKDAYS, healthyDays, journal, shortDate, weekShare, type JournalKind } from '../../lib/plantHistory'

const KIND_ICON: Record<JournalKind, Icon> = { water: Drop, feed: Leaf, check: CheckCircle, other: NotePencil }
const hrs = (h: number) => h.toLocaleString('id-ID', { maximumFractionDigits: 1 })
type View = 'chart' | 'calendar' | 'journal'

/** Riwayat in one card, three views: the chart (with the statistics folded under it), a calendar of hours in the healthy
 *  band, and the journal of what was done. One card, so the plant page never grows with every view at once. */
export default function HistoryCard({ band, ...chart }: ComponentProps<typeof StatisticsDashboard> & { band: readonly [number, number] | null }) {
  const [view, setView] = useState<View>('chart')
  const { data, clock, logs } = chart
  const days = useMemo(() => band ? healthyDays(data.samples, band, clock, data.now_h) : [], [data.samples, data.now_h, band, clock])
  // The five latest days that have an entry: the card stays the height of the others.
  const entries = useMemo(() => journal(logs, clock, data.now_h).slice(0, 5), [logs, clock, data.now_h])
  // The first visit has nothing to look back on: the chart's own empty state asks for the one next step.
  if (data.samples.length < 2) return <StatisticsDashboard {...chart} />
  const share = weekShare(days)
  return <section className="history-card" aria-labelledby="history-title">
    <header className="history-head">
      <h2 id="history-title">Riwayat</h2>
      <SegmentedControl label="Tampilan riwayat" value={view} onValueChange={v => setView(v as View)}
        options={[{ value: 'chart', label: 'Grafik' }, { value: 'calendar', label: 'Kalender' }, { value: 'journal', label: 'Jurnal' }]} />
    </header>
    {view === 'chart' && <StatisticsDashboard {...chart} />}
    {view === 'calendar' && <div className="panel history-calendar">
      <h3>Kalender kelembapan</h3>
      {!band ? <p className="history-note">Kalender muncul setelah rentang sehat pot ini diketahui.</p> : <>
        <p className="history-note">Jam per hari dengan tanah di rentang sehat ({hrs(band[0])}–{hrs(band[1])}).</p>
        <div className="cal-grid">
          {WEEKDAYS.map(d => <span key={d} className="cal-dow" aria-hidden="true">{d.slice(0, 3)}</span>)}
          {/* Blank cells put the first day under its weekday. */}
          {Array.from({ length: days[0]?.weekday ?? 0 }, (_, i) => <span key={`pad${i}`} aria-hidden="true" />)}
          {days.map(d => <span key={d.date} className="cal-cell" role="img" data-level={d.level ?? 'none'} data-today={d.today || undefined}
            aria-label={`${WEEKDAYS[d.weekday]} ${shortDate(d.date)}: ${d.level === null ? 'tidak ada bacaan' : `${hrs(d.hours)} dari ${hrs(d.span)} jam di rentang sehat`}`}
            title={`${shortDate(d.date)} · ${d.level === null ? 'tidak ada bacaan' : `${hrs(d.hours)} jam`}`} />)}
        </div>
        <p className="cal-legend" aria-hidden="true">Sedikit {[0, 1, 2, 3, 4].map(l => <i key={l} data-level={l} />)} Sepanjang hari</p>
        {share !== null && <p className="history-note">7 hari terakhir: <b>{share}%</b> waktu teramati di rentang sehat.</p>}
      </>}
    </div>}
    {view === 'journal' && <div className="panel history-journal">
      <h3>Jurnal</h3>
      {entries.length > 0 && <p className="history-note">Lima hari terakhir yang tercatat.</p>}
      {entries.length ? entries.map(day => <section key={day.date} className="journal-day" aria-label={day.label}>
        <h4>{day.label}</h4>
        <ul>{day.entries.map(e => { const Glyph = KIND_ICON[e.kind]; return <li key={e.id}><Glyph aria-hidden="true" /><time>{e.time}</time><span>{e.text}</span></li> })}</ul>
      </section>) : <p className="history-note">Belum ada catatan. Siraman, pupuk, dan pengecekan muncul di sini.</p>}
    </div>}
  </section>
}
