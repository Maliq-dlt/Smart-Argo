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

/** A grid of 5vw squares lights up under the cursor and fades, coloured by column. Desktop, fine pointer only. */
export function pixelTrail(section: HTMLElement, canvas: HTMLCanvasElement) {
  if (!matchMedia('(pointer: fine) and (min-width: 768px) and (prefers-reduced-motion: no-preference)').matches) return () => {}
  const ctx = canvas.getContext('2d')!
  const stops: [number, number[]][] = [[0, [195, 223, 149]], [.45, [111, 150, 86]], [1, [47, 90, 60]]]
  const colorAt = (x: number) => {
    let i = 0
    while (i < stops.length - 2 && x > stops[i + 1][0]) i++
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1], t = (x - p0) / (p1 - p0)
    return c0.map((v, k) => Math.round(v + (c1[k] - v) * t))
  }
  const lit = new Map<number, number>()
  let cell = 0, cols = 0, dpr = 1, raf = 0
  const size = () => {
    const r = section.getBoundingClientRect()
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr)
    cell = r.width * .05; cols = Math.ceil(r.width / cell)
  }
  const frame = (now: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const [index, born] of lit) {
      const age = now - born
      // 100 ms in, 200 ms hold, 300 ms out.
      const alpha = age < 100 ? age / 100 : age < 300 ? 1 : 1 - (age - 300) / 300
      if (alpha <= 0) { lit.delete(index); continue }
      const col = index % cols, row = Math.floor(index / cols), [r, g, b] = colorAt(col / Math.max(1, cols - 1))
      ctx.fillStyle = `rgb(${r} ${g} ${b} / ${alpha})`
      ctx.fillRect(col * cell * dpr, row * cell * dpr, cell * dpr - dpr, cell * dpr - dpr)
    }
    raf = lit.size ? requestAnimationFrame(frame) : 0
  }
  const move = (e: PointerEvent) => {
    const r = section.getBoundingClientRect(), col = Math.floor((e.clientX - r.left) / cell), row = Math.floor((e.clientY - r.top) / cell)
    if (col < 0 || row < 0 || col >= cols) return
    const index = row * cols + col, now = performance.now(), born = lit.get(index)
    lit.set(index, born !== undefined && now - born < 300 ? now - 100 : now)
    if (!raf) raf = requestAnimationFrame(frame)
  }
  size()
  const resize = new ResizeObserver(size)
  resize.observe(section)
  section.addEventListener('pointermove', move)
  return () => { section.removeEventListener('pointermove', move); resize.disconnect(); cancelAnimationFrame(raf) }
}
