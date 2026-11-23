import { clamp, f1, mix, mulberry, motion, set, smoothPath, Spring, svg } from './kit.ts'
import type { SimWeather } from '../../lib/weather.ts'
import { nightFilter, type Ctx, type FrameState, type Part } from './parts.ts'
import { MAKERS, type SceneSpecies } from './plants.ts'
import { LOOKS, dropCount, nightFactor, orbit, paletteAt, unwrapHour } from './sky.ts'

export interface SceneReadings { suhu: string; kelembapan: string; ph: string; alert?: { suhu?: boolean; kelembapan?: boolean; ph?: boolean } }
export interface SceneState {
  species?: SceneSpecies; day?: number; planted?: boolean; moisture?: number; hour?: number; contact?: boolean
  readings?: SceneReadings; calm?: boolean; weather?: SimWeather
}
interface ReadingText { key: 't' | 'm' | 'p'; l: SVGTextElement; v: SVGTextElement; line: SVGPathElement; text: string; sig: string }
interface Slot { part: Part; ty: number; day: Spring; alpha: Spring; chips?: SVGGElement; texts?: ReadingText[] }

/** The pot stage: sky, hills, a shelf, and one pot with its plant and device. The picture is the Fase 2.0 mock; this class
 * only adds what the app needs: it is driven by `set()` (sensor values, the session clock) and never by the pointer. */
export class Scene {
  /** 0 in daylight, 1 deep at night; read by the wrapper for the surrounding page. */
  night = 0
  private readonly readingsOn: boolean
  private readonly root: SVGSVGElement
  private ctx: Ctx
  private slots = new Map<SceneSpecies, Slot>()
  private current: SceneSpecies
  private moist = new Spring(58, .8, 1)
  private settle = new Spring(1, 2.6, 1)
  private hour = new Spring(10, 1.1, 1)
  private canIn = new Spring(0, .65, 1)
  private tilt = new Spring(0, .7, 1)
  private stream = new Spring(0, .35, 1)
  private boost = 0
  private wantMoist = 58
  private pourT = -1
  private phase = 0
  private weather: SimWeather = 'cerah'
  private cover = new Spring(LOOKS.cerah.cloud, 1.4, 1)
  private dim = new Spring(0, 1.4, 1)
  private rain = new Spring(0, 1.1, 1)
  private heat = new Spring(0, 1.6, 1)
  private wind = new Spring(1, 1.2, 1)
  private planted = true
  private contact = true
  private calm = false
  private dayTarget = 0
  private primed = false
  private readings: SceneReadings | null = null
  private layers: SVGGElement
  private readingLayer: SVGGElement
  private skyStops: SVGStopElement[]
  private shelfStops: SVGStopElement[]
  private nightMatrix: SVGFEColorMatrixElement
  private starEls: { el: SVGCircleElement; tw: boolean; ph: number }[]
  private sun: SVGCircleElement
  private sunHalo: SVGCircleElement
  private moon: SVGGElement
  private moonHalo: SVGCircleElement
  private clouds: { c: SVGGElement; x: number; y: number; sc: number }[]
  private dimmer: SVGRectElement
  private warmer: SVGRectElement
  private drops: { el: SVGLineElement; x: number; speed: number; len: number; phase: number }[]
  private shimmer: SVGPathElement[]
  private shownDrops = -1
  private farHill: SVGPathElement
  private nearHill: SVGPathElement
  private shadow: SVGEllipseElement

