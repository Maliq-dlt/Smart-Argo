// Interaction pattern adapted from "Coffee Pour Menu" by Aakash Mehra on 21st.dev
// (https://21st.dev/@aakashmehra/components/coffee-pour-menu), retrieved 12 Nov 2026: a menu beside a
// stage where choosing an item tips the current vessel away, springs the next one in and pours it.
// Here the vessel is a pot, the pour is the watering in the scenario, and the level then follows the
// recorded readings. The verdict is the real rule engine's output for that scenario.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import type { StoryCrop } from '../../lib/landingStory'
import { type Condition, hours, localeText, pickCase, ruleOf, thresholds } from '../../lib/landingNarrative'

const items: { crop: StoryCrop; condition: Condition; name: string }[] = [
  { crop: 'cabai', condition: 'dry', name: 'Cabai' },
  { crop: 'cabai', condition: 'wet', name: 'Cabai' },
  { crop: 'bawang', condition: 'dry', name: 'Bawang merah' },
  { crop: 'bawang', condition: 'wet', name: 'Bawang merah' },
]
const INNER = { top: 70, bottom: 330, left: 62, right: 258 }

export default function WaterLab() {
  const reduced = useReducedMotion()
  const [active, setActive] = useState(0)
  const cases = useMemo(() => items.map(item => {
    const example = pickCase(item.crop, item.condition)
    const samples = example.data.samples
    return { ...item, ...example, limit: thresholds(example.data), first: samples[0].moisture, last: samples.at(-1)!.moisture, duration: example.data.now_h }
  }), [])
  const item = cases[active]
  const [settled, setSettled] = useState(false)
  const level = useRef<SVGPathElement>(null), readout = useRef<HTMLSpanElement>(null), stream = useRef<SVGRectElement>(null)

  // Pour to the first reading, then let the level follow the scenario to its last reading.
  useEffect(() => {
    setSettled(false)
    const box = { v: 0, amp: 0 }, height = INNER.bottom - INNER.top
    let raf = 0, t = 0
    const draw = () => {
      t += 1 / 60
      const y = INNER.bottom - box.v / 100 * height
      const wave = (x: number) => y + Math.sin(x / 18 + t * 5) * box.amp + Math.sin(x / 7 - t * 3) * box.amp * .4
      let d = `M${INNER.left} ${INNER.bottom} L${INNER.left} ${wave(INNER.left).toFixed(1)}`
      for (let x = INNER.left; x <= INNER.right; x += 6) d += ` L${x} ${wave(x).toFixed(1)}`
      d += ` L${INNER.right} ${INNER.bottom} Z`
      level.current?.setAttribute('d', d)
      if (readout.current) readout.current.textContent = String(Math.round(box.v))
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    const timeline = gsap.timeline({ onComplete: () => setSettled(true) })
    if (reduced) { box.v = item.last; timeline.call(() => setSettled(true)) }
    else timeline
      .set(stream.current, { scaleY: 0, transformOrigin: '50% 0%' })
      .to(stream.current, { scaleY: 1, duration: .25, ease: 'power2.out' }, .45)
      .to(box, { v: item.first, amp: 5, duration: 1.1, ease: 'power1.inOut' }, .5)
      .to(stream.current, { scaleY: 0, transformOrigin: '50% 100%', duration: .25 }, 1.55)
      .to(box, { amp: 1.2, duration: .5 }, 1.6)
      .to(box, { v: item.last, duration: item.last === item.first ? .4 : 1.4, ease: 'power2.inOut' }, 1.9)
      .to(box, { amp: .6, duration: .6 }, 2.2)
    return () => { cancelAnimationFrame(raf); timeline.kill() }
  }, [active, item.first, item.last, reduced])

  const sibling = cases.find(other => other.condition === item.condition && other.crop !== item.crop)!
  const y = (value: number) => INNER.bottom - value / 100 * (INNER.bottom - INNER.top)
  return <section id="lab" className="sa-lab" aria-labelledby="sa-lab-title">
    <div className="sa-lab-menu">
      <h2 id="sa-lab-title">Pilih pot. <em>Lihat alasannya.</em></h2>
      <p className="sa-lab-lead">Pot diisi air, waktu berjalan, lalu Smart Agro memberi saran.</p>
      <div className="sa-lab-list" role="radiogroup" aria-label="Skenario pot">
        {cases.map((option, i) => <button key={`${option.crop}-${option.condition}`} type="button" role="radio" aria-checked={active === i} tabIndex={active === i ? 0 : -1}
          onClick={() => setActive(i)}
          onKeyDown={event => { const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0; if (!step) return; event.preventDefault(); const next = (i + step + cases.length) % cases.length; setActive(next); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus() }}>
          <span className="sa-lab-name">{option.name}</span>
          <span className="sa-lab-sub">{option.condition === 'dry' ? `Cepat mengering · ${option.first} → ${option.last}` : `Basah menetap · ${option.last} selama ${hours(option.duration)}`}</span>
        </button>)}
      </div>
    </div>

    <div className="sa-lab-stage">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={active} className="sa-lab-pot"
          initial={reduced ? { opacity: 0 } : { y: -60, scale: .9, opacity: 0, rotate: -4 }}
          animate={{ y: 0, scale: 1, opacity: 1, rotate: 0, transition: reduced ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 18 } }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { x: 140, y: 120, rotate: 24, opacity: 0, transition: { duration: .45, ease: [.55, 0, .75, .3] } }}>
          <svg viewBox="0 0 320 380" role="img" aria-label={`Pot ${item.name.toLowerCase()}: indeks kelembapan dari ${item.first} ke ${item.last}`}>
            <defs><clipPath id={`sa-lab-inner-${active}`}><path d={`M${INNER.left} ${INNER.top}H${INNER.right}L${INNER.right - 14} ${INNER.bottom}H${INNER.left + 14}Z`} /></clipPath></defs>
            <rect ref={stream} className="sa-lab-stream" x="152" y="0" width="12" height={INNER.top + 10} rx="6" />
            <path className="sa-lab-glass" d={`M${INNER.left - 10} ${INNER.top - 18}H${INNER.right + 10}L${INNER.right - 8} ${INNER.bottom + 14}H${INNER.left + 8}Z`} />
            <g clipPath={`url(#sa-lab-inner-${active})`}>
              <rect className="sa-lab-soil" x="0" y={INNER.top} width="320" height={INNER.bottom - INNER.top} />
              <path ref={level} className="sa-lab-water" d="" />
            </g>
            <path className="sa-lab-limit" d={`M${INNER.left - 18} ${y(item.limit.dry)}H${INNER.right + 18}`} />
            <text className="sa-lab-tick" x={INNER.right + 22} y={y(item.limit.dry) + 4}>kering {item.limit.dry}</text>
            <path className="sa-lab-limit is-wet" d={`M${INNER.left - 18} ${y(item.limit.wet)}H${INNER.right + 18}`} />
            <text className="sa-lab-tick" x={INNER.right + 22} y={y(item.limit.wet) + 4}>basah {item.limit.wet}</text>
          </svg>
        </motion.div>
      </AnimatePresence>
      <div className="sa-lab-readout" aria-hidden="true"><span ref={readout}>0</span><small>/100</small></div>
      <AnimatePresence mode="wait">
        {settled && <motion.div key={active} className="sa-lab-verdict" aria-live="polite"
          initial={{ y: reduced ? 0 : 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, transition: { duration: .12 } }} transition={{ duration: reduced ? 0 : .35 }}>
          <span className="sa-c-label"><i />{ruleOf(item.decision).label}</span>
          <strong>{item.decision.action}</strong>
          <p>{localeText(item.decision.reason)}</p>
          {item.condition === 'dry' && sibling.decision.decision !== item.decision.decision && <p className="sa-lab-compare">Bacaan yang sama pada {sibling.name.toLowerCase()}: {sibling.decision.action.toLowerCase()}.</p>}
        </motion.div>}
      </AnimatePresence>
    </div>
  </section>
}
