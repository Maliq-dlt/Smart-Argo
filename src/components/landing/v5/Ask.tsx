import { simulatorHref } from '../../../lib/appMode'
import { ArrowRight } from '@phosphor-icons/react'
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { gsap } from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'

import { motionOk, revealHeadings } from './effects'
import { ShallotPlant } from './GardenArt'
import { ChiliPlant } from './PlantArt'
import { askEngine, crops, dryShare, localeText, pickCase, ruleOf, thresholds } from '../../../lib/landingNarrative'
import type { StoryCrop } from '../../../lib/landingStory'

/* "Ask the engine": pick a crop, slide the soil moisture, and read the advice and its reason, straight from the
 * simulator's rule engine with that crop's profile. The pot is drawn in PlantArt's 400 × 610 space (soil top at 368). */
const SHALLOT = 1.3 // the garden scene's shallot, scaled to this pot
gsap.registerPlugin(DrawSVGPlugin)

export default function Ask() {
  const root = useRef<HTMLElement>(null), plant = useRef<SVGGElement>(null), firstCrop = useRef(true), slider = useId()
  const [crop, setCrop] = useState<StoryCrop>('cabai'), [moisture, setMoisture] = useState(45)
  const decision = askEngine(crop, moisture), rule = ruleOf(decision), limit = thresholds(pickCase(crop, 'dry').data)
  const name = crops.find(c => c.id === crop)!.name

  useLayoutEffect(() => {
    const host = root.current!
    const ctx = gsap.context(() => { if (motionOk()) revealHeadings(host) }, host)
    return () => ctx.revert()
  }, [])

  // A new crop draws itself into the pot the way the plants draw in the story above: outlines, then fills, then veins.
  useLayoutEffect(() => {
    if (firstCrop.current) { firstCrop.current = false; return }
    if (!motionOk()) return
    const ctx = gsap.context(() => {
      gsap.timeline()
        .from('.v5-draw-line', { drawSVG: '0%', duration: .7, ease: 'power2.out', stagger: { amount: .45 } }, 0)
        .from('.v5-draw-fill', { fillOpacity: 0, duration: .4, stagger: { amount: .35 } }, .3)
        .from('.v5-draw-vein', { drawSVG: '0%', duration: .3, stagger: { amount: .3 } }, .55)
    }, plant)
    return () => ctx.revert()
  }, [crop])

  return <section ref={root} id="tanya" className="v5-ask" tabIndex={-1} aria-labelledby="v5-ask-title">
    <div className="v5-ask-art v5-tone-sage">
      <svg viewBox="0 0 400 610" preserveAspectRatio="xMidYMax meet" role="img" aria-label={`Ilustrasi pot ${name.toLowerCase()} dengan probe di zona akar; lapisan tanah kering di atas menebal saat kelembapan turun`}>
        <defs><clipPath id="v5-ask-soil"><path d="M76 368H324L304 578H96Z" /></clipPath></defs>
        <ellipse className="v5-garden-shadow" cx="200" cy="598" rx="134" ry="8" />
        <path className="v5-garden-pot" d="M62 360H338L314 584Q312 594 302 594H98Q88 594 86 584Z" />
        <path className="v5-garden-soil" d="M76 368H324L304 578H96Z" />
        <rect className="v5-ask-dry" clipPath="url(#v5-ask-soil)" x="70" y="368" width="260" height="212" style={{ transform: `scaleY(${dryShare(moisture)})` }} />
        {/* The device in the 3D model's proportions (deviceModel.ts): body 0.73 wide per unit of height, the lower
            quarter a graphite skirt, solar panel on a flat top, probes 0.8 of the body height, 0.24 of its width apart. */}
        <path className="v5-ask-probe" d="M261 366V428M275 366V428" />
        <g ref={plant} key={crop}>
          {crop === 'cabai'
            ? <ChiliPlant />
            : <g transform={`translate(${200 - 912 * SHALLOT} ${368 - 632 * SHALLOT}) scale(${SHALLOT})`}><ShallotPlant /></g>}
        </g>
        <rect className="v5-garden-rim" x="52" y="342" width="296" height="28" rx="7" />
        <g className="v5-ask-device">
          <path className="v5-ask-shell" d="M251 286H285A12 12 0 0 1 297 298V346A20 20 0 0 1 277 366H259A20 20 0 0 1 239 346V298A12 12 0 0 1 251 286Z" />
          <path className="v5-ask-skirt" d="M239 346H297A20 20 0 0 1 277 366H259A20 20 0 0 1 239 346Z" />
          <rect className="v5-ask-panel-cells" x="251" y="282.5" width="34" height="5" rx="2" />
          <circle className="v5-ask-led-ring" cx="258" cy="306" r="4.2" />
          <circle className="v5-ask-led" cx="258" cy="306" r="2.4" />
        </g>
      </svg>
    </div>
    <div className="v5-ask-panel">
      <h2 id="v5-ask-title" data-split>Tanya mesinnya.</h2>
      <p>Geser kelembapan tanah. Saran dan alasannya datang dari mesin aturan yang sama dengan simulator.</p>
      {/* --i places the sliding thumb under the pressed crop. */}
      <div className="v5-ask-crops" role="group" aria-label="Tanaman" style={{ '--i': crops.findIndex(c => c.id === crop) } as CSSProperties}>
        {crops.map(c => <button key={c.id} type="button" aria-pressed={crop === c.id} onClick={() => setCrop(c.id)}>{c.name}</button>)}
      </div>
      <div className="v5-ask-meter">
        {/* Not <output>: its implicit role is status, and a page keeps one status region. The slider speaks its value. */}
        <label htmlFor={slider}>Kelembapan tanah, stabil tiga jam terakhir <span className="v5-ask-value" aria-hidden="true">{moisture}</span></label>
        <input id={slider} type="range" min={0} max={100} step={1} value={moisture} onChange={event => setMoisture(Number(event.target.value))} />
        <div className="v5-ask-scale" aria-hidden="true">
          <span style={{ left: `${limit.dry}%` }}>kering {limit.dry}</span>
          <span style={{ left: `${limit.wet}%` }}>basah {limit.wet}</span>
        </div>
      </div>
      <div className="v5-ask-answer" data-tone={decision.decision === 'AMATI' ? 'calm' : 'act'} aria-live="polite">
        {/* Keyed by the answer, so a new answer fades in instead of the text swapping in place. */}
        <div key={`${crop} ${decision.action}`} className="v5-ask-answer-body">
          <span className="v5-ask-rule">{rule.label}</span>
          <h3>{decision.action}</h3>
          <p>{localeText(decision.reason)}</p>
          <small>Pemicu: {localeText(rule.criterion)}</small>
        </div>
      </div>
      <div className="v5-ask-actions">
        <a className="sa-btn sa-btn-dark" href={simulatorHref}>Buka simulator<ArrowRight aria-hidden="true" /></a>
        <a className="sa-btn sa-btn-ghost" href="#statistik">Lihat dashboard</a>
      </div>
    </div>
  </section>
}
