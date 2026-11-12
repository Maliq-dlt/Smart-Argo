import { useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import type { SplitText } from 'gsap/SplitText'
import { Droplet, RotateCcw } from 'lucide-react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { charReveal, motionOk } from './effects'
import { FrameSequence } from './frameSequence'

/* Each click plays one stretch of the growth clip (96 frames, one continuous 16 s shot), as the
 * "Add more water" button on the Farm Minerals promo does. Stage ends sit where the plant visibly changes. */
const stages = [
  { label: 'Minggu 1', to: 30 },
  { label: 'Minggu 3', to: 55 },
  { label: 'Minggu 5', to: 76 },
  { label: 'Berbunga', to: 95 },
]

export default function Grow() {
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null), title = useRef<HTMLHeadingElement>(null)
  const seq = useRef<FrameSequence | null>(null), titleTl = useRef<gsap.core.Timeline | null>(null)
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false)
  const done = step === stages.length

  useLayoutEffect(() => {
    const sequence = new FrameSequence(canvas.current!, {
      desktop: { dir: './landing/seq/grow/d', count: 96 }, mobile: { dir: './landing/seq/grow/m', count: 96 },
    })
    seq.current = sequence
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      titleTl.current = charReveal(title.current!)
      ScrollTrigger.create({ trigger: title.current, start: 'top 90%', once: true, onEnter: () => titleTl.current?.play() })
    }, root)
    return () => { ctx.revert(); sequence.dispose() }
  }, [])

  const swapTitle = (text: string) => {
    const el = title.current!
    if (!motionOk()) { el.textContent = text; return }
    gsap.to(el, { autoAlpha: 0, duration: .35, onComplete: () => {
      const old = titleTl.current
      ;(old?.data as SplitText | undefined)?.revert(); old?.kill()
      el.textContent = text; gsap.set(el, { autoAlpha: 1 })
      titleTl.current = charReveal(el); titleTl.current.play()
    } })
  }

  const water = () => {
    const sequence = seq.current
    if (!sequence || busy || done) return
    const stage = stages[step], next = step + 1
    setStep(next)
    if (!motionOk()) { sequence.show(stage.to); if (next === stages.length) swapTitle('Begitulah hasilnya saat airnya pas.'); return }
    setBusy(true)
    const tl = gsap.timeline({ onComplete: () => { setBusy(false); if (next === stages.length) swapTitle('Begitulah hasilnya saat airnya pas.') } })
    const play = { f: sequence.index }
    tl.to(play, { f: stage.to, duration: 1.4, ease: 'power1.inOut', onUpdate: () => sequence.show(play.f) })
  }

  const reset = () => {
    seq.current?.show(0)
    setStep(0)
    swapTitle('Rawat, lalu lihat hasilnya.')
  }

  return <section ref={root} id="rawat" className="v5-grow v5-tone-sage" tabIndex={-1} aria-labelledby="v5-grow-title">
    <canvas ref={canvas} className="v5-seq v5-grow-canvas" role="img" aria-label={`Ilustrasi tanaman cabai di pot terakota, tahap ${done ? 'berbunga' : step === 0 ? 'tunas' : stages[step - 1].label}`} />
    <div className="v5-grow-copy">
      <h2 ref={title} id="v5-grow-title">Rawat, lalu lihat hasilnya.</h2>
      <p>Klik untuk memajukan waktu.</p>
    </div>
    <div className="v5-grow-ctrl">
      <div className="v5-drops" aria-hidden="true">{stages.map((s, i) => <i key={s.label} className={i < step ? 'is-full' : ''} />)}</div>
      <p className="v5-grow-stage" aria-live="polite">{step === 0 ? 'Tunas' : stages[step - 1].label}</p>
      {done
        ? <button type="button" className="sa-btn sa-btn-ghost" onClick={reset}><RotateCcw aria-hidden="true" />Ulangi</button>
        : <button type="button" className="sa-btn sa-btn-dark" onClick={water} aria-disabled={busy}><Droplet aria-hidden="true" />Siram sesuai saran</button>}
      <small>Ilustrasi pertumbuhan, bukan data sensor.</small>
    </div>
  </section>
}
