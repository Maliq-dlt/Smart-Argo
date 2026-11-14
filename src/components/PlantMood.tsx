import Mascot, { type Face } from './Mascot'
import { MOOD_LABEL as moods } from '../lib/mascot'
const faces: Record<keyof typeof moods, { face: Face; look: { x: number; y: number } }> = {
  ready: { face: 'smile', look: { x: 0, y: 0 } },
  calm: { face: 'curious', look: { x: .3, y: 0 } },
  care: { face: 'flat', look: { x: 0, y: .6 } },
  alert: { face: 'worry', look: { x: 0, y: -.4 } },
  unknown: { face: 'think', look: { x: .8, y: -.8 } },
}

/** The simulator's mascot (the same character as the sign-in guard), worn as the top bar's avatar. Its face follows
 * the rule status (settled against noise in lib/mascot.ts), never a measured plant emotion or health. */
export default function PlantMood({ mood }: { mood: keyof typeof moods }) {
  const label = `Mood tanaman: ${moods[mood]}. Ekspresi mengikuti status aturan, bukan diagnosis kesehatan tanaman.`
  return <figure className="plant-mood" data-mood={mood} title={label}>
    <Mascot {...faces[mood]} />
    <figcaption className="sr-only">{label}</figcaption>
  </figure>
}
