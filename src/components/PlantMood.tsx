import { motion } from 'framer-motion'

const moods = { ready: 'Semangat', calm: 'Santai', care: 'Perlu perhatian', alert: 'Waspada', unknown: 'Menunggu data' }

// Mouth per mood: smile, flat line, wavy (unsure), small open "o" (alert).
const mouth = { ready: 'M70 109Q80 120 90 109', calm: 'M70 109Q80 120 90 109', care: 'M73 112H87', unknown: 'M78 110Q85 106 87 111', alert: 'M76 113a4 4 0 1 0 8 0a4 4 0 1 0 -8 0' }

/** The simulator's mascot, worn as the top bar's avatar. Its face follows the rule status (settled against noise
 * in lib/mascot.ts), never a measured plant emotion or health. */
export default function PlantMood({ mood }: { mood: keyof typeof moods }) {
  const label = `Mood tanaman: ${moods[mood]}. Ekspresi mengikuti status aturan, bukan diagnosis kesehatan tanaman.`
  return <figure className="plant-mood" data-mood={mood} title={label}>
    <svg viewBox="28 14 104 128" aria-hidden="true">
      <path d="M80 81V44" fill="none" stroke="var(--stem)" strokeWidth="4" strokeLinecap="round" />
      <path d="M80 63C52 63 44 42 48 27C70 29 83 42 80 63Z" fill="var(--leaf-light)" />
      <path d="M80 51C81 30 96 19 115 23C115 45 102 56 80 51Z" fill="var(--leaf)" />
      <path d="M80 62L57 37M81 49L104 30" fill="none" stroke="var(--leaf-vein)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M44 78H116L108 122Q80 136 52 122Z" fill="var(--pot)" />
      <rect x="41" y="73" width="78" height="12" rx="5" fill="var(--pot-light)" />
      <g fill="var(--soil-wet)" stroke="var(--soil-wet)" strokeLinecap="round">
        <circle cx={mood === 'unknown' ? 69 : 66} cy="98" r="3" /><circle cx={mood === 'unknown' ? 96 : 93} cy="98" r="3" />
        {mood === 'alert' && <path d="M60 90L70 93M100 90L90 93" fill="none" strokeWidth="2.5" />}
        <motion.path key={mood} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} fill="none" strokeWidth="3" d={mouth[mood]} />
      </g>
    </svg>
    <figcaption className="sr-only">{label}</figcaption>
  </figure>
}
