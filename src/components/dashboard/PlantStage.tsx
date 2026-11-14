import type { ReactNode } from 'react'
import PlantIllustration from '../PlantIllustration'
import { skyOrbits, type SkyPeriod } from '../../lib/dashboardFacts'

/* The dashboard's centrepiece: the pot, three readings pointed at the part of the pot they describe, and a lens that
 * opens the shell over the root zone. Layout after "Smart Plant Monitoring Dashboard" by Oripio on Dribbble; only the
 * composition is borrowed (plant centre, leader lines, glass lens). Positions live in one 900 × 560 stage so the lines,
 * the figure and the labels stay aligned at every width. The sky behind it follows the session clock: the same
 * hours as the simulator scene, so a night reading is dark and a noon reading is bright. */

// The plant is cropped to its own bounds, then placed in the stage at x 330, y 30, 390 × 500 units.
const CROP = { x: 70, y: 60, w: 320, h: 410 }
const FIGURE = { x: 330, y: 30, w: 390, h: 500 }
const at = (px: number, py: number) => [FIGURE.x + (px - CROP.x) * FIGURE.w / CROP.w, FIGURE.y + (py - CROP.y) * FIGURE.h / CROP.h] as const
const pct = (x: number, y: number) => ({ left: `${x / 9}%`, top: `${y / 5.6}%` })

const soil = at(300, 322), body = at(330, 400), roots = at(150, 372)
const LENS = { cx: 175, cy: 300, r: 125 }
const lensEdge = (() => {
  const dx = roots[0] - LENS.cx, dy = roots[1] - LENS.cy, d = Math.hypot(dx, dy)
  return [LENS.cx + dx / d * LENS.r, LENS.cy + dy / d * LENS.r] as const
})()

// A fixed field of stars, drawn only at night; the faint line joins five of them into a chili.
const STARS = (() => {
  let seed = 7
  const next = () => (seed = seed * 16807 % 2147483647) / 2147483647
  return Array.from({ length: 40 }, () => ({ x: Math.round(next() * 1000), y: Math.round(next() * 210), r: +(.7 + next() * .9).toFixed(1), twinkle: next() > .6, delay: +(next() * 4).toFixed(1) }))
})()
const CHILI = [[778, 92], [798, 112], [810, 142], [806, 176], [794, 206], [774, 230], [754, 242], [740, 238]] as const

interface Reading { label: string; value: string; unit?: string; note: string; alert?: boolean }
export default function PlantStage({ crop, sub, status, onion, day, age, planted, moisture, contact, readings, hour, period, children }: {
  crop: string; sub: string; status: { ok: boolean; text: string }; onion: boolean; day: number; age: number; planted: boolean; moisture: number; contact: boolean
  readings: { moisture: Reading; temperature: Reading; ph: Reading }; hour: number; period: SkyPeriod; children?: ReactNode
}) {
  const { sun, moon } = skyOrbits(hour)
  const orb = (o: { x: number; y: number; opacity: number }) => ({ left: `${o.x}%`, top: `${o.y}%`, opacity: o.opacity })
  const callouts = [
    { key: 'moisture', reading: readings.moisture, dot: soil, path: `M${soil[0]} ${soil[1]}L700 190H890`, label: pct(700, 190), side: 'right' },
    { key: 'temperature', reading: readings.temperature, dot: body, path: `M${body[0]} ${body[1]}L720 490H890`, label: pct(720, 490), side: 'right' },
    { key: 'ph', reading: readings.ph, dot: roots, path: `M${lensEdge[0]} ${lensEdge[1]}L${roots[0]} ${roots[1]}`, label: pct(46, 520), side: 'lens' },
  ] as const
  return <section className="plant-stage-section dash-stage" data-sky={period} aria-labelledby="plant-stage-title">
    <div className="sky" aria-hidden="true">
      <i className="orb sun" style={orb(sun)} /><i className="orb moon" style={orb(moon)} />
      <svg className="stars" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
        {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} className={s.twinkle ? 'twinkle' : undefined} style={s.twinkle ? { animationDelay: `-${s.delay}s` } : { opacity: .55 }} />)}
        <polyline points={CHILI.map(p => p.join(',')).join(' ')} />
        {[0, 2, 4, 6, 7].map(i => <circle key={i} cx={CHILI[i][0]} cy={CHILI[i][1]} r="2.2" className="twinkle" />)}
      </svg>
      <svg className="hill" viewBox="0 0 1000 200" preserveAspectRatio="none">
        <path className="hill-far" d="M0 120C150 56 300 112 460 78S760 36 1000 92V200H0Z" />
        <path className="hill-near" d="M0 164C200 122 380 172 560 136S860 110 1000 152V200H0Z" />
      </svg>
    </div>
    <header className="plant-heading">
      <div><h2 id="plant-stage-title">{crop} <span>dalam pot</span></h2><p>{sub}</p></div>
      <span className="reading-status" data-alert={!status.ok || undefined}><i aria-hidden="true" />{status.text}</span>
    </header>
    <div className="plant-stage">
      <svg className="stage-lines" viewBox="0 0 900 560" aria-hidden="true">
        <circle className="lens-orbit" cx={LENS.cx} cy={LENS.cy} r={LENS.r + 18} />
        {callouts.map(c => <g key={c.key} data-alert={c.reading.alert || undefined}>
          <path d={c.path} />
          <circle className="stage-dot-halo" cx={c.dot[0]} cy={c.dot[1]} r="9" />
          <circle className="stage-dot" cx={c.dot[0]} cy={c.dot[1]} r="4" />
        </g>)}
      </svg>
      <div className="stage-figure" style={{ left: `${FIGURE.x / 9}%`, top: `${FIGURE.y / 5.6}%`, width: `${FIGURE.w / 9}%`, height: `${FIGURE.h / 5.6}%` }}>
        <PlantIllustration viewBox={`${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}`} day={day} age={age} onion={onion} moisture={moisture} contact={contact} planted={planted} shellOpacity={1} />
      </div>
      <figure className="lens" style={{ left: `${(LENS.cx - LENS.r) / 9}%`, top: `${(LENS.cy - LENS.r) / 5.6}%`, width: `${LENS.r * 2 / 9}%` }}>
        <div className="lens-glass" aria-hidden="true">
          <PlantIllustration viewBox="163 316 126 126" day={day} age={age} onion={onion} moisture={moisture} contact={contact} planted={planted} showSensors shellOpacity={0} />
        </div>
        <figcaption className="sr-only">Penampang zona akar dengan probe kelembapan, suhu, dan pH di dalam media.</figcaption>
      </figure>
      {callouts.map(c => <div key={c.key} className={`stage-callout is-${c.side} callout-${c.key}`} style={c.label} data-alert={c.reading.alert || undefined}>
        <small>{c.reading.label}</small>
        <strong>{c.reading.value}{c.reading.unit && <span>{c.reading.unit}</span>}</strong>
        <em>{c.reading.note}</em>
      </div>)}
    </div>
    {children}
  </section>
}
