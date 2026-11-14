import { ArrowCounterClockwise, Drop } from '@phosphor-icons/react'
import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import type { SplitText } from 'gsap/SplitText'
import type { AnimationItem } from 'lottie-web'

import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { charReveal, motionOk } from './effects'
import { GROW_STAGES, GROW_START_FRAME } from './growStages'

/* Each click plays one stretch of the growth clip (a vector Lottie, sharp at any zoom), as the "Add more water"
 * button on the Farm Minerals promo does. Stage ends sit where the plant visibly changes. */
const stages = GROW_STAGES
const frameAt = (step: number) => (step === 0 ? GROW_START_FRAME : stages[step - 1].frame)

export default function Grow() {
  const root = useRef<HTMLElement>(null), art = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null)
  const clip = useRef<AnimationItem | null>(null), titleTl = useRef<gsap.core.Timeline | null>(null)
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false)
  // The clip may finish loading after a click, so it reads the step from here, not from a stale render.
  const stepNow = useRef(0)
  const scope = useRef<gsap.Context | null>(null)
  const goTo = (next: number) => { stepNow.current = next; setStep(next) }
  const done = step === stages.length

  useLayoutEffect(() => {
    const host = art.current!
    let item: AnimationItem | null = null, gone = false
    // The player and the clip load only as the section comes near.
    const near = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      near.disconnect()
      import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
        if (gone) return
        item = lottie.loadAnimation({ container: host, renderer: 'svg', autoplay: false, loop: false, path: './landing/lottie/grow.json', rendererSettings: { preserveAspectRatio: 'xMidYMax meet' } })
        item.setSpeed(0.6)
        item.addEventListener('DOMLoaded', () => item?.goToAndStop(frameAt(stepNow.current), true))
        clip.current = item
      })
    }, { rootMargin: '50% 0px' })
    near.observe(host)
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      titleTl.current = charReveal(title.current!)
      ScrollTrigger.create({ trigger: title.current, start: 'top 90%', once: true, onEnter: () => titleTl.current?.play() })
    }, root)
    scope.current = ctx
    return () => { gone = true; near.disconnect(); scope.current = null; ctx.revert(); item?.destroy(); clip.current = null }
  }, [])

  const swapTitle = (text: string) => {
    const el = title.current!, ctx = scope.current
    if (!motionOk() || !ctx) { el.textContent = text; return }
    // Both steps join the section's context, so leaving the page mid-swap reverts them instead of letting the
    // callback split and animate a heading that is no longer mounted.
    ctx.add(() => gsap.to(el, { autoAlpha: 0, duration: .35, onComplete: () => ctx.add(() => {
      const old = titleTl.current
      ;(old?.data as SplitText | undefined)?.revert(); old?.kill()
      el.textContent = text; gsap.set(el, { autoAlpha: 1 })
      titleTl.current = charReveal(el); titleTl.current.play()
    }) }))
  }

  const water = () => {
    if (busy || done) return
    const next = step + 1, item = clip.current
    goTo(next)
    const finish = () => { if (next === stages.length) swapTitle('Begitulah hasilnya saat airnya pas.') }
    if (!item?.isLoaded || !motionOk()) { item?.goToAndStop(frameAt(next), true); finish(); return }
    setBusy(true)
    const off = item.addEventListener('complete', () => { off(); setBusy(false); finish() })
    item.playSegments([frameAt(step), frameAt(next)], true)
  }

  const reset = () => {
    clip.current?.goToAndStop(GROW_START_FRAME, true)
    goTo(0)
    swapTitle('Rawat, lalu lihat hasilnya.')
  }

  return <section ref={root} id="rawat" className="v5-grow v5-tone-sage" tabIndex={-1} aria-labelledby="v5-grow-title">
    <div ref={art} className="v5-grow-art" role="img" aria-label={`Ilustrasi tanaman di pot terakota, tahap ${done ? 'berbunga' : step === 0 ? 'tunas' : stages[step - 1].label}`} />
    <div className="v5-grow-copy">
      <h2 ref={title} id="v5-grow-title">Rawat, lalu lihat hasilnya.</h2>
      <p>Klik untuk memajukan waktu.</p>
    </div>
    <div className="v5-grow-ctrl">
      <div className="v5-drops" aria-hidden="true">{stages.map((s, i) => <i key={s.label} className={i < step ? 'is-full' : ''} />)}</div>
      <p className="v5-grow-stage" aria-live="polite">{step === 0 ? 'Tunas' : stages[step - 1].label}</p>
      {done
        ? <button type="button" className="sa-btn sa-btn-ghost" onClick={reset}><ArrowCounterClockwise aria-hidden="true" />Ulangi</button>
        : <button type="button" className="sa-btn sa-btn-dark" onClick={water} aria-disabled={busy}><Drop aria-hidden="true" />Siram sesuai saran</button>}
      <small>Ilustrasi pertumbuhan, bukan data sensor.</small>
    </div>
  </section>
}
