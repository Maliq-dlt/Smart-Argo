/* Cross-section of a potted chili plant for the "problem" scene, drawn as vectors so it can draw itself
 * on scroll. Shapes come from a few parameters (leaf length, width and bend; pod length and curve; a seeded
 * branching root system), which keeps the drawing organic without hand-tracing hundreds of points. */

type Pt = [number, number]
const f = (n: number) => Math.round(n * 10) / 10
const p = ([x, y]: Pt) => `${f(x)} ${f(y)}`

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A lance-shaped leaf from its base along `deg`, with a midrib and three pairs of side veins. */
function leaf(x: number, y: number, deg: number, len: number, w: number, bend = 0) {
  const a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx
  const at = (t: number, o: number): Pt => [x + dx * len * t + nx * o, y + dy * len * t + ny * o]
  const curve = (t: number) => bend * len * .34 * t * t
  const shape = `M${f(x)} ${f(y)}C${p(at(.26, w * 1.08 + curve(.26)))} ${p(at(.74, w * .66 + curve(.74)))} ${p(at(1, curve(1)))}C${p(at(.74, -w * .62 + curve(.74)))} ${p(at(.26, -w * 1.02 + curve(.26)))} ${f(x)} ${f(y)}Z`
  const midrib = `M${f(x)} ${f(y)}Q${p(at(.5, curve(.5) * 1.1))} ${p(at(.93, curve(.93)))}`
  const veins = [.28, .46, .64].flatMap(t => [1, -1].map(side =>
    `M${p(at(t, curve(t)))}Q${p(at(t + .06, side * w * .38 + curve(t + .06)))} ${p(at(t + .17, side * w * .66 * (1 - t * .55) + curve(t + .17)))}`))
  return { shape, midrib, veins }
}

/** A chili pod hanging from (x, y), with its stalk, calyx cap and a soft highlight. */
function pod(x: number, y: number, len: number, w: number, curve: number) {
  const h = w / 2
  return {
    stalk: `M${f(x)} ${f(y - 1)}Q${f(x - 3)} ${f(y - 8)} ${f(x + 1)} ${f(y - 15)}`,
    body: `M${f(x - h)} ${f(y + 4)}C${f(x - h)} ${f(y + len * .46)} ${f(x + curve * .6 - w * .3)} ${f(y + len * .84)} ${f(x + curve)} ${f(y + len)}C${f(x + curve + w * .28)} ${f(y + len * .78)} ${f(x + h)} ${f(y + len * .44)} ${f(x + h)} ${f(y + 4)}Z`,
    calyx: `M${f(x - h - 3)} ${f(y + 6)}Q${f(x - h)} ${f(y - 2)} ${f(x)} ${f(y - 1)}Q${f(x + h)} ${f(y - 2)} ${f(x + h + 3)} ${f(y + 6)}Q${f(x)} ${f(y + 3)} ${f(x - h - 3)} ${f(y + 6)}Z`,
    shine: `M${f(x - w * .16)} ${f(y + len * .16)}Q${f(x - w * .24)} ${f(y + len * .45)} ${f(x + curve * .3 - w * .08)} ${f(y + len * .7)}`,
  }
}

const SOIL_TOP = 368
const soilEdge = (y: number) => { const t = (y - SOIL_TOP) / (578 - SOIL_TOP); return [76 + 20 * t, 324 - 20 * t] as const }

