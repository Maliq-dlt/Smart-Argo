import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

/** Expressions the mascot can wear. Callers map their own state onto one (sign-in field, rule status). */
export type Face = 'smile' | 'joy' | 'happy' | 'shy' | 'sad' | 'think' | 'flat' | 'worry' | 'curious'
const spring = { type: 'spring', stiffness: 260, damping: 22 } as const
const mouths: Record<Face, string> = {
  smile: 'M74 117Q80 123 86 117',
  joy: 'M72.5 115Q80 127 87.5 115Z',
  happy: 'M72.5 115Q80 127 87.5 115Z',
  shy: 'M75 119.5Q77.5 117.5 80 119.5Q82.5 121.5 85 119.5', // a small wavy, embarrassed smile
  sad: 'M74.5 121.5Q80 116.5 85.5 121.5',
  think: 'M77 119.5Q80.5 117.5 84 119.5',
  flat: 'M75 119.5H85',
  worry: 'M77.2 119.5a2.8 2.8 0 1 0 5.6 0a2.8 2.8 0 1 0 -5.6 0',
  curious: 'M75.5 118.5Q80.5 121.5 85 117',
}
const openMouth = (face: Face) => face === 'joy' || face === 'happy'
// Inner ends raised for sad and worried brows; none otherwise.
const brows: Partial<Record<Face, string>> = { sad: 'M58.5 94L70 91M90 91L101.5 94', worry: 'M59 93L70 90.5M90 90.5L101 93' }
const smiling = (cx: number) => `M${cx - 6.5} 106Q${cx} 98.5 ${cx + 6.5} 106` // ^ : eyes closed with joy
const shut = (cx: number) => `M${cx - 6.5} 103.5Q${cx} 109.5 ${cx + 6.5} 103.5` // u : eyes squeezed shut

interface Props {
  face?: Face
  /** Where the open eyes look, -1..1 on each axis (right and down are positive). */
  look?: { x: number; y: number }
  /** Leaf hands over shut eyes (passwords and codes). Now and then the right hand slips and an eye peeks. */
  hide?: boolean
  hands?: boolean
  /** A bud opens on the seedling (a success). */
  bud?: boolean
  className?: string
}

/** Smart Agro's mascot: a terracotta pot with a seedling, big glossy eyes and blush. It blinks and its seedling
 * sways (without reduced motion). Decorative; the surrounding UI states in words what the face shows. */
export default function Mascot({ face = 'smile', look = { x: 0, y: 0 }, hide = false, hands = hide, bud = false, className = '' }: Props) {
  const [peek, setPeek] = useState(false)
  useEffect(() => {
    if (!hide || !matchMedia('(prefers-reduced-motion: no-preference)').matches) return
    let close = 0
    const timer = window.setInterval(() => { setPeek(true); close = window.setTimeout(() => setPeek(false), 1100) }, 3400)
    return () => { window.clearInterval(timer); window.clearTimeout(close); setPeek(false) }
  }, [hide])
  const shown: Face = hide ? 'shy' : face

  const eye = (cx: number) => <g key={cx}>
    <ellipse className="mascot-eye" cx={cx} cy="104" rx="6.4" ry="7.4" />
    <circle className="mascot-glint" cx={cx - 2.1} cy="101.3" r="2.3" />
    <circle className="mascot-glint" cx={cx + 2.2} cy="106.6" r="1.1" />
  </g>
  const hand = (x: number, flip: boolean, slip: boolean) => <g transform={`translate(${x} 111)${flip ? ' scale(-1 1)' : ''}`}>
    <motion.g initial={false} animate={{ rotate: hide ? (slip ? 22 : -16) : 118 }} transition={spring} style={{ originX: 0, originY: 0.5 }}>
      <path className="mascot-leaf" d="M0 0C6 -9 19 -10 27 -2C19 6 6 7 0 0Z" />
      <path className="mascot-vein" d="M3 -.5H21" />
    </motion.g>
  </g>

  return <svg className={`mascot ${className}`} viewBox="18 16 124 140" aria-hidden="true" data-face={shown} data-peek={peek || undefined}>
    <ellipse className="mascot-shadow" cx="80" cy="150" rx="38" ry="4.5" />
    <motion.g initial={false} animate={{ y: shown === 'happy' ? [0, -7, 0] : 0 }} transition={{ duration: .5, ease: 'easeOut' }}>
      <motion.g initial={false} animate={{ rotate: shown === 'sad' ? -14 : 0 }} transition={spring} style={{ originX: 0.5, originY: 1 }}>
        <g className="mascot-sprout">
          <path className="mascot-stem" d="M80 72C80 60 79 52 80 43" />
          <path className="mascot-leaf is-light" d="M79.5 56C66 58 56 50 57 37C70 35 79.5 43 79.5 56Z" />
          <path className="mascot-leaf" d="M80.5 48C81.5 34 92 26 106 28C106 42 96 50 80.5 48Z" />
          <path className="mascot-vein" d="M78 54L63 41M82 46L99 33" />
          <motion.g initial={false} animate={{ scale: bud ? 1 : 0 }} transition={spring} style={{ originX: 0.5, originY: 1 }}>
            {[0, 72, 144, 216, 288].map(deg => <ellipse key={deg} className="mascot-petal" cx="80" cy="36" rx="3.2" ry="5" transform={`rotate(${deg} 80 41)`} />)}
            <circle className="mascot-bud" cx="80" cy="41" r="3" />
          </motion.g>
        </g>
      </motion.g>
      <path className="mascot-pot" d="M41 80H119L112.5 133Q110.5 146 97 146H63Q49.5 146 47.5 133Z" />
      <path className="mascot-shine" d="M51 89L54.5 128" />
      <rect className="mascot-rim" x="34" y="70" width="92" height="18" rx="9" />
      <ellipse className="mascot-cheek" cx="56" cy="116" rx="6.5" ry="4" />
      <ellipse className="mascot-cheek" cx="104" cy="116" rx="6.5" ry="4" />
      {shown === 'happy' ? <path className="mascot-line" d={`${smiling(66)}${smiling(94)}`} />
        : shown === 'shy' ? <>
          <path className="mascot-line" d={peek ? shut(66) : `${shut(66)}${shut(94)}`} />
          {/* The peek: the right eye opens a crack toward the password field, then shuts again. */}
          {peek && <motion.g initial={{ scaleY: .2, opacity: 0 }} animate={{ scaleY: 1, opacity: 1 }} transition={{ duration: .15 }} style={{ originX: 0.5, originY: 0.5 }}>
            <g transform="translate(96 107) scale(.8) translate(-96 -104)">{eye(96)}</g>
          </motion.g>}
        </>
        : <motion.g initial={false} animate={{ x: look.x * 3, y: look.y * 2.4 }} transition={spring}>
          <g className="mascot-blink">{eye(66)}{eye(94)}</g>
        </motion.g>}
      {brows[shown] && <path className="mascot-line is-thin" d={brows[shown]} />}
      <motion.path key={shown} className={openMouth(shown) ? 'mascot-mouth' : 'mascot-line'} d={mouths[shown]}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} />
      {hands && <>{hand(42, false, false)}{hand(118, true, peek)}</>}
    </motion.g>
  </svg>
}
