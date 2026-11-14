import { LABELS, labelsFor, type DeviceMode, type Highlight, type LabelId } from './deviceFacts'
import type { DeviceScene } from './deviceModel'

/** One WebGL renderer for the whole landing. Each section mounts a slot (poster + labels); the live canvas moves into
 * whichever slot is most on screen and takes that slot's state. Reduced motion and missing WebGL keep the posters. */
interface Slot { el: HTMLElement; mode: DeviceMode; highlight: Highlight | null; progress: number; studio: boolean; ratio: number }

const slots = new Map<HTMLElement, Slot>()
let scene: DeviceScene | null = null, canvas: HTMLCanvasElement | null = null, loading: Promise<void> | null = null
let active: Slot | null = null, raf = 0, failed = false, lost = false, generation = 0 // generation: bumped by teardown
let gl: WebGL2RenderingContext | null = null, create: typeof import('./deviceModel').createDeviceScene | null = null
// Viewport changes (a browser toolbar sliding in, a window drag) come many times a second. Reallocating the WebGL buffer
// on each one blanks the canvas and can make the GPU drop the context, so a new size waits until it has settled.
let pendingSize: { w: number; h: number } | null = null, sizeChangedAt = 0, appliedSize = ''
const SETTLE_MS = 160
let intersections: IntersectionObserver | null = null, sizes: ResizeObserver | null = null, themes: MutationObserver | null = null

export const motionAllowed = () => matchMedia('(prefers-reduced-motion: no-preference)').matches
export const deviceCanvas = () => (scene ? canvas : null)

function load() {
  if (loading || failed) return loading
  canvas = document.createElement('canvas')
  canvas.className = 'device-canvas'
  // Asking for the context ourselves lets a missing WebGL fall back to posters without three logging an error.
  gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true })
  if (!gl) { failed = true; markStatic(); return null }
  // If the GPU drops the context anyway, show the posters and rebuild the scene once it comes back.
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault()
    lost = true
    cancelAnimationFrame(raf); raf = 0
    slots.forEach(slot => { delete slot.el.dataset.live })
  })
  canvas.addEventListener('webglcontextrestored', () => {
    if (!create || !canvas || !gl) return
    scene?.dispose()
    scene = create(canvas, gl)
    lost = false
    appliedSize = ''
    if (active) attach(active)
  })
  // A teardown while three is still loading (then maybe a new mount with its own canvas) makes this load stale: it must
  // not build a second scene on the new canvas, which the new load also does and only one teardown would dispose.
  const mine = generation, own = { canvas, gl }
  loading = import('./deviceModel').then(({ createDeviceScene }) => {
    if (mine !== generation || !slots.size) return
    create = createDeviceScene
    scene = createDeviceScene(own.canvas, own.gl)
    themes = new MutationObserver(applyTheme)
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    if (active) attach(active)
    pickActive()
  }, () => { if (mine === generation) { failed = true; markStatic() } })
  return loading
}

const markStatic = () => slots.forEach(slot => { slot.el.dataset.static = 'true' })

/** The first painted background behind the slot: the colour the device should blend into. */
function backdropOf(el: HTMLElement) {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return '#a7b29c'
}

