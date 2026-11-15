import { bez, clamp, f1, mix, mulberry, ribbon, set, smooth, smoothPath, SH, svg } from './kit.ts'
import { breeze, buildDevice, buildMedia, buildSeed, buildWater, dirOf, growRoots, LEAF_FILL, makeLeaf, placeLeaf, type Ctx, type FrameState, type Part, type RootDef } from './parts.ts'

export type SceneSpecies = 'cabai' | 'bawang' | 'anggrek'

/** The pot group: a night-tinted body (pot, media, plant, device) and a glow layer (LED, water) that stays bright. */
function frame(ctx: Ctx) {
  const g = svg('g'), body = svg('g', { filter: `url(#${ctx.uid}-night)` }, g), glow = svg('g', {}, g)
  return { g, body, glow }
}

export function makeCabai(ctx: Ctx): Part {
  const { g, body, glow } = frame(ctx)
  const outer = 'M-114 -6H114V18H100L80 170Q79 178 70 178H-70Q-79 178 -80 170L-100 18H-114Z', mediaD = 'M-91 8H91L72 158H-72Z'
  svg('path', { d: 'M-104 179H104L112 191Q0 201 -112 191Z', fill: '#c7794f', stroke: '#9c4f31', 'stroke-width': 1.2 }, body)
  const media = buildMedia(ctx, body, mediaD, { x: -92, y: 6, w: 184, h: 154 }, 'soil')
  const rootDefs: RootDef[] = [
    { d: 'M0 8Q4 40 -2 70T2 140', w: 3, from: 0, span: .55 },
    { d: 'M-1 28Q-30 34 -52 56T-78 104', w: 2, from: .12, span: .5 }, { d: 'M1 30Q34 38 56 58T80 108', w: 2, from: .16, span: .5 },
    { d: 'M-2 56Q-24 62 -42 82T-56 128', w: 1.7, from: .3, span: .5 }, { d: 'M2 60Q28 66 46 86T60 126', w: 1.7, from: .34, span: .5 },
    { d: 'M-30 40Q-48 40 -62 36', w: 1.1, from: .4, span: .4 }, { d: 'M34 42Q52 44 66 40', w: 1.1, from: .44, span: .4 },
    { d: 'M-4 92Q-22 98 -34 112', w: 1.2, from: .5, span: .4 }, { d: 'M4 96Q24 102 36 114', w: 1.2, from: .55, span: .4 },
  ]
  const setRoots = growRoots(media.roots, rootDefs, '#e2d3ae', [2])
  svg('path', { d: `${outer} ${mediaD}`, fill: '#dc9168', 'fill-rule': 'evenodd', stroke: '#a85a3a', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, body)
  svg('path', { d: 'M-114 18H-100M100 18H114', stroke: '#b86a48', 'stroke-width': 1.6 }, body)
  svg('path', { d: 'M-108 -2H108', stroke: '#f1b08b', 'stroke-width': 1.4, opacity: .8 }, body)
  const plant = svg('g', {}, body)
  const seed = buildSeed(body, 6)
  const stemGrad = svg('linearGradient', { id: `${ctx.uid}-stem`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 8, x2: 0, y2: -120 }, ctx.defs)
  svg('stop', { offset: 0, 'stop-color': '#8a7a52' }, stemGrad); svg('stop', { offset: .45, 'stop-color': '#5f8a47' }, stemGrad)
  const branches = Array.from({ length: 6 }, () => svg('path', { fill: 'none', stroke: '#5a8745', 'stroke-width': 3, 'stroke-linecap': 'round' }, plant))
  const stem = svg('path', { fill: 'none', stroke: `url(#${ctx.uid}-stem)`, 'stroke-width': 7.5, 'stroke-linecap': 'round' }, plant)
  const fruits = Array.from({ length: 9 }, () => { const f = svg('g', {}, plant); const pod = svg('path', { d: 'M0 0C3 -9 4 -20 1.5 -33C-1 -22 -3 -10 0 0Z', fill: '#7fae4e', stroke: 'rgba(0,0,0,.18)', 'stroke-width': .6 }, f); svg('circle', { r: 2.6, fill: '#4f7f3a' }, f); return { f, pod } })
  const kinds = ['A', 'A2', 'B', 'C'] as const
  const leaves = Array.from({ length: 6 }, (_, k) => kinds.map(kind => ({ k, kind, l: makeLeaf(plant, kind === 'B' || kind === 'C' ? LEAF_FILL.B : LEAF_FILL.A) }))).flat()
  const top = [-1, 1].map(side => ({ side, l: makeLeaf(plant, LEAF_FILL.B) }))
  const low = [-1, 1].map(side => ({ side, l: makeLeaf(plant, LEAF_FILL.A) }))
  const flowers = Array.from({ length: 6 }, () => { const f = svg('g', {}, plant); for (let i = 0; i < 5; i++) svg('ellipse', { cx: 0, cy: -5.5, rx: 3, ry: 5.6, fill: '#fbfaf2', stroke: '#d8d6c0', 'stroke-width': .5, transform: `rotate(${i * 72})` }, f); svg('circle', { r: 2.2, fill: '#e3d98a' }, f); return f })
  const fracs = [.22, .36, .5, .64, .78, .92]
  const device = buildDevice(ctx, body, glow, { x: 60, y0: 2, k: .7 })
  const water = buildWater(ctx, glow, { x: 12, soilY: 6, depth: 150, clipId: media.clipId })
  type Tip = { P: [number, number]; T: [number, number]; side: number; a: number; Lb: number }
  return {
    g, baseY: 197, scale: 1, halfW: 114, anchors: device.anchors,
    update(s: FrameState) {
      media.setWet(s.M, s.settle); setRoots.forEach(r => r(s.day / 62)); device.update(s); water(s); seed(s.planted)
      plant.setAttribute('transform', `rotate(${f1(breeze(s, 1))} 0 8)`)
      const gs = smooth(clamp(s.day / 62)), H = 26 + 204 * gs
      const P0 = [0, 8], P1 = [-9, -H * .35], P2 = [9 + s.droop * 6, -H * .7], P3 = [-3 + s.droop * 18, -H * (1 - s.droop * .06)]
      stem.setAttribute('d', gs < .004 ? 'M0 8L0 7' : `M0 8C${f1(P1[0])} ${f1(P1[1])} ${f1(P2[0])} ${f1(P2[1])} ${f1(P3[0])} ${f1(P3[1])}`)
      const droop = s.droop * 44, tips: Tip[] = []
      const flutter = (x: number, base: number) => base + s.sway * Math.sin(s.t * .6 + x * .03) * .5
      for (let k = 0; k < 6; k++) {
        const a = smooth(clamp((gs - fracs[k] * .78) / .24)), side = k % 2 ? 1 : -1
        const P = bez(P0, P1, P2, P3, fracs[k]), Lb = (86 - k * 9) * a, e = (50 - k * 3) - droop * .4
        const T: [number, number] = [P[0] + side * Lb * Math.cos(e * Math.PI / 180), P[1] - Lb * Math.sin(e * Math.PI / 180)]
        branches[k].setAttribute('d', a < .01 ? '' : `M${f1(P[0])} ${f1(P[1])}C${f1(P[0] + side * Lb * .4)} ${f1(P[1] - 3)} ${f1(T[0] - side * Lb * .25)} ${f1(T[1] + Lb * .22)} ${f1(T[0])} ${f1(T[1])}`)
        const c1 = [P[0] + side * Lb * .4, P[1] - 3], c2 = [T[0] - side * Lb * .25, T[1] + Lb * .22]
        tips[k] = { P, T, side, a, Lb }
        for (const lf of leaves.filter(q => q.k === k)) {
          const at = lf.kind === 'A' ? bez(P, c1, c2, T, .4) : lf.kind === 'A2' ? bez(P, c1, c2, T, .72) : lf.kind === 'C' ? P : T
          const ls = lf.kind === 'C' ? -side : side, len = (64 - k * 3.6) * a * { A: .92, A2: .8, B: 1, C: .78 }[lf.kind]
          const el = { A: e + 38, A2: e + 16, B: e - 6, C: e + 14 }[lf.kind] - droop
          placeLeaf(lf.l, ribbon(at[0], at[1], flutter(at[0], dirOf(ls, el)), len, ls * (12 + s.droop * 26), len * .46, SH.lance, 12), a)
        }
      }
      const topA = smooth(clamp((gs - .62) / .3)), T1 = bez(P0, P1, P2, P3, 1)
      top.forEach(q => { const len = 52 * topA; placeLeaf(q.l, ribbon(T1[0], T1[1], flutter(T1[0], dirOf(q.side, 62 - droop)), len, q.side * (10 + s.droop * 20), len * .45, SH.lance, 12), topA) })
      low.forEach(q => { const lowA = smooth(clamp(gs * 6)), len = 40 * lowA; placeLeaf(q.l, ribbon(0, 2, flutter(0, dirOf(q.side, 22 - droop)), len, q.side * (22 + s.droop * 24), len * .46, SH.lance, 10), lowA) })
      flowers.forEach((f, i) => {
        const tp = i < 5 ? tips[i + 1] : { T: T1, side: 1 }
        const o = smooth(clamp((s.day - (31 + i * 3)) / 9)) * (1 - smooth(clamp((s.day - (56 + i * 3)) / 7)))
        set(f, { transform: `translate(${f1(tp.T[0] + tp.side * 5)} ${f1(tp.T[1] - 7)}) scale(${f1(.4 + o * .9)}) rotate(${f1(tp.side * 14)})`, opacity: f1(clamp(o * 2)) })
      })
      fruits.forEach((q, i) => {
        const tp = tips[1 + (i % 5)], side = tp.side * (i < 5 ? 1 : -1)
        const m = clamp((s.day - (56 + i * 2.5)) / 30), size = smooth(clamp((s.day - (56 + i * 2.5)) / 9))
        const pt = bez(tp.P, [tp.P[0] + tp.side * tp.Lb * .4, tp.P[1] - 3], [tp.T[0] - tp.side * tp.Lb * .25, tp.T[1] + tp.Lb * .22], tp.T, i < 5 ? .46 : .74)
        set(q.f, { transform: `translate(${f1(pt[0])} ${f1(pt[1])}) rotate(${f1(side * (16 + (i % 3) * 7) + s.droop * 30 * side)}) scale(${f1(.9 * size)})`, opacity: f1(clamp(size * 3)) })
        q.pod.setAttribute('fill', m < .5 ? mix('#7fae4e', '#e0a23a', m * 2) : mix('#e0a23a', '#c4472f', (m - .5) * 2))
      })
    },
  }
}

export function makeBawang(ctx: Ctx): Part {
  const { g, body, glow } = frame(ctx)
  const SHIFT = -18 // the clump stands left of centre so the device has its own room
  const outer = 'M-98 -8Q-104 80 -96 148Q-93 176 -66 178H66Q93 176 96 148Q104 80 98 -8Z', mediaD = 'M-90 6Q-96 80 -88 146Q-85 168 -62 170H62Q85 168 88 146Q96 80 90 6Z'
  const media = buildMedia(ctx, body, mediaD, { x: -96, y: 4, w: 192, h: 168 }, 'husk')
  media.roots.setAttribute('transform', `translate(${SHIFT} 0)`)
  const rootDefs: RootDef[] = Array.from({ length: 14 }, (_, i) => { const dir = (i - 6.5) / 6.5, len = 38 + (i % 4) * 22; return { d: `M${f1(dir * 16)} 8Q${f1(dir * 40)} ${f1(len * .45)} ${f1(dir * (30 + len * .55))} ${f1(len + 18)}`, w: 1.15, from: i * .02, span: .45 } })
  const setRoots = growRoots(media.roots, rootDefs, '#f1e7cf', [1.2])
  svg('path', { d: `${outer} ${mediaD}`, fill: '#2d3d33', 'fill-rule': 'evenodd', stroke: '#1b261f', 'stroke-width': 1.4 }, body)
  svg('path', { d: 'M-94 20Q-99 80 -92 140', fill: 'none', stroke: '#5b7a67', 'stroke-width': 1.3, opacity: .8 }, body)
  svg('rect', { x: -108, y: -14, width: 216, height: 24, rx: 12, fill: '#37493d', stroke: '#1b261f', 'stroke-width': 1.3 }, body)
  svg('path', { d: 'M-94 -8H94', stroke: '#6a8a76', 'stroke-width': 1.4, 'stroke-linecap': 'round', opacity: .75 }, body)
  const plant = svg('g', {}, body)
  const seed = buildSeed(body, 5)
  const bulbs = [{ cx: -30, k: .8 }, { cx: 30, k: .84 }, { cx: 0, k: 1 }].map(b => {
    const gb = svg('g', {}, plant)
    return { ...b, gb, d: svg('path', { fill: '#b57681', stroke: '#8e5368', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, gb), lines: svg('path', { fill: 'none', stroke: '#8e5368', 'stroke-width': .9, opacity: .55 }, gb), sheen: svg('path', { fill: '#fff', opacity: .16 }, gb) }
  })
  const rnd = mulberry(5)
  const leaves = Array.from({ length: 11 }, (_, i) => ({ i, l: makeLeaf(plant, mix('#4f8f46', '#6aa650', (i % 4) / 3), '#33642d', '#b6e0a4'), jit: rnd() }))
  const device = buildDevice(ctx, body, glow, { x: 68, y0: 0, k: .68 })
  const water = buildWater(ctx, glow, { x: 22, soilY: 4, depth: 160, clipId: media.clipId })
  return {
    g, baseY: 178, scale: 1.04, halfW: 108, anchors: device.anchors,
    update(s: FrameState) {
      media.setWet(s.M, s.settle); setRoots.forEach(r => r(s.day / 40)); device.update(s); water(s); seed(s.planted)
      plant.setAttribute('transform', `translate(${SHIFT} 0) rotate(${f1(breeze(s, .6))} 0 4)`)
      const gs = smooth(clamp(s.day / 48)), r0 = 6 + 34 * smooth(clamp((s.day - 14) / 46)), ripe = clamp((s.day - 48) / 17)
      for (const b of bulbs) {
        const r = r0 * b.k * (b.k < 1 ? clamp((s.day - 4) / 20) : 1), hb = r * .92, hn = hb + 6 + r * .42, nw = 2 + r * .1
        set(b.gb, { transform: `translate(${b.cx} ${f1(2 - hb * .18)}) rotate(${b.k === 1 ? 0 : (b.cx < 0 ? -9 : 9)})`, opacity: f1(clamp((s.day + 1) / 3)) })
        b.d.setAttribute('d', `M${-nw} ${-hn}C${-nw} ${-hn * .62} ${-r} ${-hb * 1.05} ${-r} ${-hb * .4}C${-r} ${hb * .25} ${-r * .55} ${hb * .5} 0 ${hb * .5}C${r * .55} ${hb * .5} ${r} ${hb * .25} ${r} ${-hb * .4}C${r} ${-hb * 1.05} ${nw} ${-hn * .62} ${nw} ${-hn}Z`)
        b.lines.setAttribute('d', `M${-r * .55} ${-hb * .85}Q${-r * .75} 0 ${-r * .35} ${hb * .4}M${r * .55} ${-hb * .85}Q${r * .75} 0 ${r * .35} ${hb * .4}M0 ${-hb}V${hb * .45}`)
        b.sheen.setAttribute('d', `M${-r * .72} ${-hb * .5}Q${-r * .8} ${hb * .05} ${-r * .55} ${hb * .25}Q${-r * .5} ${-hb * .2} ${-r * .4} ${-hb * .7}Z`)
      }
      for (const q of leaves) {
        const c = (q.i - 5) / 5, side = c < 0 ? -1 : 1, a = smooth(clamp((gs * 1.2 - Math.abs(c) * .14) / .9))
        const len = (46 + 168 * gs) * (.55 + .45 * (1 - Math.abs(c))) * (.86 + q.jit * .22) * a
        const lean = side * (Math.abs(c) * 14 + ripe * 34 * (.5 + q.jit)) + side * s.droop * 48
        const ang = -90 + c * 30 + s.sway * Math.sin(s.t * .62 + q.i * .35) * 1.1
        placeLeaf(q.l, ribbon(c * 20, -10 - r0 * .5, ang, len, lean * 1.3 + (c === 0 ? 8 : 0), 8.4, SH.tube, 14), a)
        q.l.body.setAttribute('fill', mix(mix('#4f8f46', '#6aa650', (q.i % 4) / 3), '#c3bd6a', ripe * .85))
      }
    },
  }
}

export function makeAnggrek(ctx: Ctx): Part {
  const { g, body, glow } = frame(ctx)
  const outer = 'M-90 -2H90L74 126Q72 136 62 136H-62Q-72 136 -74 126Z', mediaD = 'M-86 4H86L71 122Q69 130 60 130H-60Q-69 130 -71 122Z'
  const media = buildMedia(ctx, body, mediaD, { x: -88, y: 2, w: 176, h: 130 }, 'bark')
  const rr = mulberry(21)
  const rootDefs: RootDef[] = Array.from({ length: 7 }, (_, i) => {
    const sx = (i - 3) * 14, pts: number[][] = [[sx, 6]]; let x = sx, y = 6
    for (let k = 0; k < 5; k++) { x += (rr() - .5) * 46 + sx * .06; y += 22 + rr() * 8; x = clamp(x, -70, 70); pts.push([x, y]) }
    return { d: smoothPath(pts), w: 4.4 - (i % 3) * .7, from: i * .05, span: .55 }
  })
  const setRoots = growRoots(media.roots, rootDefs, '#b8c9a8', [4])
  svg('path', { d: `${outer} ${mediaD}`, fill: 'rgba(255,255,255,.26)', 'fill-rule': 'evenodd', stroke: 'rgba(255,255,255,.8)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, body)
  svg('path', { d: 'M-84 14Q-80 70 -70 118', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .5 }, body)
  svg('rect', { x: -94, y: -6, width: 188, height: 9, rx: 4.5, fill: 'rgba(255,255,255,.55)', stroke: 'rgba(255,255,255,.85)', 'stroke-width': .8 }, body)
  const plant = svg('g', {}, body)
  const seed = buildSeed(body, 3)
  const air = Array.from({ length: 5 }, () => ({ r: svg('path', { fill: '#b4c4a6', stroke: '#8da07f', 'stroke-width': .8, 'stroke-linejoin': 'round' }, plant), tip: svg('path', { fill: '#78b45e' }, plant) }))
  const leaves = [0, 1, 2].flatMap(j => [-1, 1].map(side => ({ j, side, l: makeLeaf(plant, mix('#2f6b3d', '#3f8148', j / 2), '#265a31', '#bfe3a8') })))
  const spike = svg('path', { fill: '#7d9457', stroke: '#5f7640', 'stroke-width': .7 }, plant)
  const petal = svg('radialGradient', { id: `${ctx.uid}-pet`, cx: '50%', cy: '55%', r: '60%' }, ctx.defs)
  svg('stop', { offset: 0, 'stop-color': '#ffffff' }, petal); svg('stop', { offset: 1, 'stop-color': '#efe9f2' }, petal)
  const mk = (parent: Element, rx: number, ry: number, cx: number, cy: number, rot: number) => svg('ellipse', { cx, cy, rx, ry, fill: `url(#${ctx.uid}-pet)`, stroke: '#d6cfdc', 'stroke-width': .7, transform: `rotate(${rot} ${cx} ${cy})` }, parent)
  const flowers = Array.from({ length: 7 }, () => {
    const f = svg('g', {}, plant), bud = svg('ellipse', { rx: 4.2, ry: 5.2, fill: '#e3ecc8', stroke: '#9bb07a', 'stroke-width': .7 }, f), open = svg('g', {}, f)
    mk(open, 12, 17, 0, -15, 0); mk(open, 24, 20, -17, -3, 14); mk(open, 24, 20, 17, -3, -14); mk(open, 10, 18, -9, 14, -26); mk(open, 10, 18, 9, 14, 26)
    svg('ellipse', { cx: 0, cy: 6, rx: 7.5, ry: 9.5, fill: '#b0467f', stroke: '#8a2f63', 'stroke-width': .7 }, open)
    svg('ellipse', { cx: 0, cy: 1.5, rx: 4, ry: 3, fill: '#e8c34a' }, open); svg('ellipse', { cx: 0, cy: -4, rx: 2.8, ry: 2.2, fill: '#f6f1d6' }, open)
    return { f, bud, open }
  })
  const device = buildDevice(ctx, body, glow, { x: 54, y0: -2, k: .6 })
  const water = buildWater(ctx, glow, { x: 8, soilY: 2, depth: 130, clipId: media.clipId })
  return {
    g, baseY: 138, scale: 1.3, halfW: 118, anchors: device.anchors,
    update(s: FrameState) {
      media.setWet(s.M, s.settle); setRoots.forEach(r => r(s.day / 56)); device.update(s); water(s); seed(s.planted)
      plant.setAttribute('transform', `rotate(${f1(breeze(s, .35))} 0 0)`)
      const gs = smooth(clamp(s.day / 66)), droop = s.droop * 36, rootK = smooth(clamp(s.day / 50))
      air.forEach((a, i) => {
        const side = i % 2 ? 1 : -1, len = (96 + i * 18) * rootK
        const rb = ribbon(side * (6 + i * 6), 2, side > 0 ? -16 + i * 4 : 196 - i * 4, len, side * (86 + i * 6), 6.6, SH.thin, 14)
        a.r.setAttribute('d', len < 3 ? '' : rb.d)
        a.tip.setAttribute('d', len < 6 ? '' : `M${f1(rb.tip[0] - 3)} ${f1(rb.tip[1] - 1)}Q${f1(rb.tip[0])} ${f1(rb.tip[1] + 6)} ${f1(rb.tip[0] + 3)} ${f1(rb.tip[1] - 1)}Z`)
      })
      for (const q of leaves) {
        const a = smooth(clamp(gs * 1.7 - q.j * .38)), len = [150, 128, 100][q.j] * a, elev = [8, 24, 46][q.j] - droop * .6
        placeLeaf(q.l, ribbon(q.side * 4, -6 - q.j * 14, dirOf(q.side, elev) + s.sway * Math.sin(s.t * .5 + q.j * .4) * .45, len, q.side * ([46, 40, 30][q.j] + droop * 1.3), [46, 40, 32][q.j] * a, SH.oval, 16), a)
      }
      const sp = smooth(clamp((s.day - 34) / 40)), spLen = 30 + 170 * sp
      const sr = ribbon(5, -40, -82, spLen, 62, 3.6, SH.thin, 16)
      spike.setAttribute('d', sp < .01 ? '' : sr.d)
      flowers.forEach((q, i) => {
        const t = clamp(.3 + i * .118, 0, .99), pt = sr.pts[Math.round(t * (sr.pts.length - 1))], side = i % 2 ? 1 : -1
        const o = smooth(clamp((s.day - (46 + i * 4)) / 14)), visible = sp > .02 && (t * sp > .12 || i > 4) && spLen * t > 40
        set(q.f, { transform: `translate(${f1(pt[0] + side * 7)} ${f1(pt[1] + 4)}) rotate(${f1(side * 8 + s.sway * Math.sin(s.t * .55 + i * .5) * 1.1)}) scale(${f1((1 - i * .07) * .9 * (.4 + .6 * o))})`, opacity: visible ? 1 : 0 })
        q.bud.setAttribute('opacity', f1(1 - clamp(o * 3)))
        set(q.open, { opacity: f1(clamp(o * 1.6 - .1)), transform: `scale(${f1(.25 + .75 * o)})` })
      })
    },
  }
}

export const MAKERS: Record<SceneSpecies, (ctx: Ctx) => Part> = { cabai: makeCabai, bawang: makeBawang, anggrek: makeAnggrek }