function rootSystem() {
  const rnd = mulberry32(11), out: { d: string; w: number }[] = []
  const grow = (x: number, y: number, deg: number, len: number, depth: number, width: number) => {
    const a = deg * Math.PI / 180, bend = (rnd() - .5) * .5
    const end: Pt = [x + Math.cos(a) * len, y + Math.sin(a) * len]
    const ctl: Pt = [x + Math.cos(a + bend) * len * .55, y + Math.sin(a + bend) * len * .55]
    out.push({ d: `M${f(x)} ${f(y)}Q${p(ctl)} ${p(end)}`, w: f(width) })
    if (!depth) return
    for (let i = 0, n = depth >= 3 ? 3 : 2; i < n; i++) {
      const t = .4 + rnd() * .55, u = 1 - t
      const sx = u * u * x + 2 * u * t * ctl[0] + t * t * end[0], sy = u * u * y + 2 * u * t * ctl[1] + t * t * end[1]
      // Roots spread sideways near the top and turn downward with depth.
      const child = deg + (rnd() - .5) * 66 + (90 - deg) * .25
      grow(sx, sy, child, len * (.5 + rnd() * .28), depth - 1, width * .66)
    }
  }
  grow(200, SOIL_TOP + 2, 90, 74, 4, 3)
  grow(198, SOIL_TOP + 6, 152, 58, 3, 2.3)
  grow(202, SOIL_TOP + 6, 28, 58, 3, 2.3)
  grow(199, SOIL_TOP + 26, 124, 46, 2, 1.8)
  grow(201, SOIL_TOP + 28, 58, 46, 2, 1.8)
  return out
}

function soilSpecks() {
  const rnd = mulberry32(5), out: { x: number; y: number; r: number; k: number }[] = []
  for (let i = 0; i < 90; i++) {
    const y = SOIL_TOP + 8 + rnd() * 196, [l, r] = soilEdge(y)
    out.push({ x: f(l + 6 + rnd() * (r - l - 12)), y: f(y), r: f(.8 + rnd() * 2.6), k: Math.floor(rnd() * 3) })
  }
  return out
}

const stems = [
  { d: 'M200 368C204 316 194 268 199 214S203 150 197 104', w: 6 },
  { d: 'M199 318C186 302 168 290 148 282', w: 3.6 },
  { d: 'M200 288C218 272 238 262 262 256', w: 3.6 },
  { d: 'M198 240C184 226 168 214 150 208', w: 3.2 },
  { d: 'M200 214C216 198 232 188 250 182', w: 3.2 },
  { d: 'M198 168C188 158 178 150 166 146', w: 2.6 },
  { d: 'M199 150C210 140 220 134 232 132', w: 2.4 },
]
// Leaves and pods are drawn a little larger than their nominal size so the plant holds its own against the pot.
const big = (x: number, y: number, deg: number, len: number, w: number, bend = 0) => leaf(x, y, deg, len * 1.38, w * 1.34, bend)
const leaves = [
  big(148, 282, 196, 66, 18, .5), big(170, 296, 128, 50, 14, -.4), big(262, 256, -14, 70, 19, -.5), big(236, 266, 58, 48, 13, .45),
  big(150, 208, 204, 60, 16, .45), big(170, 220, 244, 44, 12, -.3), big(250, 182, -24, 60, 16, -.45), big(228, 194, -68, 42, 12, .3),
  big(166, 146, 214, 44, 12, .4), big(232, 132, -32, 44, 12, -.4), big(197, 106, -92, 42, 11, .2), big(197, 112, -58, 34, 10, -.2),
  big(197, 112, -124, 34, 10, .25), big(200, 340, 18, 52, 14, -.35), big(200, 330, 162, 48, 13, .35), big(199, 262, 102, 36, 10, .3),
  big(176, 250, 160, 40, 11, .3), big(224, 232, 20, 40, 11, -.3), big(184, 186, 150, 34, 10, .3), big(214, 170, 30, 34, 10, -.3),
]
const pods = [
  { ...pod(160, 290, 70, 12, 10), ripe: true }, { ...pod(246, 266, 76, 12, -12), ripe: true },
  { ...pod(236, 192, 56, 11, 8), ripe: false }, { ...pod(178, 218, 62, 11, -8), ripe: true },
]
const flowers = [{ x: 214, y: 156, r: 8 }, { x: 186, y: 250, r: 7 }, { x: 160, y: 196, r: 6 }]
const roots = rootSystem(), specks = soilSpecks()
const cracks = ['M120 498l12 10-6 12 10 10', 'M158 540l8-12 12 4 6-12', 'M236 506l-8 12 10 8-4 14', 'M270 548l10-8 4 12 12-6', 'M196 562l-6-12 10-8']

