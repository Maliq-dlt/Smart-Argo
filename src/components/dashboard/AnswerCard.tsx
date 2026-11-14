import type { MouseEvent, ReactNode } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { MOOD_LABEL } from '../../lib/mascot'
import PlantMood from '../PlantMood'

export interface AnswerRow { icon: ReactNode; label: string; value: string }

/** The first thing to read: what the rules advise and why, in the engine's own words, with at most three supporting
 * facts. Moisture, temperature and pH are on the stage and in the chart, so they are not repeated here. */
export default function AnswerCard({ tone, mood, action, reason, rows, openLabel, onOpen }: {
  tone: 'calm' | 'care' | 'blocked'; mood: keyof typeof MOOD_LABEL; action: string; reason: string; rows: AnswerRow[]; openLabel: string
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const words = action.split(' '), last = words.pop()
  return <section className={`panel dashboard-care tone-${tone}`} aria-labelledby="care-title">
    <div className="answer-mood"><PlantMood mood={mood} /><div><b>Mood tanaman: {MOOD_LABEL[mood]}</b><small>Ekspresi mengikuti status aturan, bukan diagnosis</small></div></div>
    <h3 id="care-title">{words.join(' ')}{words.length ? ' ' : ''}<em>{last}</em></h3>
    <p>{reason}</p>
    {rows.length > 0 && <dl className="answer-facts">{rows.map(row => <div key={row.label}><dt>{row.icon}{row.label}</dt><dd>{row.value}</dd></div>)}</dl>}
    <a className="button primary answer-open" href="#simulasi" onClick={onOpen}>{openLabel}<ArrowRight aria-hidden="true" /></a>
  </section>
}
