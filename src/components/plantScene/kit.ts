/* Small helpers shared by the plant stage: maths, springs, bands along an arc, and SVG element helpers.
 * The stage is ported from the Fase 2.0 mock (design-previews/plant-stage-2026-11-15). Its colours are an illustration
 * palette (drawn art, not UI), so they are written as hex here and not as design tokens. */
export const TAU = Math.PI * 2
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (t: number) => t * t * (3 - 2 * t)
export const f1 = (v: number) => v.toFixed(1)
const channels = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const toHex = (a: number[]) => '#' + a.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
/** Blend two `#rrggbb` colours. */
export const mix = (a: string, b: string, t: number) => { const x = channels(a), y = channels(b); return toHex(x.map((v, i) => lerp(v, y[i], t))) }
/** A small seeded random generator, so every pot's texture is the same on every load. */
export const mulberry = (seed: number) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }

/** One flag for the whole stage; the React wrapper keeps it in step with `prefers-reduced-motion`. */
export const motion = { reduced: false }

/** A spring in Apple's terms: `response` is the time it takes to travel most of the way, `damping` 1 = no overshoot. */
export class Spring {
  x: number; t: number; v = 0
  r: number; z: number
  constructor(x: number, response = .6, damping = 1) { this.x = x; this.t = x; this.r = response; this.z = damping }
  snap(x: number) { this.x = this.t = x; this.v = 0 }
  step(dt: number) {
    if (motion.reduced) { this.x = this.t; this.v = 0; return }
    const w = TAU / this.r, k = w * w, c = 2 * this.z * w, n = Math.max(1, Math.ceil(dt / .008)), h = dt / n
    for (let i = 0; i < n; i++) { this.v += (-k * (this.x - this.t) - c * this.v) * h; this.x += this.v * h }
  }
}

/** Width profiles along a band, from base (0) to tip (1). */
export const SH = {
  lance: (t: number) => Math.sin(Math.PI * Math.pow(t, .72)),
  oval: (t: number) => Math.pow(Math.sin(Math.PI * Math.pow(t, .78)), .55),
  tube: (t: number) => (t < .07 ? .55 + t * 6 : 1 - Math.pow(t, 3.2) * .92),
  thin: (t: number) => 1 - t * .45,
}
export type Point3 = [x: number, y: number, angle: number]
export interface Ribbon { d: string; spine: string; pts: Point3[]; tip: Point3 }
/** A band along an arc: leaves, tubes, roots and flower stalks. angle 0 = right, -90 = up; curve = total turn in degrees.
 * Both edges are drawn as smooth curves through the sampled points, so a leaf bends without faceting as it moves. */
export function ribbon(x: number, y: number, angle: number, len: number, curve: number, width: number, shape: (t: number) => number, n = 12): Ribbon {
  const L: Point3[] = [], R: Point3[] = [], S: Point3[] = []
  let px = x, py = y, th = angle * Math.PI / 180
  const dth = curve * Math.PI / 180 / n, step = len / n
  for (let i = 0; i <= n; i++) {
    const w = width * shape(i / n) / 2, nx = -Math.sin(th), ny = Math.cos(th)
    L.push([px + nx * w, py + ny * w, th]); R.push([px - nx * w, py - ny * w, th]); S.push([px, py, th])
    th += dth; px += Math.cos(th) * step; py += Math.sin(th) * step
  }
  const f = (p: Point3) => `${f1(p[0])} ${f1(p[1])}`
  const half = (pts: Point3[]) => { let d = ''; for (let i = 1; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; d += `Q${f(a)} ${f1((a[0] + b[0]) / 2)} ${f1((a[1] + b[1]) / 2)}` } return d + `L${f(pts[pts.length - 1])}` }
  const Rr = R.slice().reverse()
  return { d: `M${f(L[0])}${half(L)}L${f(Rr[0])}${half(Rr)}Z`, spine: `M${f(S[0])}${half(S)}`, pts: S, tip: S[n] }
}
export const bez = (p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number] => {
  const u = 1 - t
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]
}
/** A smooth open path through points (quadratic curves between midpoints). */
export const smoothPath = (pts: number[][]) => {
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) d += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1((pts[i][0] + pts[i + 1][0]) / 2)} ${f1((pts[i][1] + pts[i + 1][1]) / 2)}`
  const l = pts[pts.length - 1]
  return d + `L${f1(l[0])} ${f1(l[1])}`
}
/** A rounded rectangle with squircle corners (the device body). */
export const squircle = (x0: number, y0: number, x1: number, y1: number, rt: number, rb: number) => {
  const ct = rt * .3, cb = rb * .3
  return `M${x0 + rt} ${y0}H${x1 - rt}C${x1 - ct} ${y0} ${x1} ${y0 + ct} ${x1} ${y0 + rt}V${y1 - rb}C${x1} ${y1 - cb} ${x1 - cb} ${y1} ${x1 - rb} ${y1}H${x0 + rb}C${x0 + cb} ${y1} ${x0} ${y1 - cb} ${x0} ${y1 - rb}V${y0 + rt}C${x0} ${y0 + ct} ${x0 + ct} ${y0} ${x0 + rt} ${y0}Z`
}
/** The plant-in-pot mark on the device, the same path as the landing page's. */
export const AGRO_MARK = 'M18 19V9M18 12C10 13 7 9 8 5c7 0 10 3 10 7ZM18 9C18 3 23 2 28 3c0 6-4 8-10 6ZM8 18h20l-3 12H11L8 18ZM18 19v7m0-4-4 3m4-2 4 3'

const NS = 'http://www.w3.org/2000/svg'
export type Attrs = Record<string, string | number>
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent?.appendChild(e)
  return e
}
export function set(e: Element, attrs: Attrs) { for (const k in attrs) e.setAttribute(k, String(attrs[k])); return e }