export default function PlantArt() {
  return <svg className="v5-plant" viewBox="0 0 400 610" role="img" aria-label="Penampang pot terakota: tanaman cabai berbuah di atas, akar bercabang di dalam tanah, dan bagian bawah zona akar mulai kering">
    <defs>
      <clipPath id="v5-soil-clip"><path d="M76 368H324L304 578H96Z" /></clipPath>
      <linearGradient id="v5-pot-grad" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--pot-light)' }} /><stop offset=".55" style={{ stopColor: 'var(--pot)' }} /><stop offset="1" style={{ stopColor: 'var(--pot-dark)' }} />
      </linearGradient>
      <linearGradient id="v5-soil-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--soil-top)' }} /><stop offset="1" style={{ stopColor: 'var(--soil)' }} />
      </linearGradient>
    </defs>
    <ellipse className="v5-pot-shadow" cx="200" cy="598" rx="134" ry="8" />
    <path className="v5-pot-body" d="M62 360H338L314 584Q312 594 302 594H98Q88 594 86 584Z" />
    <path className="v5-soil" d="M76 368H324L304 578H96Z" />
    <g clipPath="url(#v5-soil-clip)">
      {specks.map((s, i) => <circle key={i} className={`v5-speck v5-speck-${s.k}`} cx={s.x} cy={s.y} r={s.r} />)}
      <rect className="v5-dry" x="70" y="452" width="260" height="130" />
      {cracks.map(d => <path key={d} className="v5-crack" d={d} fill="none" />)}
      {roots.map((r, i) => <path key={i} className="v5-root-line" d={r.d} fill="none" style={{ strokeWidth: r.w }} />)}
    </g>
    <rect className="v5-rim" x="52" y="342" width="296" height="28" rx="7" />
    <path className="v5-rim-shine" d="M62 349H338" fill="none" />
    <g className="v5-zone"><path d="M356 452v124" fill="none" /><path d="M350 452h12M350 576h12" fill="none" /></g>
    {stems.map(s => <path key={s.d} className="v5-draw-line v5-stem" d={s.d} fill="none" style={{ strokeWidth: s.w }} />)}
    {pods.map((pd, i) => <g key={i} className={pd.ripe ? 'v5-pod is-ripe' : 'v5-pod'}>
      <path className="v5-draw-line v5-pod-stalk" d={pd.stalk} fill="none" />
      <path className="v5-draw-line v5-draw-fill v5-pod-body" d={pd.body} />
      <path className="v5-draw-line v5-draw-fill v5-pod-calyx" d={pd.calyx} />
      <path className="v5-draw-vein v5-pod-shine" d={pd.shine} fill="none" />
    </g>)}
    {leaves.map((l, i) => <g key={i} className={i % 3 === 1 ? 'v5-leaf is-light' : 'v5-leaf'}>
      <path className="v5-draw-line v5-draw-fill v5-leaf-shape" d={l.shape} />
      <path className="v5-draw-vein" d={l.midrib} fill="none" />
      {l.veins.map(v => <path key={v} className="v5-draw-vein v5-vein" d={v} fill="none" />)}
    </g>)}
    {flowers.map(fl => <g key={fl.x} className="v5-flower">
      {[0, 72, 144, 216, 288].map(deg => <ellipse key={deg} className="v5-draw-line v5-draw-fill v5-petal" cx={fl.x} cy={fl.y - fl.r} rx={fl.r * .55} ry={fl.r} transform={`rotate(${deg} ${fl.x} ${fl.y})`} />)}
      <circle className="v5-draw-fill v5-flower-eye" cx={fl.x} cy={fl.y} r={fl.r * .36} />
    </g>)}
  </svg>
}
