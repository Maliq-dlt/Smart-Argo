import { Pause, Play } from '@phosphor-icons/react'
import type { Sample } from '../../lib/agronomyEngine'

const BARS = 44, W = 300, H = 52, GAP = W / BARS
const RATE = new Map([[1, 'Lambat'], [12, 'Normal'], [48, 'Cepat']])

/** Session time as a strip of recent samples: each bar is one 30-minute reading, failed readings drop to a short mark. */
export default function SessionClockCard({ samples, date, utc, time, state, note, rate, running, disabled, onToggle }: {
  samples: Sample[]; date: string; utc: string; time: string; state: string; note: string; rate: number
  running: boolean; disabled: boolean; onToggle: () => void
}) {
  const rows = samples.slice(-BARS), offset = BARS - rows.length
  const label = running ? 'Jeda waktu' : 'Lanjutkan waktu'
  return <section className="panel dashboard-clock" aria-labelledby="dashboard-clock-title" data-running={running || undefined}>
    <header>
      <div><h3 id="dashboard-clock-title">Waktu sesi</h3><p>{date} · {utc}</p></div>
      <button type="button" className="button play-toggle" aria-label={label} title={label} disabled={disabled} onClick={onToggle}>
        {running ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
      </button>
    </header>
    <svg className="sample-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => {
        const row = rows[i - offset], cx = i * GAP + GAP / 2
        const h = !row ? 3 : row.valid ? 6 + row.moisture / 100 * (H - 10) : 5
        return <rect key={i} className={!row ? 'empty' : !row.valid ? 'failed' : i === BARS - 1 ? 'latest' : ''} x={cx - 1.25} y={(H - h) / 2} width="2.5" height={h} rx="1.25" />
      })}
    </svg>
    <footer>
      <span className="clock-play-state">{state}<small>Laju {RATE.get(rate) ?? `${rate}×`}</small></span>
      <strong>{time}</strong>
    </footer>
    <small className="clock-pause-note" role="status">{note || 'Sinkron dengan grafik dan terminal'}</small>
  </section>
}
