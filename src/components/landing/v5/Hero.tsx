import { ArrowDown, ArrowRight } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { charReveal, motionOk, pixelTrail, stairCover, stairGrid } from './effects'
import { whenRevealed } from '../../../lib/curtainSignal'

/** Sticky first screen: the concept device turning on its sage backdrop, a cursor trail, and a block transition that closes it.
 * The turn is a 24 fps video (forward then reversed, so it loops without a seam), which stays smoother than stepping frames. */
export default function Hero({ onExplore }: { onExplore: () => void }) {
  const wrap = useRef<HTMLDivElement>(null), stage = useRef<HTMLElement>(null), trail = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null)
  const [grid] = useState(stairGrid)

  useLayoutEffect(() => {
    const root = wrap.current!, section = stage.current!, clip = video.current!
    const stopTrail = pixelTrail(section, trail.current!, clip)
    // Tell the loading curtain once the first video frame can be shown.
    const ready = () => window.dispatchEvent(new Event('smartagro:ready'))
    if (clip.readyState >= 2) ready(); else clip.addEventListener('loadeddata', ready, { once: true })
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      clip.play().catch(() => {})
      ScrollTrigger.create({ trigger: root, start: 'top bottom', end: 'bottom top', onToggle: self => (self.isActive ? clip.play().catch(() => {}) : clip.pause()) })
      // The entrance waits for the curtain, so it is not spent behind it.
      const word = charReveal(root.querySelector<HTMLElement>('.v5-wordmark')!, .5)
      const corners = gsap.from('.v5-hero-corner', { autoAlpha: 0, y: 14, duration: .9, stagger: .1, ease: 'expo.out', paused: true })
      whenRevealed().then(() => { word.play(); corners.delay(.3).play() })
      gsap.to('.v5-hero-media', { scale: 1.08, ease: 'none', scrollTrigger: { trigger: root, start: 'top top', end: 'bottom top', scrub: true } })
      stairCover(gsap.utils.toArray<HTMLElement>('.v5-hero .v5-stairs i'), grid.cols, grid.rows, root, 'top top', 'bottom bottom')
    }, root)
    return () => { clip.removeEventListener('loadeddata', ready); stopTrail(); ctx.revert() }
  }, [grid])

  return <div ref={wrap} className="v5-hero-wrap">
    <section ref={stage} className="v5-hero sa-hero" aria-labelledby="v5-hero-title">
      <div className="v5-hero-media">
        <video ref={video} muted playsInline loop preload="auto" poster="./landing/video/spin-poster.webp" aria-label="Render konsep perangkat Smart Agro berdiri di atas dua kaki baja dan berputar perlahan">
          <source src="./landing/video/spin-loop.mp4" type="video/mp4" />
        </video>
      </div>
      <canvas ref={trail} className="v5-trail" aria-hidden="true" />
      <p className="v5-wordmark" aria-hidden="true">Smart<br />Agro</p>
      <p className="v5-hero-corner v5-hero-tag">Render konsep perangkat</p>
      <div className="v5-hero-corner v5-hero-copy">
        <h1 id="v5-hero-title">Tahu kapan pot perlu air.</h1>
        <p>Sensor zona akar yang menjelaskan sarannya.</p>
      </div>
      <div className="v5-hero-corner v5-hero-actions">
        <a className="sa-btn sa-btn-dark ag-simulator-link" href="#simulasi">Coba simulator<ArrowRight aria-hidden="true" /></a>
        <button type="button" className="sa-btn sa-btn-ghost" onClick={onExplore}>Lihat ceritanya<ArrowDown aria-hidden="true" /></button>
      </div>
      <div className="v5-stairs" style={{ '--cols': grid.cols, '--rows': grid.rows } as React.CSSProperties} aria-hidden="true">
        {Array.from({ length: grid.cols * grid.rows }, (_, i) => <i key={i} />)}
      </div>
    </section>
  </div>
}
