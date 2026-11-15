import { AGRO_MARK, clamp, f1, lerp, mulberry, set, squircle, svg, TAU, type Ribbon } from './kit.ts'

/** What every part needs to draw one frame. */
export interface FrameState {
  day: number; M: number; settle: number; t: number; night: number; droop: number; boost: number; sway: number
  pourT: number; canIn: number; tilt: number; stream: number; planted: boolean; contact: boolean
}
export interface Ctx { uid: string; defs: SVGDefsElement }
export interface Anchors { t: [number, number]; m: [number, number]; p: [number, number] }
/** One species' drawing: a group in pot coordinates (origin at the soil surface, y down). */
export interface Part { g: SVGGElement; baseY: number; scale: number; halfW: number; anchors: Anchors; update(s: FrameState): void }
interface Box { x: number; y: number; w: number; h: number }
export interface RootDef { d: string; w?: number; from: number; span: number }
export type MediaKind = 'soil' | 'husk' | 'bark'

export function buildMedia(ctx: Ctx, parent: Element, d: string, box: Box, kind: MediaKind) {
  const rnd = mulberry(kind.length * 977 + 13)
  const clipId = `${ctx.uid}-clip-${kind}`
  const clip = svg('clipPath', { id: clipId }, ctx.defs); svg('path', { d }, clip)
  const grad = svg('linearGradient', { id: `${ctx.uid}-wet-${kind}`, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs)
  const stops = Array.from({ length: 7 }, (_, i) => svg('stop', { offset: i / 6, 'stop-color': kind === 'bark' ? '#13202a' : '#241a12' }, grad))
  const g = svg('g', { 'clip-path': `url(#${clipId})` }, parent)
  svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: { soil: '#b39467', husk: '#b6996c', bark: '#3b2f26' }[kind] }, g)
  const R = (a: number, b: number) => a + rnd() * (b - a)
  if (kind !== 'bark') {
    for (let i = 0; i < 120; i++) svg('circle', { cx: f1(R(box.x, box.x + box.w)), cy: f1(R(box.y, box.y + box.h)), r: f1(R(.7, 2.3)), fill: ['#8e7049', '#c9ad7e', '#7a5d3b', '#d2b88a'][i % 4], opacity: .75 }, g)
    for (let i = 0; i < 3; i++) svg('path', { d: `M${box.x} ${box.y + 34 + i * 38}Q${box.x + box.w * .3} ${box.y + 28 + i * 38 + R(-8, 8)} ${box.x + box.w * .6} ${box.y + 38 + i * 38}T${box.x + box.w} ${box.y + 32 + i * 38}`, fill: 'none', stroke: '#8e7049', 'stroke-width': 1.1, opacity: .35 }, g)
  }
  if (kind === 'soil') { // drainage gravel in the bottom fifth
    const top = box.y + box.h * .8
    svg('rect', { x: box.x, y: top, width: box.w, height: box.h * .2 + 2, fill: '#8a8579' }, g)
    for (let i = 0; i < 22; i++) svg('ellipse', { cx: f1(R(box.x, box.x + box.w)), cy: f1(R(top + 4, box.y + box.h - 4)), rx: f1(R(7, 13)), ry: f1(R(5, 8)), fill: ['#a8a396', '#7c776b', '#b9b4a6', '#938e80'][i % 4], stroke: '#6b665b', 'stroke-width': .6 }, g)
  }
  if (kind === 'husk') for (let i = 0; i < 96; i++) svg('ellipse', { cx: f1(R(box.x, box.x + box.w)), cy: f1(R(box.y, box.y + box.h)), rx: f1(R(3.5, 6)), ry: f1(R(1.1, 1.7)), fill: ['#e6d4a0', '#cdb67c', '#f0e2b6'][i % 3], transform: `rotate(${f1(R(-80, 80))} ${f1(R(box.x, box.x + box.w))} ${f1(R(box.y, box.y + box.h))})`, opacity: .9 }, g)
  if (kind === 'bark') for (let row = 0; row < 8; row++) for (let col = 0; col < 12; col++) {
    const cx = box.x + (col + .5 + (row % 2) * .5) * box.w / 11.5 + R(-5, 5), cy = box.y + (row + .5) * box.h / 7.6 + R(-5, 5), r = R(10, 17), n = 6 + Math.floor(rnd() * 2)
    const pts = Array.from({ length: n }, (_, k) => { const a = k / n * TAU + R(-.25, .25), rr = r * R(.7, 1.1); return `${f1(cx + Math.cos(a) * rr)},${f1(cy + Math.sin(a) * rr * .72)}` })
    svg('polygon', { points: pts.join(' '), fill: ['#7a5a3d', '#8d6b49', '#6a4d34', '#9a7a55', '#5d432e'][(row * 3 + col) % 5], stroke: '#2e231b', 'stroke-width': 1, 'stroke-linejoin': 'round' }, g)
  }
  svg('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: `url(#${ctx.uid}-wet-${kind})` }, g)
  const roots = svg('g', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g)
  /** Darkens the media with its moisture; right after watering the top is wetter than the bottom until `settle` reaches 1. */
  const setWet = (M: number, settle: number) => stops.forEach((s, i) => s.setAttribute('stop-opacity', f1(clamp(M + (.5 - i / 6) * .6 * (1 - settle)) * (kind === 'bark' ? .5 : .66))))
  return { g, roots, setWet, clipId }
}

