import { Pause, Play } from '@phosphor-icons/react'
import type { Sample } from '../../lib/agronomyEngine'

const BARS = 44, W = 300, H = 40, GAP = W / BARS
const RATE = new Map([[1, 'Lambat'], [12, 'Normal'], [48, 'Cepat']])

/** Session time, worn at the foot of the stage like a player: play, the time, and a strip of recent samples
 * (each bar is one 30-minute reading; failed readings drop to a short mark). It says "simulasi" because the clock is one. */
export default function SessionClockCard({ samples, time, period, state, note, rate, running, disabled, onToggle }: {
  samples: Sample[]; time: string; period: string; state: string; note: string; rate: number
  running: boolean; disabled: boolean; onToggle: () => void
}) {
  const rows = samples.slice(-BARS), offset = BARS - rows.length
  // A disabled control says why (e.g. "Tanam bibit untuk memulai waktu.") instead of an action it cannot do.
  const label = disabled ? note || 'Waktu berhenti' : running ? 'Jeda waktu' : 'Lanjutkan waktu'
  return <section className="panel dashboard-clock" aria-label="Waktu sesi" data-running={running || undefined}>
    <button type="button" className="button play-toggle" aria-label={label} title={label} disabled={disabled} onClick={onToggle}>
      {running ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
    </button>
    <div className="clock-time"><strong>{time}</strong><small>Waktu simulasi · {period}</small></div>
    <svg className="sample-wave" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => {
        const row = rows[i - offset], cx = i * GAP + GAP / 2
        const h = !row ? 3 : row.valid ? 5 + row.moisture / 100 * (H - 8) : 4
        return <rect key={i} className={!row ? 'empty' : !row.valid ? 'failed' : i === BARS - 1 ? 'latest' : ''} x={cx - 1.25} y={(H - h) / 2} width="2.5" height={h} rx="1.25" />
      })}
    </svg>
    <span className="clock-play-state">{state}<small>Laju {RATE.get(rate) ?? `${rate}×`}</small></span>
    <small className={note ? 'clock-pause-note' : 'sr-only'} role="status">{note || 'Sinkron dengan grafik dan terminal'}</small>
  </section>
}