function applyTheme() {
  if (!scene || !active || !canvas) return
  scene.setTheme({ accent: getComputedStyle(active.el).getPropertyValue('--accent').trim() || '#c3df95', backdrop: backdropOf(active.el) })
  canvas.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function attach(slot: Slot) {
  if (!scene || !canvas) return
  slot.el.querySelector('.device-live')!.append(canvas)
  slots.forEach(other => {
    other.el.dataset.active = String(other === slot)
    if (other === slot) return
    delete other.el.dataset.live // its poster shows again
    other.el.querySelectorAll('.is-on').forEach(node => node.classList.remove('is-on'))
  })
  slot.el.querySelectorAll<HTMLElement>('.device-label').forEach(label => sides.delete(label)) // columns are chosen afresh
  scene.setStudio(slot.studio)
  push(slot)
  scene.snap() // the section opens on its own shot instead of flying in from the last section's camera
  applyTheme()
  sizes?.disconnect()
  sizes = new ResizeObserver(([entry]) => { pendingSize = { w: entry.contentRect.width, h: entry.contentRect.height }; sizeChangedAt = performance.now() })
  sizes.observe(slot.el)
  const box = slot.el.getBoundingClientRect()
  applySize(box.width, box.height)
  delete slot.el.dataset.live
  loop()
}

const push = (slot: Slot) => {
  if (!scene || slot !== active) return
  copyAge = 0 // a new state may fade other copy in: look again before placing labels
  scene.setMode(slot.mode)
  scene.setHighlight(slot.highlight)
  scene.setSoilProgress(slot.progress)
  slot.el.dataset.mode = slot.mode
  slot.el.dataset.highlight = slot.highlight ?? ''
}

function pickActive() {
  let best: Slot | null = null
  for (const slot of slots.values()) if (slot.ratio > 0 && (!best || slot.ratio > best.ratio)) best = slot
  if (best && best !== active) { active = best; attach(best) }
  else if (!best) { cancelAnimationFrame(raf); raf = 0 } // nothing on screen: stop drawing
  else loop()
}

function applySize(w: number, h: number) {
  const key = `${Math.round(w)}x${Math.round(h)}`
  if (!scene || key === appliedSize || !w || !h) return
  scene.resize(w, h)
  appliedSize = key
}

function loop() {
  if (raf || lost || !scene || !active || active.ratio <= 0) return
  const tick = (time: number) => {
    raf = 0
    if (lost || !scene || !active || active.ratio <= 0) return
    // Resize and draw in the same frame, so the canvas is never shown cleared.
    if (pendingSize && performance.now() - sizeChangedAt > SETTLE_MS) { applySize(pendingSize.w, pendingSize.h); pendingSize = null }
    scene.render(time)
    placeLabels(active)
    if (!active.el.dataset.live) { active.el.dataset.live = 'true'; active.el.dispatchEvent(new Event('device:ready')) }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

type Box = { left: number; top: number; right: number; bottom: number }
let copyBoxes: Box[] = [], copyAge = 0
/** The stage copy showing around the slot (corner headings and captions), in slot pixels. Re-read every 20 frames, and
 * at once after a state change, since phases fade their copy in and out. */
function copyAround(slot: Slot) {
  if (copyAge-- > 0) return copyBoxes
  copyAge = 20
  const box = slot.el.getBoundingClientRect(), stage = slot.el.closest<HTMLElement>('.v5-stage'), phase = stage?.dataset.phase
  // The copy of the current phase, read from the phase itself: on the first frame of its fade the CSS visibility is
  // still 'hidden', and a label placed then would jump columns a moment later.
  const current = (el: Element) => !phase || phase === 'all' || !el.matches('.v5-ph') || el.matches(`.v5-keep, .v5-ph-${phase}`)
  copyBoxes = stage ? [...stage.querySelectorAll<HTMLElement>('.v5-at-tl, .v5-at-tr, .v5-at-bl, .v5-at-br')]
    .filter(current)
    // 12 px of air around the copy, so a label never touches a heading either.
    .map(el => { const r = el.getBoundingClientRect(); return { left: r.left - box.left - 12, top: r.top - box.top - 12, right: r.right - box.left + 12, bottom: r.bottom - box.top + 12 } }) : []
  return copyBoxes
}
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const sides = new WeakMap<HTMLElement, 1 | -1>()
/** Extra height a label's box gets when its column is chosen: the camera settling or the slow turn moves the anchor
 * a few dozen pixels, which must not carry the label onto a heading and make it jump columns while it is shown. */
const DRIFT = 40

/** Labels sit in two columns beside the device (wider around the soil tub), kept inside the slot, apart from each
 * other and off the stage copy (a label that would cover a heading takes the other column, chosen once as it appears),
 * dimmed while the body hides their point. */
function placeLabels(slot: Slot) {
  const anchors = scene!.anchors(), shown = new Set(labelsFor(slot.mode))
  const w = slot.el.clientWidth, h = slot.el.clientHeight, k = Math.min(1, w / 640)
  const reach = (slot.mode === 'tanah' || slot.mode === 'angka' ? 230 : 150) * k
  const leftOf = (side: number, lx: number, width: number) => (side > 0 ? Math.min(lx + 8, w - width - 8) : Math.max(lx - 8 - width, 8))
  const copy = copyAround(slot)
  const placed: { id: LabelId; label: HTMLElement; side: 1 | -1; ly: number }[] = []
  slot.el.querySelectorAll<HTMLElement>('.device-label').forEach(label => {
    const id = label.dataset.label as LabelId, on = shown.has(id)
    label.classList.toggle('is-on', on)
    slot.el.querySelectorAll(`[data-label=${id}]:not(.device-label)`).forEach(node => node.classList.toggle('is-on', on))
    if (!on) { sides.delete(label); return }
    const ly = anchors[id].y + (LABELS[id].side > 0 ? -1 : 1) * 24 * k, width = label.offsetWidth, height = label.offsetHeight
    const blocked = (side: number, air = 0) => {
      const left = leftOf(side, w / 2 + side * reach, width)
      return copy.some(c => overlaps({ left, top: ly - height / 2 - air, right: left + width, bottom: ly + height / 2 + air }, c))
    }
    const home = LABELS[id].side
    let side = sides.get(label)
    if (side === undefined) side = blocked(home, DRIFT) && !blocked(-home, DRIFT) ? -home as 1 | -1 : home
    else if (blocked(side) && !blocked(-side)) side = -side as 1 | -1 // copy that faded in later, over the label
    sides.set(label, side)
    placed.push({ id, label, side, ly })
  })
  // Top to bottom in each column, each label at least its own height below the one above, all inside the slot.
  for (const side of [1, -1]) {
    const column = placed.filter(p => p.side === side).sort((a, b) => a.ly - b.ly)
    column.forEach((p, i) => {
      const half = p.label.offsetHeight / 2 + 6
      p.ly = Math.min(Math.max(p.ly, half, i ? column[i - 1].ly + column[i - 1].label.offsetHeight / 2 + half : 0), h - half)
    })
  }
  for (const { id, label, side, ly } of placed) {
    const { x, y, hidden } = anchors[id], line = slot.el.querySelector<SVGLineElement>(`line[data-label=${id}]`)!, dot = slot.el.querySelector<SVGCircleElement>(`circle[data-label=${id}]`)!
    const lx = w / 2 + side * reach, left = leftOf(side, lx, label.offsetWidth)
    label.style.transform = `translate(${left}px, ${ly}px) translateY(-50%)`
    label.classList.toggle('is-hidden', hidden); line.classList.toggle('is-hidden', hidden); dot.classList.toggle('is-hidden', hidden)
    line.setAttribute('x1', String(x)); line.setAttribute('y1', String(y)); line.setAttribute('x2', String(lx)); line.setAttribute('y2', String(ly))
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y))
  }
}

export function registerSlot(el: HTMLElement, init: { mode: DeviceMode; studio: boolean }) {
  if (!motionAllowed()) { el.dataset.static = 'true'; return () => {} }
  const slot: Slot = { el, mode: init.mode, highlight: null, progress: 0, studio: init.studio, ratio: 0 }
  slots.set(el, slot)
  if (failed) el.dataset.static = 'true'
  intersections ??= new IntersectionObserver(entries => {
    entries.forEach(entry => { const s = slots.get(entry.target as HTMLElement); if (s) s.ratio = entry.isIntersecting ? entry.intersectionRatio : 0 })
    pickActive()
  }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] })
  intersections.observe(el)
  load()
  return () => {
    intersections?.unobserve(el)
    slots.delete(el)
    if (active === slot) { active = null; canvas?.remove() }
    if (!slots.size) teardown()
  }
}