  constructor(el: SVGSVGElement, opts: { species: SceneSpecies; readings: boolean }) {
    this.root = el
    this.readingsOn = opts.readings
    const uid = 'ps' + Math.random().toString(36).slice(2, 8)
    const defs = svg('defs', {}, el)
    this.ctx = { uid, defs }
    this.current = opts.species
    const sky = svg('linearGradient', { id: `${uid}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
    this.skyStops = [0, .55, 1].map(offset => svg('stop', { offset }, sky))
    const sunG = svg('radialGradient', { id: `${uid}-sun` }, defs)
    for (const [offset, color, opacity] of [[0, '#fffbe0', 1], [.35, '#ffe9a6', .9], [1, '#ffe9a6', 0]] as const) svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }, sunG)
    const moonG = svg('radialGradient', { id: `${uid}-moon` }, defs)
    svg('stop', { offset: 0, 'stop-color': '#dfeaf2', 'stop-opacity': .55 }, moonG)
    svg('stop', { offset: 1, 'stop-color': '#dfeaf2', 'stop-opacity': 0 }, moonG)
    const shelfG = svg('linearGradient', { id: `${uid}-shelf`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
    this.shelfStops = [0, 1].map(offset => svg('stop', { offset }, shelfG))
    this.nightMatrix = nightFilter(this.ctx)
    svg('rect', { width: 800, height: 560, fill: `url(#${uid}-sky)` }, el)
    const rnd = mulberry(11), stars = svg('g', {}, el)
    this.starEls = Array.from({ length: 46 }, () => ({ el: svg('circle', { cx: f1(rnd() * 800), cy: f1(rnd() * 250), r: f1(.7 + rnd() * 1.1), fill: '#fff' }, stars), tw: rnd() > .55, ph: rnd() * 6 }))
    this.sunHalo = svg('circle', { r: 70, fill: `url(#${uid}-sun)` }, el)
    this.sun = svg('circle', { r: 25, fill: '#fff6cf' }, el)
    this.moonHalo = svg('circle', { r: 64, fill: `url(#${uid}-moon)` }, el)
    this.moon = svg('g', {}, el)
    svg('circle', { r: 21, fill: '#eef3f4' }, this.moon)
    svg('circle', { cx: -6, cy: -4, r: 4.5, fill: '#d2dde2' }, this.moon)
    svg('circle', { cx: 7, cy: 6, r: 3.2, fill: '#d9e3e7' }, this.moon)
    svg('circle', { cx: 5, cy: -9, r: 2.2, fill: '#d9e3e7' }, this.moon)
    // The first three are the clear-day sky; the rest arrive as the cover grows.
    this.clouds = [[70, 120, 1], [420, 82, .8], [640, 168, .9], [240, 60, .9], [540, 140, .75], [760, 96, .8]].map(([x, y, sc]) => {
      const c = svg('g', { fill: '#fff' }, el)
      for (const [cx, cy, rx, ry] of [[0, 0, 44, 15], [28, -9, 34, 15], [-26, -6, 28, 12], [52, 4, 28, 11]]) svg('ellipse', { cx, cy, rx, ry }, c)
      return { c, x, y, sc }
    })
    this.farHill = svg('path', { d: 'M0 330C120 270 240 312 360 286S600 252 800 304V560H0Z' }, el)
    this.nearHill = svg('path', { d: 'M0 404C160 350 300 408 470 374S700 342 800 384V560H0Z' }, el)
    // Weather over the sky and the hills: a grey veil when it clouds over, a warm one when it is hot, then the heat haze.
    this.dimmer = svg('rect', { width: 800, height: 506, fill: '#6f7e88', opacity: 0 }, el)
    this.warmer = svg('rect', { width: 800, height: 506, fill: '#ffb35c', opacity: 0 }, el)
    this.shimmer = [452, 474, 494].map(() => svg('path', { fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0 }, el))
    svg('rect', { x: 0, y: 506, width: 800, height: 60, fill: `url(#${uid}-shelf)` }, el)
    svg('rect', { x: 0, y: 506, width: 800, height: 2, fill: '#fff', opacity: .25 }, el)
    this.shadow = svg('ellipse', { cx: 400, cy: 508, rx: 150, ry: 12, fill: '#000', opacity: .22 }, el)
    const dropClip = svg('clipPath', { id: `${uid}-sky-clip` }, defs)
    svg('rect', { width: 800, height: 506 }, dropClip)
    const rainRnd = mulberry(5), rainLayer = svg('g', { 'clip-path': `url(#${uid}-sky-clip)`, stroke: '#d6e6f2', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, el)
    this.drops = Array.from({ length: 70 }, () => ({ el: svg('line', { 'data-drop': '', opacity: 0 }, rainLayer), x: rainRnd() * 860, speed: 520 + rainRnd() * 260, len: 14 + rainRnd() * 14, phase: rainRnd() }))
    this.layers = svg('g', {}, el)
    this.readingLayer = svg('g', {}, el)
    this.slot(opts.species)
  }

  /** Builds a species' drawing the first time it is needed. */
  private slot(id: SceneSpecies): Slot {
    let s = this.slots.get(id)
    if (s) return s
    const part = MAKERS[id](this.ctx), ty = 506 - part.baseY * part.scale
    part.g.setAttribute('transform', `translate(400 ${f1(ty)}) scale(${part.scale})`)
    this.layers.appendChild(part.g)
    s = { part, ty, day: new Spring(-1, 1.1, 1), alpha: new Spring(id === this.current ? 1 : 0, .55, 1) }
    if (this.readingsOn) this.buildReadings(s)
    this.slots.set(id, s)
    return s
  }

  /** Readings are plain text with a leader line, level with the part they describe: temperature at the device, moisture at
   * the upper probe mark, pH at the lower one. No boxes and no dots. */
  private buildReadings(s: Slot) {
    const g = svg('g', {}, this.readingLayer)
    s.chips = g
    const lx = 400 + s.part.halfW * s.part.scale + 46
    let prev = -1e9
    s.texts = (['t', 'm', 'p'] as const).map(key => {
      const [px, py] = s.part.anchors[key], ax = 400 + px * s.part.scale, ay = s.ty + py * s.part.scale
      const ly = Math.max(ay, prev + 66)
      prev = ly
      const line = svg('path', { d: `M${f1(ax)} ${f1(ay)}L${f1(lx - 12)} ${f1(ly)}H${f1(lx - 6)}`, fill: 'none', 'stroke-width': 1, 'stroke-linecap': 'round' }, g)
      const text = { 'paint-order': 'stroke', 'stroke-linejoin': 'round', 'stroke-width': 3.2 }
      const l = svg('text', { x: lx, y: ly - 3, 'font-size': 12, 'font-weight': 500, class: 'rl', ...text }, g)
      l.textContent = { t: 'Suhu', m: 'Kelembapan', p: 'pH' }[key]
      const v = svg('text', { x: lx, y: ly + 17, 'font-size': 19, 'font-weight': 600, class: 'rv', ...text }, g)
      return { key, l, v, line, text: '', sig: '' }
    })
  }

  /** Sends the app's state to the stage. The first call places everything at once; later calls glide there on springs. */
  set(state: SceneState) {
    if (state.calm !== undefined) this.calm = state.calm
    if (state.weather) this.weather = state.weather
    if (state.contact !== undefined) this.contact = state.contact
    if (state.readings) this.readings = state.readings
    if (state.planted !== undefined) this.planted = state.planted
    if (state.day !== undefined) this.dayTarget = Math.max(0, state.day)
    if (state.moisture !== undefined) { this.wantMoist = clamp(state.moisture, 0, 100); if (this.pourT < 0) this.applyMoisture() }
    if (state.hour !== undefined) this.hour.t = unwrapHour(this.hour.t, state.hour)
    if (state.species && state.species !== this.current) {
      this.current = state.species
      const s = this.slot(state.species)
      for (const [id, o] of this.slots) o.alpha.t = id === state.species ? 1 : 0
      if (this.primed) { s.day.x = -1; s.day.v = 0 }
    }
    this.followWeather(false)
    const cur = this.slot(this.current)
    cur.day.t = this.planted ? this.dayTarget : -1
    if (!this.primed) {
      this.primed = true
      this.hour.snap(this.hour.t); this.moist.snap(this.wantMoist); cur.day.snap(cur.day.t)
      this.followWeather(true)
      for (const [id, o] of this.slots) o.alpha.snap(id === this.current ? 1 : 0)
    }
  }

  /** Plays the watering: the can arrives, the stream falls, the water front moves down the media. The moisture itself
   * comes from `set`, so the picture and the number never disagree. */
  pour() {
    if (motion.reduced || this.pourT >= 0) return
    this.pourT = 0
    this.phase = 0
    this.root.setAttribute('data-pouring', '')
  }
  /** Moves the sky's springs toward the current weather; `snap` places them at once (the first call). */
  private followWeather(snap: boolean) {
    const look = LOOKS[this.weather]
    this.cover.t = look.cloud; this.dim.t = look.dim; this.rain.t = look.rain; this.heat.t = look.heat; this.wind.t = look.wind
    if (snap) for (const spring of [this.cover, this.dim, this.rain, this.heat, this.wind]) spring.snap(spring.t)
    this.root.setAttribute('data-weather', this.weather)
  }
  /** The moisture the plant shows. During a pour it waits for the water to arrive, so the plant never perks up before the can. */
  private applyMoisture() { this.moist.t = this.wantMoist; this.settle.snap(1) }

  frame(dt: number, now: number) {
    for (const s of this.slots.values()) { s.alpha.step(dt); s.day.step(dt) }
    this.moist.step(dt); this.settle.step(dt); this.hour.step(dt); this.canIn.step(dt); this.tilt.step(dt); this.stream.step(dt)
    this.cover.step(dt); this.dim.step(dt); this.rain.step(dt); this.heat.step(dt); this.wind.step(dt)
    if (this.pourT >= 0) {
      this.pourT += dt
      const t = this.pourT
      if (t > .05 && this.phase === 0) { this.canIn.t = 1; this.phase = 1 }
      if (t > .8 && this.phase === 1) { this.tilt.t = 1; this.stream.t = 1; this.phase = 2 }
      if (t > 1 && this.phase === 2) { this.moist.t = this.wantMoist; this.settle.x = 0; this.settle.t = 1; this.settle.v = 0; this.boost = 1; this.phase = 3 }
      if (t > 3 && this.phase === 3) { this.stream.t = 0; this.tilt.t = 0; this.phase = 4 }
      if (t > 3.5 && this.phase === 4) { this.canIn.t = 0; this.phase = 5 }
      if (t > 4.4) { this.pourT = -1; this.moist.t = this.wantMoist; this.root.removeAttribute('data-pouring') }
    }
    this.boost = Math.max(0, this.boost - dt / 4)
    const h = this.hour.x, hm = ((h % 24) + 24) % 24, sky = paletteAt(h), night = nightFactor(h)
    this.night = night
    this.skyStops.forEach((s, i) => s.setAttribute('stop-color', sky[i]))
    this.farHill.setAttribute('fill', sky[3]); this.nearHill.setAttribute('fill', sky[4])
    const sunO = orbit(hm - 6), moonO = orbit((hm + 6) % 24)
    const dimV = clamp(this.dim.x), heatV = clamp(this.heat.x), rainV = clamp(this.rain.x)
    const sunA = sunO.a * (1 - .85 * dimV)
    set(this.sun, { cx: f1(sunO.x), cy: f1(sunO.y), opacity: f1(sunA), r: f1(25 * (1 + .12 * heatV)) })
    set(this.sunHalo, { cx: f1(sunO.x), cy: f1(sunO.y), opacity: f1(sunA), r: f1(70 * (1 + .5 * heatV)) })
    this.moon.setAttribute('transform', `translate(${f1(moonO.x)} ${f1(moonO.y)})`); this.moon.setAttribute('opacity', f1(moonO.a * (1 - .6 * dimV)))
    set(this.moonHalo, { cx: f1(moonO.x), cy: f1(moonO.y), opacity: f1(moonO.a * (1 - .6 * dimV)) })
    for (const s of this.starEls) s.el.setAttribute('opacity', f1(night * night * (1 - .7 * dimV) * (s.tw ? .45 + .55 * Math.pow(Math.sin(now * 1.6 + s.ph), 2) : .85)))
    const still = motion.reduced || this.calm
    const tone = mix('#ffffff', '#8d99a2', dimV)
    this.clouds.forEach((c, i) => {
      set(c.c, { transform: `translate(${f1(still ? c.x : (c.x + now * (3 + i * 1.4)) % 980 - 90)} ${f1(c.y)}) scale(${f1(c.sc * (1 + .25 * dimV))})`, opacity: f1(.82 * clamp(this.cover.x * 6 - i) * (1 - night * .9)), fill: tone })
    })
    this.dimmer.setAttribute('opacity', f1(dimV * .34 * (1 - night * .7)))
    this.warmer.setAttribute('opacity', f1(heatV * .14 * (1 - night)))
    const wanted = dropCount(rainV)
    if (wanted !== this.shownDrops) { this.shownDrops = wanted; this.root.setAttribute('data-drops', String(wanted)) }
    const t = still ? 0 : now
    this.drops.forEach((d, i) => {
      if (i >= wanted) { if (d.el.getAttribute('opacity') !== '0') d.el.setAttribute('opacity', '0'); return }
      const y = (d.phase * 600 + t * d.speed) % 600 - 40, x = d.x - y * .22 - 30
      set(d.el, { x1: f1(x), y1: f1(y), x2: f1(x - d.len * .22), y2: f1(y + d.len), opacity: f1(.55 * (1 - night * .35)) })
    })
    this.shimmer.forEach((p, i) => {
      if (heatV < .02) { if (p.getAttribute('opacity') !== '0') p.setAttribute('opacity', '0'); return }
      const base = 452 + i * 21
      set(p, { d: smoothPath(Array.from({ length: 21 }, (_, k) => [k * 40, base + Math.sin(k * 1.1 + t * 1.6 + i * 2) * 3])), opacity: f1(heatV * .28 * (1 - night)) })
    })
    this.shelfStops[0].setAttribute('stop-color', mix('#d9d4c4', '#3a4640', night)); this.shelfStops[1].setAttribute('stop-color', mix('#bdb7a4', '#202a26', night))
    this.nightMatrix.setAttribute('values', `${f1(1 - .42 * night)} 0 0 0 0 0 ${f1(1 - .35 * night)} 0 0 0 0 0 ${f1(1 - .22 * night)} 0 ${f1(.02 * night)} 0 0 0 1 0`)
    this.shadow.setAttribute('opacity', f1(.2 + night * .15))
    const M = this.moist.x, droop = clamp((40 - M) / 40)
    const frame: FrameState = {
      day: 0, M: M / 100, settle: this.settle.x, t: now, night, droop, boost: this.boost, sway: still ? 0 : this.wind.x,
      pourT: this.pourT, canIn: clamp(this.canIn.x), tilt: clamp(this.tilt.x), stream: clamp(this.stream.x), planted: this.planted, contact: this.contact,
    }
    for (const s of this.slots.values()) {
      const a = s.alpha.x
      if (a < .004) { s.part.g.setAttribute('display', 'none'); s.chips?.setAttribute('display', 'none'); continue }
      s.part.g.removeAttribute('display'); s.part.g.setAttribute('opacity', f1(clamp(a)))
      s.part.update({ ...frame, day: s.day.x })
      if (s.chips && s.texts && this.readings) this.paintReadings(s, a, night)
    }
  }

  private paintReadings(s: Slot, alpha: number, night: number) {
    s.chips?.removeAttribute('display'); s.chips?.setAttribute('opacity', f1(clamp(alpha) ** 3)) // cubed: while two pots cross-fade, the old and new readings must not stand over each other
    const r = this.readings
    if (!r || !s.texts) return
    const dark = night > .5
    const values = { t: r.suhu, m: r.kelembapan, p: r.ph }, alerts = { t: r.alert?.suhu, m: r.alert?.kelembapan, p: r.alert?.ph }
    for (const c of s.texts) {
      if (c.text !== values[c.key]) { c.v.textContent = values[c.key]; c.text = values[c.key] }
      const sig = `${dark ? 'd' : 'l'}${alerts[c.key] ? '!' : ''}`
      if (c.sig === sig) continue
      c.sig = sig
      const halo = dark ? 'rgba(10,18,16,.6)' : 'rgba(246,247,242,.72)'
      c.l.setAttribute('fill', dark ? '#aebcb2' : '#3e4a43'); c.v.setAttribute('fill', alerts[c.key] ? (dark ? '#f0907a' : '#c4553c') : dark ? '#e8ede6' : '#18211b')
      c.l.setAttribute('stroke', halo); c.v.setAttribute('stroke', halo); c.line.setAttribute('stroke', dark ? 'rgba(232,237,230,.5)' : 'rgba(24,33,27,.42)')
    }
  }
}
