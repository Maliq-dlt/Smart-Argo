import { simulatorHref } from '../../../lib/appMode'
import { ArrowDown, ArrowRight } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'

import { charReveal, motionOk, pixelTrail, stairCover, stairGrid } from './effects'
import { whenRevealed } from '../../../lib/curtainSignal'
import DeviceSlot from '../../device/DeviceSlot'
import { deviceCanvas } from '../../device/deviceStage'
import { drawLeaves } from '../../device/leafPattern'

/** Sticky first screen: the 3D device turning in its leaf-lit studio, a cursor trail, and a block transition that closes it. */
export default function Hero({ onExplore }: { onExplore: () => void }) {
  const wrap = useRef<HTMLDivElement>(null), stage = useRef<HTMLElement>(null), trail = useRef<HTMLCanvasElement>(null), slot = useRef<HTMLDivElement>(null), shade = useRef<HTMLCanvasElement>(null)
  const [grid] = useState(stairGrid)

  // A few branches of leaf shade, swaying like the foliage in the old Veo backdrop: about 30 fps, only while the hero
  // is on screen; one still frame under reduced motion. Low resolution is enough, the CSS blur softens it.
  useLayoutEffect(() => {
    const leaves = shade.current!, g = leaves.getContext('2d')!
    let raf = 0, last = 0, now = 0
    const paint = (time: number) => { g.clearRect(0, 0, leaves.width, leaves.height); drawLeaves(g, leaves.width, leaves.height, { seed: 23, branches: 3, leaves: 11, blur: false, time }) }
    // Same aspect as the hero, so a phone in portrait does not stretch the leaves into streaks.
    const fit = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      leaves.width = 640; leaves.height = Math.max(1, Math.round(640 * height / Math.max(1, width)))
      paint(now / 1000)
    })
    fit.observe(leaves)
    if (!motionOk()) return () => fit.disconnect()
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick)
      if (time - last < 33) return
      last = now = time
      paint(time / 1000)
    }
    const watch = new IntersectionObserver(([entry]) => { cancelAnimationFrame(raf); if (entry.isIntersecting) raf = requestAnimationFrame(tick) })
    watch.observe(leaves)
    return () => { fit.disconnect(); watch.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  useLayoutEffect(() => {
    const root = wrap.current!, section = stage.current!, place = slot.current!
    const poster = place.querySelector<HTMLImageElement>('.device-poster')!
    const stopTrail = pixelTrail(section, trail.current!, () => deviceCanvas() ?? poster)
    // Tell the loading curtain once the device or its poster can be shown, whichever is first; never hold it past 2.5 s.
    let sent = false
    const ready = () => { if (!sent) { sent = true; window.dispatchEvent(new Event('smartagro:ready')) } }
    const timer = window.setTimeout(ready, 2500)
    place.addEventListener('device:ready', ready, { once: true })
    if (poster.complete && poster.naturalWidth) ready(); else poster.addEventListener('load', ready, { once: true })
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      // The entrance waits for the curtain, so it is not spent behind it.
      const word = charReveal(root.querySelector<HTMLElement>('.v5-wordmark')!, .5)
      const corners = gsap.from('.v5-hero-corner', { autoAlpha: 0, y: 14, duration: .9, stagger: .1, ease: 'expo.out', paused: true })
      whenRevealed().then(() => { word.play(); corners.delay(.3).play() })
      gsap.to('.v5-hero-media', { scale: 1.08, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
      stairCover(gsap.utils.toArray<HTMLElement>('.v5-hero .v5-stairs i'), grid.cols, grid.rows, root, 'top top', 'bottom bottom')
    }, root)
    return () => { clearTimeout(timer); place.removeEventListener('device:ready', ready); poster.removeEventListener('load', ready); stopTrail(); ctx.revert() }
  }, [grid])

  return <div ref={wrap} className="v5-hero-wrap">
    <section ref={stage} className="v5-hero sa-hero" aria-labelledby="v5-hero-title">
      <canvas ref={shade} className="v5-leaf-shade" aria-hidden="true" />
      <div className="v5-hero-media">
        <DeviceSlot slotRef={slot} mode="studio" studio />
      </div>
      <canvas ref={trail} className="v5-trail" aria-hidden="true" />
      <p className="v5-wordmark" aria-hidden="true">Smart<br />Agro</p>
      <p className="v5-hero-corner v5-hero-tag">Render konsep perangkat</p>
      <div className="v5-hero-corner v5-hero-copy">
        <h1 id="v5-hero-title">Tahu kapan pot perlu air.</h1>
        <p>Sensor zona akar yang menjelaskan sarannya.</p>
      </div>
      <div className="v5-hero-corner v5-hero-actions">
        <a className="sa-btn sa-btn-dark ag-simulator-link" href={simulatorHref}>Coba simulator<ArrowRight aria-hidden="true" /></a>
        <button type="button" className="sa-btn sa-btn-ghost" onClick={onExplore}>Lihat ceritanya<ArrowDown aria-hidden="true" /></button>
      </div>
      <div className="v5-stairs" style={{ '--cols': grid.cols, '--rows': grid.rows } as React.CSSProperties} aria-hidden="true">
        {Array.from({ length: grid.cols * grid.rows }, (_, i) => <i key={i} />)}
      </div>
    </section>
  </div>
}
