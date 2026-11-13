import PlantIllustration from '../PlantIllustration'

/* The dashboard's centrepiece: the pot, three readings pointed at the part of the pot they describe, and a lens that
 * opens the shell over the root zone. Layout after "Smart Plant Monitoring Dashboard" by Oripio on Dribbble; only the
 * composition is borrowed (plant centre, leader lines, glass lens). Positions live in one 900 × 560 stage so the lines,
 * the figure and the labels stay aligned at every width. */

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

interface Reading { label: string; value: string; unit?: string; note: string; alert?: boolean }
export default function PlantStage({ crop, sub, status, onion, day, age, planted, moisture, contact, readings }: {
  crop: string; sub: string; status: { ok: boolean; text: string }; onion: boolean; day: number; age: number; planted: boolean; moisture: number; contact: boolean
  readings: { moisture: Reading; temperature: Reading; ph: Reading }
}) {
  const callouts = [
    { key: 'moisture', reading: readings.moisture, dot: soil, path: `M${soil[0]} ${soil[1]}L700 190H890`, label: pct(700, 190), side: 'right' },
    { key: 'temperature', reading: readings.temperature, dot: body, path: `M${body[0]} ${body[1]}L720 490H890`, label: pct(720, 490), side: 'right' },
    { key: 'ph', reading: readings.ph, dot: roots, path: `M${lensEdge[0]} ${lensEdge[1]}L${roots[0]} ${roots[1]}`, label: pct(46, 520), side: 'lens' },
  ] as const
  return <section className="plant-stage-section" aria-labelledby="plant-stage-title">
    <header className="plant-heading">
      <h2 id="plant-stage-title">{crop} <span>dalam pot</span></h2>
      <p>{sub}</p>
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
  </section>
}
