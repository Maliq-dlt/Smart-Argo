import { ChiliPlant } from './PlantArt'

/* The garden behind the leaf reveal: a chili and a shallot pot on a mossy ledge under a low sun, drawn as vectors so
 * it stays sharp at any size (it replaced a video clip). Colours come from the --garden-* and --shallot tokens. */

type Pt = [number, number]
const f = (n: number) => Math.round(n * 10) / 10
const p = ([x, y]: Pt) => `${f(x)} ${f(y)}`

/** A slender tapering blade from (x, y) along `deg`, curving sideways by `bend` towards its tip. */
function blade(x: number, y: number, deg: number, len: number, w: number, bend: number) {
  const a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx
  const at = (t: number, o: number): Pt => { const s = o + bend * len * t * t * .3; return [x + dx * len * t + nx * s, y + dy * len * t + ny * s] }
  return `M${p(at(0, w))}Q${p(at(.55, w * .7))} ${p(at(1, 0))}Q${p(at(.55, -w * .7))} ${p(at(0, -w))}Z`
}

/** A shallot bulb standing on (x, y): a teardrop with a short neck. */
const bulb = (x: number, y: number, w: number, h: number) =>
  `M${f(x)} ${f(y)}C${f(x - w)} ${f(y)} ${f(x - w * .9)} ${f(y - h * .62)} ${f(x - w * .12)} ${f(y - h)}L${f(x + w * .12)} ${f(y - h)}C${f(x + w * .9)} ${f(y - h * .62)} ${f(x + w)} ${f(y)} ${f(x)} ${f(y)}Z`

const SOIL = 632 // top of the soil in both pots
const CHILI = .74 // the problem scene's chili, scaled to these pots
const shallotLeaves = [
  [-112, 210, -.5], [-100, 250, -.3], [-94, 228, .2], [-86, 262, .1], [-80, 236, .4], [-72, 205, .5], [-104, 180, .6], [-90, 196, -.6], [-76, 172, -.2],
].map(([deg, len, bend], i) => blade(902 + (i % 3) * 13, SOIL - 22, deg, len * .9, 6.5, bend))
const bulbs = [bulb(894, SOIL + 6, 26, 40), bulb(930, SOIL + 6, 24, 36), bulb(912, SOIL + 8, 28, 46)]

/** A terracotta pot whose base stands on (x, 760). Its rim is drawn separately, in front of the plant's base. */
function Pot({ x }: { x: number }) {
  return <g transform={`translate(${x} 760)`}>
    <ellipse className="v5-garden-shadow" cx="0" cy="2" rx="104" ry="10" />
    <path className="v5-garden-pot" d="M-75 -122H75L57 -7Q55 0 48 0H-48Q-55 0 -57 -7Z" />
    <path className="v5-garden-pot-side" d="M28 -122H75L57 -7Q55 0 48 0H18Z" />
    <path className="v5-garden-soil" d="M-70 -128Q0 -150 70 -128Z" />
  </g>
}
const Rim = ({ x }: { x: number }) => <rect className="v5-garden-rim" x={x - 83} y="624" width="166" height="22" rx="6" />
const POTS = [690, 915]

export default function GardenArt() {
  return <svg className="v5-garden" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="v5-garden-sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--garden-sky-a)' }} /><stop offset=".72" style={{ stopColor: 'var(--garden-sky-b)' }} />
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#v5-garden-sky)" />
    <circle className="v5-garden-sun is-halo" cx="1130" cy="300" r="200" />
    <circle className="v5-garden-sun" cx="1130" cy="300" r="96" />
    <path className="v5-garden-hill" d="M0 560C260 470 520 520 760 500S1260 430 1600 520V900H0Z" />
    <path className="v5-garden-hill is-near" d="M0 650C300 590 600 640 900 610S1400 570 1600 640V900H0Z" />
    <path className="v5-garden-ground" d="M0 735C400 712 1200 712 1600 735V900H0Z" />
    {POTS.map(x => <Pot key={x} x={x} />)}
    {/* The chili from the problem scene, scaled to the pot (its stem base sits at 200, 368). */}
    <g className="v5-sway"><g transform={`translate(${f(POTS[0] - 200 * CHILI)} ${f(SOIL - 368 * CHILI)}) scale(${CHILI})`}><ChiliPlant /></g></g>
    <g className="v5-sway is-slow"><ShallotPlant /></g>
    {POTS.map(x => <Rim key={x} x={x} />)}
  </svg>
}

/** The shallot in this scene's right-hand pot (centre about 912, soil at SOIL), also used by the ask-the-engine pot. */
export function ShallotPlant() {
  return <g>
    {shallotLeaves.map(d => <path key={d} className="v5-draw-line v5-draw-fill v5-shallot-leaf" d={d} />)}
    {bulbs.map(d => <path key={d} className="v5-draw-line v5-draw-fill v5-shallot" d={d} />)}
  </g>
}
