// Hero motion adapted from "Sneaker Product Page Hero" by kedhareswer on 21st.dev
// (https://21st.dev/@kedhareswer/components/sneaker-product-hero), retrieved 12 Nov 2026:
// the variant swap (the plant on show lifts out through the top while the next rises in, the giant
// pointer tilt with a following floor shadow,
// the idle float and the rolled numbers. The callouts pinned to the plant follow the Verdio
// "Plant Health" layout seen on Dribbble. Values come from the rule engine's built-in scenarios.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ArrowDown, ArrowRight } from 'lucide-react'
import type { StoryCrop } from '../../lib/landingStory'
import { decisionsOverTime, hours, pickCase, thresholds } from '../../lib/landingNarrative'

const plants: { id: StoryCrop; name: string; tint: string; src: string }[] = [
  { id: 'cabai', name: 'Cabai', tint: '#dbe6c8', src: './plants/cabai.webp' },
  { id: 'bawang', name: 'Bawang merah', tint: '#e8e1cb', src: './plants/bawang.webp' },
]
// Points on the plant photographs (both framed alike), as % of the stage box.
const anchors = { soil: [52, 63] } as const
const STEP_MS = 1700

const reducedNow = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function HeroPlant({ onExplore }: { onExplore: () => void }) {
  const [active, setActive] = useState(0)
  const [tick, setTick] = useState(0)
  const crop = plants[active]
  const data = useMemo(() => plants.map(plant => {
    const { data } = pickCase(plant.id, 'dry')
    return { data, steps: decisionsOverTime(data), limit: thresholds(data) }
  }), [])
  const current = data[active], samples = current.data.samples
  const index = Math.min(tick, samples.length - 1)
  const sample = samples[index], verdict = current.steps[index]

  const root = useRef<HTMLElement>(null), tilt = useRef<HTMLDivElement>(null), float = useRef<HTMLDivElement>(null)
  const floor = useRef<HTMLSpanElement>(null)
  const plantEls = useRef<(HTMLImageElement | null)[]>([])
  const shown = useRef(0)

  // Simulated telemetry: one reading every STEP_MS, holding on the last reading before it starts again.
  useEffect(() => {
    if (reducedNow()) { setTick(samples.length - 1); return }
    const wait = index >= samples.length - 1 ? STEP_MS * 3 : STEP_MS
    const id = window.setTimeout(() => setTick(value => value >= samples.length - 1 ? 0 : value + 1), wait)
    return () => window.clearTimeout(id)
  }, [index, samples.length])

  useLayoutEffect(() => {
    plantEls.current.forEach((el, i) => el && gsap.set(el, { autoAlpha: i === shown.current ? 1 : 0, yPercent: 0, rotation: 0 }))
    if (reducedNow() || !root.current) return
    const ctx = gsap.context(() => {
      const intro = gsap.timeline({ defaults: { ease: 'expo.out' } })
      intro.from('.sa-hero-line > span', { yPercent: 110, duration: 1.1, stagger: .08 }, .1)
        .from('.sa-hero-copy > p, .sa-hero-actions', { y: 24, autoAlpha: 0, duration: .9, stagger: .08 }, .35)
        .from(float.current, { yPercent: 14, scale: .9, autoAlpha: 0, duration: 1.4 }, .2)
        .from('.sa-callout', { y: 16, autoAlpha: 0, scale: .94, duration: .8, stagger: .1 }, .8)
        .from('.sa-leader', { strokeDashoffset: 1, duration: .9, stagger: .1, ease: 'power2.out' }, .9)
        .from('.sa-switch', { y: 16, autoAlpha: 0, duration: .9 }, .9)
    }, root)
    return () => ctx.revert()
  }, [])

  // A slow float while the hero is on screen.
  useEffect(() => {
    if (reducedNow() || !float.current || !root.current) return
    const loop = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration: 2.8, ease: 'sine.inOut' } })
    loop.to(float.current, { y: -14 }, 0).to(floor.current, { scaleX: .86, opacity: .55 }, 0)
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting ? loop.resume() : loop.pause())
    io.observe(root.current)
    return () => { io.disconnect(); loop.kill() }
  }, [])

  // The plant leans towards a fine pointer; the light and the shadow follow.
  useEffect(() => {
    const el = root.current
    if (!el || !tilt.current || reducedNow() || !window.matchMedia('(pointer: fine)').matches) return
    gsap.set(tilt.current, { transformPerspective: 1100 })
    const ry = gsap.quickTo(tilt.current, 'rotationY', { duration: .8, ease: 'power3.out' })
    const rx = gsap.quickTo(tilt.current, 'rotationX', { duration: .8, ease: 'power3.out' })
    const fx = gsap.quickTo(floor.current, 'x', { duration: .9, ease: 'power3.out' })
    const glow = { x: 50, y: 40 }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
      const box = el.getBoundingClientRect()
      const nx = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1))
      const ny = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1))
      ry(nx * 10); rx(-ny * 6); fx(-nx * 16)
      gsap.to(glow, { x: 50 + nx * 18, y: 40 + ny * 14, duration: 1, ease: 'power3.out', overwrite: true,
        onUpdate: () => { el.style.setProperty('--mx', `${glow.x}%`); el.style.setProperty('--my', `${glow.y}%`) } })
    }
    const leave = () => { ry(0); rx(0); fx(0) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); gsap.killTweensOf(glow) }
  }, [])


  function pick(next: number) {
    const prev = shown.current
    if (next === prev) return
    shown.current = next
    setActive(next); setTick(0)
    const p = plantEls.current
    p.forEach((el, i) => { if (el) { gsap.killTweensOf(el); if (i !== prev && i !== next) gsap.set(el, { autoAlpha: 0 }) } })
    if (reducedNow()) {
      gsap.set(p[prev], { autoAlpha: 0 }); gsap.set(p[next], { autoAlpha: 1, yPercent: 0, rotation: 0 })
      return
    }
    gsap.to(p[prev], { yPercent: -120, rotation: -7, autoAlpha: 0, duration: .45, ease: 'power2.in' })
    gsap.fromTo(p[next], { yPercent: 120, rotation: 9, autoAlpha: 0 }, { yPercent: 0, rotation: 0, autoAlpha: 1, duration: .75, ease: 'back.out(1.3)', delay: .06 })
  }

  const meter = Math.max(0, Math.min(100, sample.moisture))
  return <section ref={root} className="sa-hero" style={{ '--tint': crop.tint } as React.CSSProperties} aria-labelledby="sa-title">
    <div className="sa-hero-copy">
      <h1 id="sa-title"><span className="sa-hero-line"><span>Tahu kapan pot</span></span>{' '}<span className="sa-hero-line"><span><em>perlu air.</em></span></span></h1>
      <p>Sensor tanah yang membaca zona akar, lalu menjelaskan kapan pot perlu diperiksa.</p>
      <div className="sa-hero-actions">
        <a className="sa-btn sa-btn-dark ag-simulator-link" href="#simulasi">Coba simulator <ArrowRight aria-hidden="true" /></a>
        <button type="button" className="sa-btn sa-btn-ghost" onClick={onExplore}>Ikuti satu pot <ArrowDown aria-hidden="true" /></button>
      </div>
    </div>

    <div className="sa-hero-visual">
      <div className="sa-stage" aria-label={`${crop.name}, simulasi: kelembapan ${sample.moisture} dari 100. Saran: ${verdict.action}.`} role="img">
        <div ref={float} className="sa-float">
          <div ref={tilt} className="sa-tilt">
            {plants.map((plant, i) => <img key={plant.id} ref={el => { plantEls.current[i] = el }} src={plant.src} alt="" width="800" height="1100" draggable={false} />)}
          </div>
        </div>
        <span ref={floor} className="sa-floor" aria-hidden="true" />
        <svg className="sa-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="sa-leader" pathLength={1} d={`M30 40 L${anchors.soil[0]} ${anchors.soil[1]}`} />
        </svg>
        <span className="sa-dot" style={{ left: `${anchors.soil[0]}%`, top: `${anchors.soil[1]}%` }} aria-hidden="true" />
        <div className="sa-callout sa-c-moist" aria-hidden="true">
          <span className="sa-c-label">Kelembapan tanah</span>
          <strong><Roll value={sample.moisture} /><small>/100</small></strong>
          <span className="sa-meter"><i style={{ width: `${meter}%` }} /><b style={{ left: `${current.limit.dry}%` }} /></span>
        </div>
        <div className={`sa-callout sa-c-verdict${verdict.decision === 'AMATI' ? '' : ' is-alert'}`} aria-hidden="true">
          <span className="sa-c-label"><i />{sample.t_h === 0 ? 'Baru disiram' : `${hours(sample.t_h)} kemudian`}</span>
          <span key={verdict.decision} className="sa-c-action">{verdict.action}</span>
        </div>
      </div>
      <div className="sa-switch" role="radiogroup" aria-label="Tanaman">
        {plants.map((plant, i) => <button key={plant.id} type="button" role="radio" aria-checked={active === i} onClick={() => pick(i)}
          onKeyDown={event => { if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const next = (i + 1) % plants.length; pick(next); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus() } }}
          tabIndex={active === i ? 0 : -1}>
          <img src={plant.src} alt="" width="64" height="88" /><span>{plant.name}</span>
        </button>)}
      </div>
    </div>
  </section>
}

/** A number that rolls to its new value, from the reference's price counter. */
function Roll({ value }: { value: number }) {
  // React renders the first value only; GSAP owns the text afterwards.
  const ref = useRef<HTMLSpanElement>(null), last = useRef(value), first = useRef(value)
  useEffect(() => {
    const el = ref.current, from = last.current
    last.current = value
    if (!el || from === value || reducedNow()) { if (el) el.textContent = String(value); return }
    const box = { v: from }
    const tween = gsap.to(box, { v: value, duration: .7, ease: 'power2.out', onUpdate: () => { el.textContent = String(Math.round(box.v)) } })
    gsap.fromTo(el, { y: value < from ? -6 : 6, opacity: .4 }, { y: 0, opacity: 1, duration: .45, ease: 'power2.out' })
    return () => { tween.kill() }
  }, [value])
  return <span ref={ref} className="sa-roll">{first.current}</span>
}
