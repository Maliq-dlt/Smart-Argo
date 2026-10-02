import { useRef, useState } from 'react'
import { useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion'

export interface ReadingRevealProps { text: string }

// Adapted from waleedkibhen: https://21st.dev/@waleedkibhen/components/reading-text-reveal
export default function ReadingReveal({ text }: ReadingRevealProps) {
  const root = useRef<HTMLParagraphElement>(null)
  const reduced = useReducedMotion()
  const words = text.split(/\s+/)
  const [revealed, setRevealed] = useState(0)
  const { scrollYProgress } = useScroll({ target: root, offset: ['start 85%', 'end 55%'] })
  useMotionValueEvent(scrollYProgress, 'change', value => setRevealed(Math.ceil(value * words.length)))
  return <p className="reading-reveal" ref={root} data-revealed={reduced ? words.length : revealed}>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{words.map((word, index) => <span key={index} className={!reduced && index >= revealed ? 'is-unread' : undefined}>{word}{' '}</span>)}</span>
  </p>
}
