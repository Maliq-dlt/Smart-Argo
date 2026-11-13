import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

export const motionOk = () => matchMedia('(prefers-reduced-motion: no-preference)').matches

/** Characters fade in one by one in random order, as on the Farm Minerals promo. Returns a paused timeline;
 * its `data` is the SplitText, which must be reverted before the element's text is replaced (a new split on the
 * same element would otherwise restore the original text first). */
export function charReveal(el: HTMLElement, duration = .4) {
  const split = SplitText.create(el, { type: 'words,chars' })
  gsap.set(split.chars, { autoAlpha: 0 })
  return gsap.timeline({ paused: true, data: split }).to(split.chars, { autoAlpha: 1, duration, ease: 'power2.out', stagger: { each: .018, from: 'random' } })
}

/** Every [data-split] inside scope reveals once when it enters the lower edge of the screen. Call inside a gsap.context. */
export function revealHeadings(scope: HTMLElement) {
  scope.querySelectorAll<HTMLElement>('[data-split]').forEach(el => {
    const tl = charReveal(el)
    ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => tl.play() })
  })
}

/** Grid size for the block transition: large blocks in two rows, as on the Farm Minerals promo. */
export const stairGrid = () => (matchMedia('(max-width: 760px)').matches ? { cols: 3, rows: 2 } : { cols: 6, rows: 2 })

/* Block transition, scrubbed by scroll. Blocks fill the screen along a diagonal front from the bottom-left
 * corner to the top-right, so the edge reads as a staircase. The row-plus-column stagger follows "Chess Grid
 * Transition" by hyperiux on 21st.dev; here it is driven by scroll instead of a click, each block grows upward
 * rather than sliding in, and the cover completes at 85 % so no block is still moving when the stage unsticks. */
export function stairCover(blocks: HTMLElement[], cols: number, rows: number, trigger: Element, start: string, end: string) {
  const tl = gsap.timeline({ defaults: { ease: 'power1.inOut' }, scrollTrigger: { trigger, start, end, scrub: 1 } })
  blocks.forEach((block, i) => {
    const col = i % cols, rowFromBottom = rows - 1 - Math.floor(i / cols)
    const at = .62 * (col / Math.max(1, cols - 1)) + .38 * (rowFromBottom / Math.max(1, rows - 1))
    tl.fromTo(block, { scaleY: 0 }, { scaleY: 1, duration: .3 }, at * .55)
  })
  tl.to({}, { duration: .15 }, .85)
  return tl
}

/* Cursor trail over the hero video, after the Farm Minerals promo. A grid of 5vw squares lights up under the pointer in
 * two layers: the square first flashes in the sage gradient (coloured by column), then dissolves into a coarse mosaic
 * of the video beneath it, tinted toward the same gradient, which keeps playing until the square fades. Desktop with a
 * fine pointer only, and it stops spawning once the block transition has begun to cover the hero. */
