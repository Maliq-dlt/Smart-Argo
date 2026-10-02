import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { FlowerScene, SceneState } from '../lib/flowerScene'

const flowers = [
  { asset: 'flower_gazania', name: 'Gazania' },
  { asset: 'flower_ursinia', name: 'Ursinia' },
  { asset: 'flower_heliophila', name: 'Heliophila' },
  { asset: 'flower_empodium', name: 'Empodium' },
  { asset: 'periwinkle_plant', name: 'Periwinkle' },
]
const ease = [.65, 0, .35, 1] as const
const wrap = (index: number) => (index % flowers.length + flowers.length) % flowers.length

// Adapted from nexus-ui's Circular Carousel: https://21st.dev/@nexus-ui/components/circular-carousel
function orbitPosition(index: number, cursor: number, width: number) {
  const half = Math.floor(flowers.length / 2)
  const distance = wrap(index - cursor + half) - half
  const angle = distance * Math.PI / 12
  return { distance, cycle: Math.floor((cursor - index + half) / flowers.length), x: Math.sin(angle) * width * 1.06, y: (1 - Math.cos(angle)) * width * 1.06, scale: 1 - Math.abs(distance) * .04 }
}

export default function FlowerHero() {
  const reduced = useReducedMotion()
  const [cursor, setCursor] = useState(0)
  const active = wrap(cursor)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const [visible, setVisible] = useState(true)
  const [width, setWidth] = useState(0)
  const [state, setState] = useState<SceneState>('loading')
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const engine = useRef<FlowerScene | null>(null)
  const choice = useRef(active)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  const selected = flowers[active]
  const desktop = matchMedia('(min-width: 801px)').matches
  const playing = !keyboardFocus && !reduced && visible

  useLayoutEffect(() => {
    if (!stage.current) return
    setWidth(stage.current.clientWidth)
    const size = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    const visibility = () => setVisible(!document.hidden && Boolean(stage.current && stage.current.getBoundingClientRect().bottom > 0 && stage.current.getBoundingClientRect().top < innerHeight))
    size.observe(stage.current); intersection.observe(stage.current)
    document.addEventListener('visibilitychange', visibility)
    return () => { size.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    choice.current = active
    engine.current?.select(flowers[active].asset)
  }, [active])
  useEffect(() => {
    if (reduced || !host.current) return
    let cancelled = false
    const target = host.current
    void import('../lib/flowerScene').then(({ createFlowerScene }) => {
      if (cancelled) return
      engine.current = createFlowerScene(target, value => { if (!cancelled) setState(value) })
      engine.current.select(flowers[choice.current].asset)
    }).catch(() => { if (!cancelled) setState('fallback') })
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null }
  }, [reduced])
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => setCursor(value => value + 1), 4000)
    return () => clearTimeout(timer)
  }, [playing, cursor])

  const choose = (index: number) => {
    if (desktop && document.activeElement?.classList.contains('flower-tile')) stage.current?.focus({ preventScroll: true })
    setCursor(value => value + orbitPosition(index, value, 0).distance)
  }

  return <section className="flower-hero-shell" aria-labelledby="landing-title">
    <div className="flower-frame" data-flower={selected.asset}>
      <div className="flower-atmosphere" aria-hidden="true"><img src="./flowers/periwinkle_plant-thumb.webp" alt="" /><img src="./flowers/flower_empodium-thumb.webp" alt="" /></div>
      <div className="flower-stage" ref={stage} role="region" aria-roledescription="carousel" aria-label="Pilihan bunga" aria-describedby="flower-help" tabIndex={0} data-playing={playing}
        onFocusCapture={event => setKeyboardFocus(event.target.matches(':focus-visible'))}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false) }}
        onPointerDownCapture={() => setKeyboardFocus(false)}
        onKeyDownCapture={() => setKeyboardFocus(true)}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); choose(active + (event.key === 'ArrowRight' ? 1 : -1))
          }
        }}
        onPointerDown={event => { drag.current = { x: event.clientX, y: event.clientY }; dragged.current = false }}
        onPointerUp={event => {
          if (!drag.current) return
          const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y
          drag.current = null
          if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { dragged.current = true; choose(active + (dx < 0 ? 1 : -1)) }
        }}
        onPointerCancel={() => { drag.current = null }}
        onPointerMove={event => {
          if (reduced || event.pointerType !== 'mouse') return
          const bounds = event.currentTarget.getBoundingClientRect()
          engine.current?.point((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1)
        }}
        onPointerLeave={() => { drag.current = null; engine.current?.point(0, 0) }}>
        <div className="flower-orbit" role="group" aria-label="Pilih bunga untuk pot">
          {width > 0 && flowers.map((flower, index) => {
            const position = orbitPosition(index, cursor, width)
            const { distance, cycle } = position
            // ponytail: five cyclic slots; remount offscreen at each seam, add a continuous track only for pointer-following drag.
            return <motion.button key={`${flower.asset}-${cycle}`} type="button" className="flower-tile" data-distance={distance} aria-label={`Pilih bunga ${flower.name}`} aria-pressed={active === index} aria-controls="flower-selected" tabIndex={desktop && active === index ? -1 : 0}
              initial={desktop && !reduced ? { x: Math.sign(distance) * width * .8, y: position.y, scale: position.scale, rotate: distance * 15, opacity: 0 } : false}
              animate={{ x: desktop ? position.x : 0, y: desktop ? position.y : 0, scale: desktop ? position.scale : 1, rotate: desktop ? distance * 15 : 0, opacity: desktop && distance === 0 ? 0 : 1 }}
              transition={{ duration: reduced ? 0 : .5, ease }} onClick={event => { if (!dragged.current || event.detail === 0) choose(index); dragged.current = false }}>
              <img src={`./flowers/${flower.asset}-thumb.webp`} width="240" height="240" alt="" draggable={false} />
              <span>{flower.name}</span>
            </motion.button>
          })}
        </div>
        <motion.div className="flower-model" data-render={reduced ? 'static' : state} role="img" aria-label={`Bunga ${selected.name} dalam pot tanah liat`} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : .8, ease: [.22, 1, .36, 1] }}>
          <AnimatePresence initial={false}>
            <motion.img key={selected.asset} className="flower-poster" src={`./flowers/${selected.asset}.webp`} width="900" height="1000" alt="" draggable={false}
              initial={reduced ? false : { opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: reduced ? 0 : .5, ease }} />
          </AnimatePresence>
          <div className="flower-canvas" ref={host} data-state={reduced ? 'static' : state} aria-hidden="true" />
        </motion.div>
        <div className="flower-selected" id="flower-selected" aria-live="off">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={selected.name} initial={reduced ? false : { y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} transition={{ duration: reduced ? 0 : .22, ease: [.22, 1, .36, 1] }}>{selected.name}</motion.p>
          </AnimatePresence>
        </div>
        <div className="flower-heading">
          <h1 id="landing-title">Kenali potmu. <br /><span>Dari akarnya.</span></h1>
        </div>
        <div className="flower-carousel-controls">
          <button type="button" aria-label="Bunga sebelumnya" onClick={() => choose(active - 1)}><ArrowLeft aria-hidden="true" /></button>
          <span aria-hidden="true">{String(active + 1).padStart(2, '0')} / 05</span>
          <button type="button" aria-label="Bunga berikutnya" onClick={() => choose(active + 1)}><ArrowRight aria-hidden="true" /></button>
        </div>
        <p id="flower-help" className="sr-only">Pilih bunga dengan klik, geser, atau tombol panah. Pergantian otomatis berhenti selama fokus keyboard; keluar dari galeri untuk melanjutkan.</p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{playing ? '' : `Bunga dipilih: ${selected.name}.`}</p>
      </div>
    </div>
  </section>
}
