import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { charReveal, motionOk, revealHeadings } from './effects'
import { FrameSequence } from './frameSequence'
import PlantArt from './PlantArt'
import { formatNumber, pickCase, solarSizing, thresholds } from '../../../lib/landingNarrative'

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin)

/** Splits a sticky stage into phases by scroll progress; headings marked data-split replay as their phase opens. */
function usePhases(pin: React.RefObject<HTMLDivElement | null>, stage: React.RefObject<HTMLDivElement | null>, phases: number, extra?: (self: ScrollTrigger) => void) {
  useLayoutEffect(() => {
    const host = stage.current!
    const ctx = gsap.context(() => {
      if (!motionOk()) { host.dataset.phase = 'all'; return }
      const titles = Array.from({ length: phases }, (_, i) => Array.from(host.querySelectorAll<HTMLElement>(`.v5-ph-${i} [data-split], [data-split].v5-ph-${i}`)).map(el => charReveal(el)))
      let current = -1
      const set = (next: number) => {
        if (next === current) return
        titles.forEach((list, i) => list.forEach(tl => (i === next ? tl.play() : i > next ? tl.reverse() : null)))
        current = next
        host.dataset.phase = String(next)
      }
      set(0)
      ScrollTrigger.create({
        trigger: pin.current, start: 'top top', end: 'bottom bottom',
        onUpdate: self => { set(Math.min(phases - 1, Math.floor(self.progress * phases))); extra?.(self) },
      })
    }, host)
    return () => ctx.revert()
  }, [pin, stage, phases, extra])
}

/** A frame sequence that follows scroll progress through `pin`; reduced motion shows one still frame. */
function useScrubbedSequence(canvas: React.RefObject<HTMLCanvasElement | null>, pin: React.RefObject<HTMLElement | null>, name: string, count: number, range: [string, string] = ['top top', 'bottom bottom']) {
  useLayoutEffect(() => {
    const sequence = new FrameSequence(canvas.current!, {
      desktop: { dir: `./landing/seq/${name}/d`, count }, mobile: { dir: `./landing/seq/${name}/m`, count },
    })
    const ctx = gsap.context(() => {
      if (!motionOk()) { sequence.load(); sequence.show(count - 1); return }
      const state = { p: 0 }
      gsap.to(state, { p: 1, ease: 'none', onUpdate: () => sequence.seek(state.p), scrollTrigger: { trigger: pin.current, start: range[0], end: range[1], scrub: 1 } })
    })
    return () => { ctx.revert(); sequence.dispose() }
  }, [canvas, pin, name, count, range])
}