/** Each root path draws itself with its dash length as the plant grows; returns one setter per path. */
export function growRoots(parent: Element, defs: RootDef[], color: string, widths: number[]) {
  return defs.map((def, i) => {
    const p = svg('path', { d: def.d, stroke: color, 'stroke-width': def.w ?? widths[i % widths.length], pathLength: 1, 'stroke-dasharray': '0 2', opacity: 0 }, parent)
    return (g: number) => { const k = clamp((g - def.from) / def.span); set(p, { 'stroke-dasharray': `${k.toFixed(3)} 2`, opacity: k > .002 ? 1 : 0 }) }
  })
}

/** A seed in the soil, shown while nothing is planted. */
export function buildSeed(parent: Element, y: number) {
  const seed = svg('ellipse', { cx: 0, cy: y, rx: 7, ry: 3.6, fill: '#8a6d3f', stroke: '#5a4526', 'stroke-width': 1.2, opacity: 0 }, parent)
  return (planted: boolean) => seed.setAttribute('opacity', planted ? '0' : '1')
}

const DEVICE = { shell: '#ece6cf', shade: '#d9d1b3', line: '#857f5c', skirt: '#4d6556', skirtLine: '#2f4237', panel: '#35525e', cell: '#4f7384', cellLine: '#2b424d', steel: '#cdd6cd', steelLine: '#6a7a70', mark: '#2f5a3c' }
/** The Smart Agro device in the stage's own cartoon style: flat fills, a darker outline of the same hue, one flat highlight.
 * The parts are the landing render's (squircle body, solar panel on top, dark skirt, one LED, plant-in-pot mark, two short
 * steel probes with depth marks), in colours borrowed from the scene so it sits in the picture instead of on it.
 * `o` = where its foot stands in the pot and its scale; returns the per-frame updater and the anchors the readings point at. */