const TILES = 6 // mosaic tiles across one square
const STOPS: [number, number[]][] = [[0, [195, 223, 149]], [.45, [111, 150, 86]], [1, [47, 90, 60]]]
const IN = 70, SOLID = 160, DISSOLVE = 260, HOLD = 520, OUT = 520 // ms
export function pixelTrail(section: HTMLElement, canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  if (!matchMedia('(pointer: fine) and (min-width: 768px) and (prefers-reduced-motion: no-preference)').matches) return () => {}
  const ctx = canvas.getContext('2d')!
  const mosaic = document.createElement('canvas'), mctx = mosaic.getContext('2d')!
  const colorAt = (x: number) => {
    let i = 0
    while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++
    const [p0, c0] = STOPS[i], [p1, c1] = STOPS[i + 1], t = (x - p0) / (p1 - p0)
    return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(' ')})`
  }
  const lit = new Map<number, number>()
  let cell = 1, cols = 1, dpr = 1, raf = 0, tint: CanvasGradient | null = null
  const size = () => {
    const r = section.getBoundingClientRect()
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr)
    cell = r.width * .05; cols = Math.ceil(r.width / cell)
    mosaic.width = cols * TILES; mosaic.height = Math.ceil(r.height / cell) * TILES
    tint = mctx.createLinearGradient(0, 0, mosaic.width, 0)
    STOPS.forEach(([at]) => tint!.addColorStop(at, colorAt(at)))
    ctx.imageSmoothingEnabled = false // resizing a canvas resets its state
  }
  // The video as it is shown (object-fit: cover, zoomed by the scroll), shrunk to TILES per square, with more contrast,
  // then soft-lit by the gradient: the mosaic keeps the video's light and shade but leans lime on the left, moss on the right.
  // One small draw of the whole frame per animation frame; each square then copies its own tiles.
  const paintMosaic = () => {
    mctx.globalCompositeOperation = 'source-over'
    const vw = video.videoWidth, vh = video.videoHeight
    if (video.readyState >= 2 && vw && vh) {
      const sr = section.getBoundingClientRect(), vr = video.getBoundingClientRect(), k = TILES / cell
      const s = Math.max(vr.width / vw, vr.height / vh), w = vw * s, h = vh * s
      mctx.filter = 'contrast(1.25) saturate(1.3)'
      mctx.drawImage(video, (vr.left - sr.left + (vr.width - w) / 2) * k, (vr.top - sr.top + (vr.height - h) / 2) * k, w * k, h * k)
      mctx.filter = 'none'
    } else { mctx.fillStyle = '#a7b29c'; mctx.fillRect(0, 0, mosaic.width, mosaic.height) }
    mctx.globalCompositeOperation = 'soft-light'
    mctx.fillStyle = tint!
    mctx.fillRect(0, 0, mosaic.width, mosaic.height)
  }
  const frame = () => {
    // Timestamps come from performance.now(): a rAF timestamp can precede the pointer event that lit a square.
    const now = performance.now()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!lit.size) { raf = 0; return }
    paintMosaic()
    const side = cell * dpr - dpr
    for (const [index, born] of lit) {
      const age = Math.max(0, now - born)
      if (age >= SOLID + DISSOLVE + HOLD + OUT) { lit.delete(index); continue }
      const col = index % cols, row = Math.floor(index / cols), x = col * cell * dpr, y = row * cell * dpr
      const fade = age < IN ? age / IN : Math.min(1, 1 - (age - SOLID - DISSOLVE - HOLD) / OUT)
      const solid = age < SOLID ? 1 : Math.max(0, 1 - (age - SOLID) / DISSOLVE)
      ctx.globalAlpha = fade
      ctx.drawImage(mosaic, col * TILES, row * TILES, TILES, TILES, x, y, side, side)
      if (solid > 0) { ctx.globalAlpha = fade * solid; ctx.fillStyle = colorAt(col / Math.max(1, cols - 1)); ctx.fillRect(x, y, side, side) }
    }
    ctx.globalAlpha = 1
    raf = requestAnimationFrame(frame)
  }
  const wrap = section.parentElement
  const move = (e: PointerEvent) => {
    // Past the first third of the sticky scroll the blocks are closing over the hero: no new squares.
    if (wrap && -wrap.getBoundingClientRect().top > (wrap.offsetHeight - section.offsetHeight) / 3) return
    const r = section.getBoundingClientRect(), col = Math.floor((e.clientX - r.left) / cell), row = Math.floor((e.clientY - r.top) / cell)
    if (col < 0 || row < 0 || col >= cols || e.clientY > r.bottom) return
    const index = row * cols + col, now = performance.now(), born = lit.get(index)
    // Passing over a square that is still lit keeps it in its mosaic phase instead of restarting the flash.
    lit.set(index, born !== undefined && now - born < SOLID + DISSOLVE + HOLD ? Math.max(born, now - SOLID - DISSOLVE) : now)
    if (!raf) raf = requestAnimationFrame(frame)
  }
  size()
  const resize = new ResizeObserver(size)
  resize.observe(section)
  section.addEventListener('pointermove', move)
  return () => { section.removeEventListener('pointermove', move); resize.disconnect(); cancelAnimationFrame(raf) }
}