/** Muted loop that only plays while it is on screen, and never under reduced motion. */
function useInViewVideo(video: React.RefObject<HTMLVideoElement | null>) {
  useLayoutEffect(() => {
    const el = video.current!
    if (!motionOk()) return
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) el.play().catch(() => {}); else el.pause() }, { rootMargin: '10% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [video])
}

const NUMBERS_RANGE: [string, string] = ['top 75%', 'bottom 60%']

export function Problem() {
  const root = useRef<HTMLElement>(null), pin = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = root.current!
    const ctx = gsap.context(() => {
      if (!motionOk()) { host.dataset.reduced = ''; return }
      host.querySelectorAll('.v5-line').forEach(line => {
        gsap.fromTo(line.querySelector('.v5-inline-img'), { width: 0 }, {
          width: () => (innerWidth < 760 ? 92 : Math.min(300, innerWidth * .2)), ease: 'none',
          scrollTrigger: { trigger: line, start: 'top 88%', end: 'top 42%', scrub: 1, invalidateOnRefresh: true },
        })
      })
      const a = charReveal(host.querySelector<HTMLElement>('.v5-draw-a')!), b = charReveal(host.querySelector<HTMLElement>('.v5-draw-b')!)
      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
        trigger: pin.current, start: 'top top', end: 'bottom bottom', scrub: 1,
        onUpdate: self => { if (self.progress > .08) a.play(); else a.reverse(); if (self.progress > .58) b.play(); else b.reverse() },
      } })
      // Outlines draw first, then leaves and pods fill, veins appear, roots grow, and the dry band rises.
      tl.from('.v5-draw-line', { drawSVG: '0%', duration: .3, stagger: .004 }, 0)
        .from('.v5-draw-fill', { fillOpacity: 0, duration: .12, stagger: .003 }, .24)
        .from('.v5-draw-vein', { drawSVG: '0%', duration: .1, stagger: .0015 }, .34)
        .from('.v5-root-line', { drawSVG: '0%', duration: .2, stagger: .0012 }, .44)
        .fromTo('.v5-dry', { scaleY: 0 }, { scaleY: 1, duration: .2 }, .64)
        .from('.v5-crack', { drawSVG: '0%', duration: .08, stagger: .012 }, .8)
        .from('.v5-zone', { autoAlpha: 0, duration: .06 }, .88)
    }, host)
    return () => ctx.revert()
  }, [])

  return <section ref={root} id="masalah" className="v5-problem" tabIndex={-1} aria-labelledby="v5-problem-title">
    <h2 id="v5-problem-title" className="sa-sr">Permukaan tampak basah, akar bisa sudah haus.</h2>
    <div className="v5-lines" aria-hidden="true">
      <p className="v5-line"><span>Permukaan</span><span className="v5-inline-img"><img src="./landing/potted-chili.webp" alt="" loading="lazy" /></span><span>tampak basah,</span></p>
      <p className="v5-line"><span>akar</span><span className="v5-inline-img"><img src="./landing/seq/rootzone/m/00.avif" alt="" loading="lazy" /></span><span>bisa sudah haus.</span></p>
    </div>
    <div ref={pin} className="v5-pin v5-pin-draw">
      <div className="v5-stage v5-draw">
        <h3 className="v5-draw-a">Dari atas, daunnya masih tegak.</h3>
        <PlantArt />
        <h3 className="v5-draw-b">Di bawah, zona akar mulai <em>mengering.</em></h3>
      </div>
    </div>
  </section>
}

export function Product() {
  const pin = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  useScrubbedSequence(canvas, pin, 'lie', 43)
  usePhases(pin, stage, 3)
  const cards = [
    ['Baca tiap 30 menit', 'Kelembapan, suhu, pH.'],
    ['Saring yang meragukan', 'Bacaan janggal ditahan dulu.'],
    ['Saran dengan alasan', 'Bukan perintah, tapi penjelasan.'],
  ]
  return <section id="kenalan" className="v5-product" tabIndex={-1} aria-labelledby="v5-product-title">
    <div ref={pin} className="v5-pin v5-pin-product">
      <div ref={stage} className="v5-stage v5-tone-sage">
        <div className="v5-seq-box"><canvas ref={canvas} className="v5-seq" role="img" aria-label="Render konsep perangkat Smart Agro yang rebah dan berputar pelan menghadap kamera" /></div>
        <h2 id="v5-product-title" className="v5-ph v5-ph-0 v5-at-tl" data-split>Bagaimana kalau pot bisa memberi tahu sendiri?</h2>
        <div className="v5-ph v5-ph-1 v5-at-tr">
          <h2 data-split>Kenalkan Smart Agro.</h2>
          <p>Sensor kecil bertenaga surya untuk satu pot.</p>
        </div>
        <ul className="v5-ph v5-ph-2 v5-cards">
          {cards.map(([title, body]) => <li key={title}><i aria-hidden="true">×</i><h3>{title}</h3><p>{body}</p></li>)}
        </ul>
      </div>
    </div>
  </section>
}

export function RootZone() {
  const pin = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  useScrubbedSequence(canvas, pin, 'rootzone', 95)
  usePhases(pin, stage, 3)

  return <section id="zona-akar" className="v5-rootzone" aria-labelledby="v5-root-title">
    <div ref={pin} className="v5-pin v5-pin-root">
      <div ref={stage} className="v5-stage v5-tone-cream">
        <div className="v5-seq-box"><canvas ref={canvas} className="v5-seq" role="img" aria-label="Perangkat turun di sisi pot kaca dan kedua kakinya masuk ke tanah sampai zona akar, di samping bibit cabai" /></div>
        <h2 id="v5-root-title" className="v5-at-tl v5-ph v5-ph-0 v5-keep" data-split>Tancapkan di zona akar.</h2>
        <p className="v5-ph v5-ph-1 v5-at-bl">Membaca tanah tempat akar minum.</p>
        <p className="v5-ph v5-ph-2 v5-at-br">Satu bacaan tiap 30 menit.</p>
      </div>
    </div>
  </section>
}

