import { motion } from 'framer-motion'

const moods = { ready: 'Semangat', calm: 'Santai', care: 'Serius', unknown: 'Penasaran' }

export default function PlantMood({ mood }: { mood: keyof typeof moods }) {
  return <figure className="plant-mood" data-mood={mood} title="Ekspresi mengikuti status simulasi, bukan diagnosis kesehatan tanaman.">
    <span>Mood tanaman</span>
    <svg viewBox="0 0 160 146" aria-hidden="true">
      <ellipse cx="80" cy="133" rx="42" ry="5" fill="var(--forest-line)" />
      <path d="M80 81V44" fill="none" stroke="var(--stem)" strokeWidth="4" strokeLinecap="round" />
      <path d="M80 63C52 63 44 42 48 27C70 29 83 42 80 63Z" fill="var(--leaf-light)" />
      <path d="M80 51C81 30 96 19 115 23C115 45 102 56 80 51Z" fill="var(--leaf)" />
      <path d="M80 62L57 37M81 49L104 30" fill="none" stroke="var(--leaf-vein)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M44 78H116L108 122Q80 136 52 122Z" fill="var(--pot)" />
      <rect x="41" y="73" width="78" height="12" rx="5" fill="var(--pot-light)" />
      <g fill="var(--soil-wet)" stroke="var(--soil-wet)" strokeLinecap="round">
        <circle cx={mood === 'unknown' ? 69 : 66} cy="98" r="2.5" /><circle cx={mood === 'unknown' ? 96 : 93} cy="98" r="2.5" />
        <motion.path key={mood} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .18 }} fill="none" strokeWidth="2.5"
          d={mood === 'care' ? 'M73 112H87' : mood === 'unknown' ? 'M78 110Q85 106 87 111' : 'M70 109Q80 120 90 109'} />
      </g>
    </svg>
    <figcaption><strong>{moods[mood]}</strong><small>Maskot simulasi</small></figcaption>
  </figure>
}