function teardown() {
  generation++
  cancelAnimationFrame(raf); raf = 0
  intersections?.disconnect(); sizes?.disconnect(); themes?.disconnect()
  intersections = sizes = themes = null
  scene?.dispose(); scene = null; canvas = null; loading = null; gl = null; create = null; lost = false; appliedSize = ''; pendingSize = null
}

const update = (el: HTMLElement, change: Partial<Pick<Slot, 'mode' | 'highlight' | 'progress'>>) => {
  const slot = slots.get(el)
  if (!slot) return
  Object.assign(slot, change)
  push(slot)
}
export const setSlotMode = (el: HTMLElement, mode: DeviceMode) => update(el, { mode })
export const setSlotHighlight = (el: HTMLElement, highlight: Highlight | null) => update(el, { highlight })
export const setSlotProgress = (el: HTMLElement, progress: number) => update(el, { progress })

/** Poster renderer for scripts/render-device-posters.mjs (only with ?device-poster in the URL). */
if (typeof location !== 'undefined' && location.search.includes('device-poster')) {
  Object.assign(window, {
    // `open`: the shot a live section opens on (device above the soil, the LED close-up), shown until the canvas
    // arrives, so the hand-over does not jump. Without it: the settled state, for reduced motion and missing WebGL.
    __devicePoster: async (mode: DeviceMode, width: number, height: number, open = false) => {
      const poster = document.createElement('canvas')
      const gl = poster.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true })!
      const { createDeviceScene } = await import('./deviceModel')
      const still = createDeviceScene(poster, gl)
      still.setStudio(false)
      still.setMode(mode)
      still.setSoilProgress(open ? 0 : 1)
      still.setHighlight(mode === 'angka' ? (open ? 'led' : 'moisture') : null)
      still.resize(width, height)
      for (let t = 0; t < 120; t++) still.render(600) // let the eased state settle
      const url = poster.toDataURL('image/webp', 0.9)
      still.dispose()
      return url
    },
  })
}