export function Numbers() {
  const root = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  useScrubbedSequence(canvas, root, 'water', 49, NUMBERS_RANGE)
  const limit = thresholds(pickCase('cabai', 'dry').data), solar = solarSizing()
  const items: [string, string, string][] = [
    ['30', 'menit', 'jarak antarbacaan sensor'],
    ['3', 'sensor', 'kelembapan, suhu, dan pH'],
    [String(limit.dry), 'indeks', 'batas kering profil cabai'],
    [formatNumber(solar.dailyEnergyWh), 'Wh', 'kebutuhan energi perangkat per hari'],
  ]
  useLayoutEffect(() => {
    const host = root.current!
    const ctx = gsap.context(() => {
      if (!motionOk()) return
      revealHeadings(host)
      gsap.utils.toArray<HTMLElement>('.v5-num').forEach(el => gsap.from(el, { y: 60, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true } }))
    }, host)
    return () => ctx.revert()
  }, [])
  return <section ref={root} className="v5-numbers" aria-labelledby="v5-numbers-title">
    <div className="v5-numbers-media" aria-hidden="true"><canvas ref={canvas} className="v5-seq" /></div>
    <div className="v5-numbers-list">
      <h2 id="v5-numbers-title" data-split>Angka yang bisa dicek.</h2>
      <dl>
        {items.map(([value, unit, label]) => <div key={label} className="v5-num"><dt>{label}</dt><dd><b>{value}</b>{unit && <span>{unit}</span>}</dd></div>)}
      </dl>
      <p className="v5-foot">Dari mesin aturan yang sama dengan simulator.</p>
    </div>
  </section>
}

export function LeafReveal() {
  const pin = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null)
  useInViewVideo(video)
  useLayoutEffect(() => {
    const host = stage.current!
    const ctx = gsap.context(() => {
      if (!motionOk()) { host.dataset.reduced = ''; return }
      const line = charReveal(host.querySelector<HTMLElement>('.v5-leaf-line')!)
      // The leaf grows, the rest of the frame fades in around it until the garden is the whole background,
      // then the words arrive. Both mask layers are driven through custom properties.
      gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
        trigger: pin.current, start: 'top top', end: 'bottom bottom', scrub: 1,
        onUpdate: self => (self.progress > .68 ? line.play() : line.reverse()),
      } })
        .to('.v5-leaf-row', { xPercent: -26, duration: .6 }, 0)
        .fromTo('.v5-leaf-img', { '--m': '9vmax' }, { '--m': '230vmax', duration: .58, ease: 'power2.in' }, 0)
        .fromTo('.v5-leaf-img', { '--fill': 0 }, { '--fill': 1, duration: .24, ease: 'power1.inOut' }, .36)
        .fromTo('.v5-leaf-img video', { scale: 1.16 }, { scale: 1, duration: .7, ease: 'power1.out' }, 0)
        .to('.v5-leaf-row', { autoAlpha: 0, duration: .14 }, .46)
        .fromTo('.v5-leaf-cap', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: .12 }, .74)
    }, host)
    return () => ctx.revert()
  }, [])
  return <section className="v5-leafreveal" aria-labelledby="v5-leaf-title">
    <div ref={pin} className="v5-pin v5-pin-leaf">
      <div ref={stage} className="v5-stage">
        <div className="v5-leaf-row" aria-hidden="true">{[0, 1, 2].map(i => <span key={i}>Amati. Pahami. Rawat.</span>)}</div>
        <div className="v5-leaf-img" aria-hidden="true">
          <video ref={video} muted playsInline loop preload="none" poster="./landing/video/garden-poster.webp"><source src="./landing/video/garden.mp4" type="video/mp4" /></video>
        </div>
        <h2 id="v5-leaf-title" className="v5-leaf-line">Satu pot, dirawat dengan alasan.</h2>
        <p className="v5-leaf-cap">Profil cabai dan bawang merah, masing-masing dengan batas kering dan basahnya.</p>
      </div>
    </div>
  </section>
}
