import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Check, LockKeyhole } from 'lucide-react'
import { storyExamples, storyPlants, trendPath } from '../lib/landingStory'
import './landing.css'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)
const chapters = ['Kenali', 'Ritme', 'Amati', 'Pahami', 'Coba']
const anchors = ['kenali', 'ritme', 'amati', 'pahami', 'coba']
const format = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 })
const plantImage = (crop: string) => `./plants/${crop}.webp`

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null), actor = useRef<HTMLDivElement>(null)
  const scrollTween = useRef<gsap.core.Tween | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const reduced = useReducedMotion()
  const [choice, setChoice] = useState(0), [locked, setLocked] = useState(false)
  const [chapter, setChapter] = useState(0), [sample, setSample] = useState(5)
  const [wet, setWet] = useState(true)
  const [answer, setAnswer] = useState<'water' | 'check' | null>(null)
  const plant = storyPlants[choice]
  const [dry, saturated] = storyExamples(plant.id)
  const current = dry.data.samples[sample]
  const observed = wet ? saturated : dry

  const goTo = useCallback((id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    scrollTween.current?.kill()
    target.focus({ preventScroll: true })
    if (reduced) target.scrollIntoView({ behavior: 'instant' })
    else scrollTween.current = gsap.to(window, { scrollTo: { y: target, autoKill: true }, duration: 1, ease: 'power2.inOut' })
  }, [reduced])

  useEffect(() => {
    if (locked) goTo('ritme')
    return () => { scrollTween.current?.kill() }
  }, [locked, goTo])

  useEffect(() => {
    if (!locked) return
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setChapter(anchors.indexOf(entry.target.id))
    }, { rootMargin: '-40% 0px -40% 0px' })
    root.current?.querySelectorAll('.ag-scene').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [locked])

  useLayoutEffect(() => {
    if (!root.current || !actor.current || reduced) return
    const media = gsap.matchMedia()
    media.add({ wide: '(min-width: 901px)', narrow: '(max-width: 900px)' }, context => {
      const wide = context.conditions?.wide
      if (!locked) {
        gsap.fromTo(actor.current, { rotation: -14, xPercent: -75, yPercent: -50, x: wide ? -window.innerWidth * .28 : 0, y: wide ? 0 : -window.innerHeight * .26, scale: wide ? 1 : .60, opacity: 0 }, { rotation: 0, xPercent: -50, opacity: 1, duration: 1.1, ease: 'power3.out' })
        return
      }
      // ponytail: photographic depth supports directed framing; use a 3D asset for unrestricted camera orbit.
      const timeline = gsap.timeline({ paused: true })
      const sections = gsap.utils.toArray<HTMLElement>('.ag-scene', root.current)
      const stage = root.current!.querySelector('.ag-stage')
      const ribbon = root.current!.querySelector('.ag-ribbon')
      const word = root.current!.querySelector('.ag-exhibit-word')
      const frame = root.current!.querySelector('.ag-focus-detail')
      const build = () => {
        timeline.clear()
        const width = root.current!.clientWidth, height = window.innerHeight
        const start = sections[0].offsetTop
        const total = root.current!.querySelector('.ag-scenes')!.scrollHeight - height
        const poses = wide ? [
          { x: -width * .28, y: 0, scale: 1, rotation: 0, rotationY: 0, rotationX: 0 },
          { x: 0, y: height * .02, scale: 1.12, rotation: -3, rotationY: 13, rotationX: 3 },
          { x: width * .30, y: height * .25, scale: 2.05, rotation: -9, rotationY: -16, rotationX: -3 },
          { x: -width * .28, y: -height * .35, scale: 1.72, rotation: 7, rotationY: 14, rotationX: 6 },
          { x: -width * .02, y: -height * .02, scale: .94, rotation: -2, rotationY: -5, rotationX: 0 },
        ] : [
          { x: 0, y: -height * .26, scale: .60, rotation: 0, rotationY: 0, rotationX: 0 },
          { x: 0, y: height * .08, scale: .92, rotation: -3, rotationY: 12, rotationX: 3 },
          { x: width * .24, y: -height * .34, scale: 1.18, rotation: -9, rotationY: -13, rotationX: -3 },
          { x: -width * .18, y: -height * .52, scale: 1.22, rotation: 6, rotationY: 12, rotationX: 6 },
          { x: 0, y: -height * .26, scale: .60, rotation: -2, rotationY: -4, rotationX: 0 },
        ]
        timeline.set(actor.current, { ...poses[0], xPercent: -50, yPercent: -50 }, 0)
        timeline.set(word, { autoAlpha: 0, scale: .9 }, 0)
        timeline.set(frame, { autoAlpha: 0 }, 0)
        timeline.set(stage, { backgroundColor: '#f4f3ea' }, 0)
        timeline.set(ribbon, { opacity: .85, rotation: -27 }, 0)
        sections.slice(1).forEach((section, offset) => {
          const index = offset + 1
          const at = Math.max(0, section.offsetTop - start - height * .65)
          const duration = height * .82
          timeline.to(actor.current, { ...poses[index], duration, ease: 'power2.inOut' }, at)
          if (index === 1) {
            timeline.to(word, { autoAlpha: .8, scale: 1, duration: height * .45, ease: 'power2.out' }, at + height * .35)
            timeline.to(ribbon, { opacity: .35, rotation: 9, duration, ease: 'power2.inOut' }, at)
          } else if (index === 2) {
            timeline.to(word, { autoAlpha: 0, scale: 1.18, duration: height * .35 }, at)
            timeline.to(ribbon, { opacity: .10, rotation: -8, duration }, at)
          } else if (index === 3) {
            timeline.to(stage, { backgroundColor: '#c7d0b6', duration, ease: 'power1.inOut' }, at)
            timeline.to(frame, { autoAlpha: 1, duration: height * .3 }, at + height * .65)
          } else {
            timeline.to(frame, { autoAlpha: 0, duration: height * .2 }, at)
            timeline.to(stage, { backgroundColor: '#f4f3ea', duration, ease: 'power1.inOut' }, at)
            timeline.to(ribbon, { opacity: .32, rotation: -32, duration }, at)
          }
        })
        if (timeline.duration() < total) timeline.to({}, { duration: total - timeline.duration() })
      }
      build()
      ScrollTrigger.create({ trigger: '.ag-scenes', start: 'top top', end: 'bottom bottom', animation: timeline, scrub: .85,
        invalidateOnRefresh: true, onRefreshInit: build })
    }, root)
    const resize = new ResizeObserver(() => ScrollTrigger.refresh())
    resize.observe(root.current)
    return () => { resize.disconnect(); media.revert() }
  }, [choice, locked, reduced])

  function choose(index: number) {
    if (locked) return
    setChoice((index + storyPlants.length) % storyPlants.length); setAnswer(null)
  }
  function unlock() {
    scrollTween.current?.kill(); window.scrollTo({ top: 0, behavior: 'instant' })
    setLocked(false); setChapter(0); setSample(5); setAnswer(null)
    requestAnimationFrame(() => document.getElementById(`choose-${plant.id}`)?.focus({ preventScroll: true }))
  }

  return <div ref={root} className={`ag-landing${locked ? ' ag-locked' : ''}${reduced ? ' ag-reduced' : ''}`} data-crop={plant.id} data-chapter={chapter}>
    <a className="ag-skip" href="#landing-main">Lewati navigasi</a>
    <header className="ag-header">
      <a href="#kenali" className="ag-wordmark" aria-label="Smart Agro · Beranda" onClick={event => { event.preventDefault(); goTo('kenali') }}>smart agro<span aria-hidden="true">✳</span></a>
      <span className="ag-header-note">Sedikit lebih dekat dengan tanamanmu.</span>
      <div className="ag-header-actions">{locked && <button className="ag-text-button" onClick={unlock}>Ganti tanaman <ArrowUpRight aria-hidden="true" /></button>}<a className="ag-simulator-link" href="#simulasi">Buka simulator <ArrowUpRight aria-hidden="true" /></a></div>
    </header>
    <main id="landing-main" tabIndex={-1} className="ag-main">
      <div className="ag-stage" aria-hidden="true"><div className="ag-ribbon" /><span className="ag-exhibit-word">{plant.name}.</span><div className="ag-focus-detail"><span /><p>Permukaan media</p></div><div ref={actor} className="ag-specimen" data-specimen={plant.id}><img src={plantImage(plant.id)} alt="" width="800" height="1100" draggable={false} /></div></div>
      <div className="ag-scenes">
        <section id="kenali" tabIndex={-1} className="ag-scene ag-cover" aria-labelledby="ag-title"
          onPointerDown={event => { if (!locked && !(event.target as Element).closest('a,button')) swipe.current = { x: event.clientX, y: event.clientY } }} onPointerCancel={() => { swipe.current = null }}
          onPointerUp={event => { const start = swipe.current; swipe.current = null; if (start && Math.abs(event.clientX - start.x) > 50 && Math.abs(event.clientX - start.x) > Math.abs(event.clientY - start.y) * 1.4) choose(choice + (event.clientX < start.x ? 1 : -1)) }}>
          <div className="ag-cover-copy"><span className="ag-caption">{plant.latin}</span>
            <AnimatePresence mode="wait" initial={false}><motion.h1 id="ag-title" key={plant.id} initial={{ opacity: 0, x: reduced ? 0 : 25 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -25 }} transition={{ duration: reduced ? 0 : .25 }}><span>Kenali</span><strong>{plant.name}.</strong></motion.h1></AnimatePresence>
            <button className="ag-primary" onClick={() => locked ? goTo('ritme') : setLocked(true)}>{locked ? 'Lanjutkan cerita' : 'Kenali tanaman ini'} <ArrowUpRight aria-hidden="true" /></button>
          </div>
          <aside className="ag-cover-aside" aria-live="polite"><p>Setiap tanaman<br />punya ritme.</p><p>{plant.description}</p><span className="ag-caption">Pilih satu. Ikuti ceritanya.</span></aside>
          <div className="ag-chooser" role="region" aria-roledescription="carousel" aria-label="Pilihan tanaman"
            onKeyDown={event => { if (!locked && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = (choice + 1) % 2; choose(next); document.getElementById(`choose-${storyPlants[next].id}`)?.focus() } }}>
            {locked ? <p className="ag-locked-note"><LockKeyhole aria-hidden="true" /> {plant.name} dipilih <span>Scroll untuk mengikuti ceritanya</span><ArrowDown aria-hidden="true" /></p> : <>
              <button className="ag-arrow" aria-label="Tanaman sebelumnya" onClick={() => choose(choice - 1)}><ArrowLeft aria-hidden="true" /></button>
              {storyPlants.map((item, index) => <button id={`choose-${item.id}`} key={item.id} aria-pressed={choice === index} className="ag-plant-choice" onClick={() => choose(index)}><img src={plantImage(item.id)} alt="" width="64" height="76" draggable={false} /><span>{item.name}</span></button>)}
              <button className="ag-arrow" aria-label="Tanaman berikutnya" onClick={() => choose(choice + 1)}><ArrowRight aria-hidden="true" /></button>
            </>}
          </div><span className="ag-cover-index">0{choice + 1} / 02</span><span className="ag-cover-footnote">Sebuah eksplorasi Smart Agro</span>
        </section>
        {locked && <>
          <section id="ritme" tabIndex={-1} className="ag-scene ag-introduction" aria-labelledby="ag-ritme-title">
            <img className="ag-still" src={plantImage(plant.id)} alt={`Spesimen ${plant.name.toLowerCase()} utuh`} width="800" height="1100" />
            <div className="ag-intro-heading"><span className="ag-caption">01 / Kenali ritmenya</span><h2 id="ag-ritme-title">Satu tanaman.<br />Banyak yang<br />bisa dibaca.</h2></div>
            <aside className="ag-intro-note"><span className="ag-caption">{plant.latin}</span><p>{plant.id === 'cabai' ? 'Dari ujung daun sampai media tanam. Setiap bagian punya ceritanya.' : 'Daunnya menjulang, umbinya tumbuh di dekat media. Mulai dengan melihatnya utuh.'}</p><span>Scroll untuk melihat lebih dekat <ArrowDown aria-hidden="true" /></span></aside>
          </section>
          <section id="amati" tabIndex={-1} className="ag-scene ag-observe" aria-labelledby="ag-observe-title">
            <img className="ag-still" src={plantImage(plant.id)} alt={`Spesimen ${plant.name.toLowerCase()} dalam pot tanah liat`} width="800" height="1100" />
            <div className="ag-scene-copy"><span className="ag-caption">02 / Amati · {plant.name}</span><h2 id="ag-observe-title">Kelihatan sama.<br /><span>Kondisinya berubah.</span></h2><p>Daun hanya sebagian cerita. Coba baca perubahan pada media tanamnya.</p>
              <div className="ag-observation"><div><output htmlFor="ag-time">{current.moisture}</output><span>Indeks kelembapan / 100</span><span>{format(current.t_h)} jam pengamatan</span></div>
                <svg className="ag-trend" viewBox="0 0 400 96" role="img" aria-label={`Indeks kelembapan ${plant.name} dari 85 ke ${current.moisture} dalam ${format(current.t_h)} jam`}><path className="ag-trend-guide" d="M8 80H392" /><path d={trendPath(dry.data.samples)} pathLength={1} strokeDasharray={`${sample / 5} 1`} /><circle cx={8 + sample / 5 * 384} cy={80 - current.moisture * .72} r="4" /></svg>
              </div>
              <label className="ag-time-label" htmlFor="ag-time">Geser waktu <span>{format(current.t_h)} jam</span></label><input id="ag-time" type="range" min="0" max="5" step="1" value={sample} onChange={event => setSample(Number(event.target.value))} aria-valuetext={`${format(current.t_h)} jam, indeks ${current.moisture}`} /><div className="ag-time-ends"><span>0 jam</span><span>2,5 jam</span></div><p className="ag-small">Indeks sensor bukan persentase air. Ini contoh simulasi.</p>
            </div>
          </section>
          <section id="pahami" tabIndex={-1} className="ag-scene ag-understand" aria-labelledby="ag-understand-title">
            <img className="ag-still" src={plantImage(plant.id)} alt={`Spesimen ${plant.name.toLowerCase()} yang sama`} width="800" height="1100" />
            <div className="ag-scene-copy"><span className="ag-caption">03 / Pahami · {plant.name}</span><div className="ag-conditions" role="group" aria-label="Kondisi pengamatan">{[false, true].map(value => <button key={String(value)} aria-pressed={wet === value} onClick={() => { setWet(value); setAnswer(null) }}>{value ? 'Basah menetap' : 'Cepat mengering'}</button>)}</div>
              <h2 id="ag-understand-title">{wet ? <>Masih basah.<br /><span>Perlu air lagi?</span></> : <>Menurun cepat.<br /><span>Apa langkahmu?</span></>}</h2><div className="ag-condition-reading"><strong>{observed.data.samples[0].moisture} <span>→</span> {observed.reading.moisture}</strong><p>Selama {format(observed.data.now_h)} jam · indeks kelembapan</p></div>
              <div className="ag-answer-buttons" role="group" aria-label="Pilih langkah perawatan"><button aria-pressed={answer === 'water'} onClick={() => setAnswer('water')}>Siram lagi</button><button aria-pressed={answer === 'check'} onClick={() => setAnswer('check')}>{answer === 'check' && <Check aria-hidden="true" />} Periksa dulu</button></div>
              <AnimatePresence mode="wait">{answer && <motion.div key={`${wet}-${answer}`} className="ag-response" role="status" aria-label="Alasan langkah perawatan" initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .2 }}><h3>{answer === 'water' ? 'Lihat kondisinya dulu.' : observed.decision.action}</h3><p>{answer === 'water' ? 'Menyiram bukan selalu langkah berikutnya. Periksa dulu untuk melihat alasan dari pola pengamatan ini.' : observed.decision.reason}</p></motion.div>}</AnimatePresence><p className="ag-small">Contoh aturan untuk profil {plant.name.toLowerCase()}. Hasilnya petunjuk pemeriksaan.</p>
            </div>
          </section>
          <section id="coba" tabIndex={-1} className="ag-scene ag-finish" aria-labelledby="ag-finish-title"><img className="ag-still" src={plantImage(plant.id)} alt="" width="800" height="1100" />
            <div className="ag-scene-copy"><span className="ag-caption">04 / Giliranmu</span><h2 id="ag-finish-title">Sekarang,<br /><span>giliranmu.</span></h2><p>Ubah kondisi. Amati responsnya.<br />Pahami alasannya.</p><a className="ag-primary" href="#simulasi">Coba simulator <ArrowUpRight aria-hidden="true" /></a><button className="ag-text-button" onClick={unlock}>Kenali tanaman lain <ArrowRight aria-hidden="true" /></button></div>
            <footer className="ag-footer"><a className="ag-wordmark" href="#kenali" onClick={event => { event.preventDefault(); goTo('kenali') }}>smart agro<span aria-hidden="true">✳</span></a><p>Amati. Pahami. Rawat.</p><span>Eksplorasi simulasi, bukan diagnosis tanaman.</span></footer>
          </section>
        </>}
      </div>
    </main>
    {locked && <nav className="ag-chapter-nav" aria-label="Bab cerita tanaman">{chapters.map((name, index) => <a key={name} aria-label={`${index + 1}. ${name}`} href={`#${anchors[index]}`} aria-current={chapter === index ? 'step' : undefined} onClick={event => { event.preventDefault(); goTo(anchors[index]) }}><span>0{index + 1}</span><span>{name}</span></a>)}</nav>}
  </div>
}