export function buildDevice(ctx: Ctx, body: Element, glow: Element, o: { x: number; y0: number; k: number }) {
  const id = `${ctx.uid}-dev${Math.round(o.x)}`, C = DEVICE
  const T = `translate(${o.x} ${o.y0}) scale(${o.k})`
  const dev = svg('g', { transform: T, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, body), lit = svg('g', { transform: T }, glow)
  const bodyD = squircle(-29, -66, 29, 0, 19, 17)
  svg('path', { d: bodyD }, svg('clipPath', { id: `${id}-body` }, ctx.defs))
  const probeD = (x: number) => `M${x - 2.6} -2V38L${x} 47L${x + 2.6} 38V-2Z`
  const probeClip = svg('clipPath', { id: `${id}-probes` }, ctx.defs); for (const x of [-9, 9]) svg('path', { d: probeD(x) }, probeClip)
  const bandG = svg('linearGradient', { id: `${id}-band`, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs)
  for (const [offset, opacity] of [[0, 0], [.5, .95], [1, 0]]) svg('stop', { offset, 'stop-color': '#d6f2a8', 'stop-opacity': opacity }, bandG)
  for (const x of [-9, 9]) {
    svg('path', { d: probeD(x), fill: C.steel, stroke: C.steelLine, 'stroke-width': 1.4 }, dev)
    for (const y of [13, 25, 36]) svg('path', { d: `M${x - 2.6} ${y}H${x + 2.6}`, stroke: C.steelLine, 'stroke-width': 1.6 }, dev)
    svg('path', { d: `M${x - 1} 2V34`, stroke: '#fff', 'stroke-width': 1.2, opacity: .6 }, dev)
    svg('rect', { x: x - 3.8, y: -1, width: 7.6, height: 5.5, rx: 1.6, fill: C.skirt, stroke: C.skirtLine, 'stroke-width': 1.2 }, dev)
  }
  svg('path', { d: bodyD, fill: C.shell, stroke: C.line, 'stroke-width': 1.8 }, dev)
  const part = svg('g', { 'clip-path': `url(#${id}-body)` }, dev)
  svg('path', { d: 'M13 -70Q19 -40 15 4H32V-70Z', fill: C.shade }, part)
  svg('path', { d: 'M-30 -19Q0 -10 30 -19V2H-30Z', fill: C.skirt }, part)
  svg('path', { d: 'M-30 -19Q0 -10 30 -19', fill: 'none', stroke: C.skirtLine, 'stroke-width': 1.4 }, part)
  svg('path', { d: 'M-21 -56Q-24 -42 -21 -30', fill: 'none', stroke: '#fff', 'stroke-width': 3.2, opacity: .55 }, part)
  svg('path', { d: 'M-22 -70L21 -68L26 -61L-26 -63Z', fill: C.panel, stroke: C.skirtLine, 'stroke-width': 1.4 }, dev)
  svg('path', { d: 'M-19 -68L19 -66.4L22.4 -62.8L-22 -64.2Z', fill: C.cell }, dev)
  for (let i = 1; i < 4; i++) { const t = i / 4; svg('path', { d: `M${f1(-19 + 38 * t)} ${f1(-68 + 1.6 * t)}L${f1(-22 + 44.4 * t)} ${f1(-64.2 + 1.4 * t)}`, stroke: C.cellLine, 'stroke-width': .9 }, dev) }
  svg('path', { d: 'M-20.5 -66.1L22 -64.6', stroke: C.cellLine, 'stroke-width': .9 }, dev)
  svg('path', { d: AGRO_MARK, transform: 'translate(-9.2 -38.6) scale(.51)', fill: 'none', stroke: C.mark, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, dev)
  /* The LED and the reading band stay outside the night filter, so they glow in the dark. */
  const ring = svg('circle', { cx: -13, cy: -45, r: 4.4, fill: 'none', stroke: '#79e0ae', 'stroke-width': 1.2, opacity: 0 }, lit)
  const lamp = svg('circle', { cx: -13, cy: -45, r: 4.4, fill: '#c9f4dc', stroke: '#3f9a70', 'stroke-width': 1.3 }, lit)
  const core = svg('circle', { cx: -13, cy: -45, r: 2.1, fill: '#52c88f' }, lit)
  const probes = svg('g', { 'clip-path': `url(#${id}-probes)` }, lit)
  const band = svg('rect', { x: -14, y: 0, width: 28, height: 9, fill: `url(#${id}-band)`, opacity: 0 }, probes)
  const at = (x: number, y: number): [number, number] => [o.x + x * o.k, o.y0 + y * o.k]
  let lastContact: boolean | null = null
  return {
    anchors: { t: at(29, -36), m: at(12, 19), p: at(12, 36) } as Anchors,
    update(s: FrameState) {
      if (s.contact !== lastContact) { lastContact = s.contact; core.setAttribute('fill', s.contact ? '#52c88f' : '#e0a23a'); lamp.setAttribute('fill', s.contact ? '#c9f4dc' : '#f6e2b0'); lamp.setAttribute('stroke', s.contact ? '#3f9a70' : '#a8741f') }
      const period = s.boost > 0 ? 2.6 : 7, ph = (s.t % period) / period, up = clamp(ph / .24)
      set(band, { y: f1(lerp(47, -4, 1 - Math.pow(1 - up, 2)) - 4.5), opacity: s.contact && ph < .24 ? f1(Math.sin(up * Math.PI) * (.5 + s.night * .35)) : 0 })
      const pu = clamp((ph - .22) / .26), on = ph > .22 && ph < .48
      set(ring, { r: f1(lerp(4.4, 8, pu)), opacity: s.contact && on ? f1((1 - pu) * .6) : 0 })
      core.setAttribute('opacity', f1(.85 + (on ? .15 * Math.sin(pu * Math.PI) : 0)))
    },
  }
}

/** Watering: the can, the stream, ripples on the surface and drops that travel down the media. The can arrives above the
 * device, so the stream falls to the left of it and never through it. */
export function buildWater(ctx: Ctx, glow: Element, spec: { x: number; soilY: number; depth: number; clipId: string }) {
  const rnd = mulberry(42)
  const drops = svg('g', { 'clip-path': `url(#${spec.clipId})` }, glow)
  const dropEls = Array.from({ length: 18 }, (_, i) => ({ el: svg('path', { d: 'M0 -4.2C2.4 -1.2 2.7 1.6 0 3C-2.7 1.6 -2.4 -1.2 0 -4.2Z', fill: '#a6dcf2', stroke: '#3a86ad', 'stroke-width': .6, opacity: 0 }, drops), x: spec.x + (rnd() - .5) * 46, depth: spec.soilY + 40 + rnd() * (spec.depth - 50), delay: .9 + i * .075 }))
  const fg = svg('linearGradient', { id: `${spec.clipId}-front`, x1: 0, y1: 0, x2: 0, y2: 1 }, ctx.defs)
  for (const [offset, opacity] of [[0, 0], [.5, .42], [1, 0]]) svg('stop', { offset, 'stop-color': '#bfeaf8', 'stop-opacity': opacity }, fg)
  const front = svg('rect', { x: -110, width: 220, height: 22, fill: `url(#${spec.clipId}-front)`, opacity: 0 }, drops)
  const ripples = Array.from({ length: 3 }, () => svg('ellipse', { cx: spec.x, cy: spec.soilY, rx: 4, ry: 1.4, fill: 'none', stroke: '#d6f1fb', 'stroke-width': 1.4, opacity: 0 }, glow))
  const splash = Array.from({ length: 6 }, () => svg('path', { d: 'M0 -2.4C1.4 -.7 1.6 1 0 1.8C-1.6 1 -1.4 -.7 0 -2.4Z', fill: '#d6f1fb', opacity: 0 }, glow))
  const streamBack = svg('path', { fill: 'none', stroke: '#3b8fb8', 'stroke-width': 7.5, 'stroke-linecap': 'round', opacity: 0 }, glow)
  const stream = svg('path', { fill: 'none', stroke: '#e6f7fd', 'stroke-width': 3.8, 'stroke-linecap': 'round', opacity: 0, 'stroke-dasharray': '7 6' }, glow)
  const can = svg('g', { opacity: 0 }, glow)
  svg('path', { d: 'M0 0L22 -22L38 -30L36 -14L16 4Z', fill: '#6f9486' }, can)
  svg('path', { d: 'M36 -62Q36 -66 42 -66H102Q108 -66 108 -60L113 -14Q113 -8 107 -8H40Q34 -8 34 -14Z', fill: '#86ab9b' }, can)
  svg('path', { d: 'M38 -62H104L106 -50H37Z', fill: '#a4c6b7', opacity: .55 }, can)
  svg('path', { d: 'M42 -66H102', stroke: '#4f7468', 'stroke-width': 3, 'stroke-linecap': 'round' }, can)
  svg('path', { d: 'M105 -56Q142 -62 140 -34Q138 -14 112 -16', fill: 'none', stroke: '#6f9486', 'stroke-width': 7, 'stroke-linecap': 'round' }, can)
  return (s: FrameState) => {
    const on = s.pourT >= 0
    const tipX = spec.x + 12 + (1 - s.canIn) * 190, tipY = spec.soilY - 78 - (1 - s.canIn) * 26
    set(can, { opacity: f1(clamp(s.canIn * 1.6)), transform: `translate(${f1(tipX)} ${f1(tipY)}) rotate(${f1(lerp(6, -17, s.tilt))})` })
    const streaming = on && s.stream > .02, len = clamp(s.stream)
    if (streaming) {
      const sx = tipX - 2, sy = tipY + 1, ex = spec.x + Math.sin(s.t * 9) * 1.5, ey = spec.soilY
      const d = `M${f1(sx)} ${f1(sy)}C${f1(sx - 3)} ${f1(sy + 30)} ${f1(ex + 4)} ${f1(ey - 44)} ${f1(ex)} ${f1(sy + (ey - sy) * len)}`
      set(streamBack, { d, opacity: .55 }); set(stream, { d, opacity: .95, 'stroke-dashoffset': f1(-s.t * 70) })
    } else { stream.setAttribute('opacity', '0'); streamBack.setAttribute('opacity', '0') }
    const fu = clamp((s.pourT - .9) / 2.2)
    set(front, { y: f1(lerp(spec.soilY - 6, spec.soilY + spec.depth, 1 - Math.pow(1 - fu, 2))), opacity: on && fu > 0 && fu < 1 ? f1(Math.sin(fu * Math.PI)) : 0 })
    ripples.forEach((r, i) => { const u = (s.t * .9 + i / 3) % 1; set(r, { rx: f1(5 + u * 38), ry: f1(1.4 + u * 7), opacity: f1(streaming ? (1 - u) * .8 : 0) }) })
    splash.forEach((p, i) => { const u = (s.t * 1.7 + i * .17) % 1; set(p, { transform: `translate(${f1(spec.x + (i - 2.5) * 10.5 * u)} ${f1(spec.soilY - Math.sin(u * Math.PI) * 11)})`, opacity: streaming ? f1((1 - u) * .8) : 0 }) })
    for (const d of dropEls) {
      const u = clamp((s.pourT - d.delay) / 1.5)
      if (!on || u <= 0 || u >= 1) { d.el.setAttribute('opacity', '0'); continue }
      set(d.el, { transform: `translate(${f1(d.x + Math.sin(u * 5 + d.depth) * 2)} ${f1(lerp(spec.soilY + 4, d.depth, 1 - Math.pow(1 - u, 2)))}) scale(${f1(1.15 - u * .5)})`, opacity: f1(Math.sin(u * Math.PI) * .95) })
    }
  }
}

/** The night tint is one colour matrix on the plant and pot group; the LED, water and readings sit outside it. */
export function nightFilter(ctx: Ctx) {
  const f = svg('filter', { id: `${ctx.uid}-night`, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' }, ctx.defs)
  return svg('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0' }, f)
}

const LEAF = { fillA: '#4f8a43', fillB: '#5d9b4d', rib: '#a9d79a', edge: '#37692f' }
export const LEAF_FILL = { A: LEAF.fillA, B: LEAF.fillB }
export interface Leaf { g: SVGGElement; body: SVGPathElement; mid: SVGPathElement }
export function makeLeaf(parent: Element, fill: string = LEAF.fillA, edge: string = LEAF.edge, rib: string = LEAF.rib): Leaf {
  const g = svg('g', {}, parent)
  const body = svg('path', { fill, stroke: edge, 'stroke-width': .9, 'stroke-linejoin': 'round' }, g)
  const mid = svg('path', { fill: 'none', stroke: rib, 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: .62 }, g)
  return { g, body, mid }
}
export function placeLeaf(l: Leaf, rb: Ribbon, visible: number) {
  if (visible <= .004) { l.g.setAttribute('display', 'none'); return }
  l.g.removeAttribute('display'); l.body.setAttribute('d', rb.d); l.mid.setAttribute('d', rb.spine)
}
/** Leaf direction: side +1 right, -1 left; elevation in degrees above the horizontal. */
export const dirOf = (side: number, elev: number) => side > 0 ? -elev : 180 + elev
/** One slow breeze for the whole plant: two sines, no per-leaf shake and no reaction to the pointer. */
export const breeze = (s: FrameState, k = 1) => s.sway * k * (.8 * Math.sin(s.t * .5) + .3 * Math.sin(s.t * 1.07 + 1.7))
