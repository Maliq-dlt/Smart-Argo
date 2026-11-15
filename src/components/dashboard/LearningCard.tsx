import type { MouseEvent } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { MOOD_LABEL } from '../../lib/mascot'
import { THRESHOLDS, type InspectionState } from '../../lib/observation'
import type { LearningEvidence, LearningText } from '../../lib/learningExplanation'
import PlantMood from '../PlantMood'
import './learning.css'

const STATES: { value: InspectionState; label: string }[] = [{ value: 'sehat', label: 'Sehat' }, { value: 'biasa', label: 'Biasa' }, { value: 'bermasalah', label: 'Bermasalah' }]

/** The answer card for a plant that has no curated profile: instead of advice it shows what has been seen, how far it is from
 * knowing this pot, and the one thing to do now. At level 1 it states the pot's own pattern, labelled as such. */
export default function LearningCard({ mood, speciesName, evidence, explanation, lastCheck, onInspect, onOpen }: {
  mood: keyof typeof MOOD_LABEL; speciesName: string; evidence: LearningEvidence; explanation: LearningText; lastCheck: InspectionState | null
  onInspect: (state: InspectionState) => void; onOpen: (event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const { missing } = evidence
  const next = evidence.level === 1 ? 'Catat pengecekan hari ini supaya pola pot ini makin tepat.'
    : missing.inspections > 0 ? 'Yang bisa dilakukan sekarang: nilai tanaman Anda hari ini.'
      : missing.waterings > 0 ? 'Yang bisa dilakukan sekarang: catat satu siraman, lalu biarkan pembacaan berikutnya mengukur efeknya.'
        : `Tinggal menunggu: ${missing.days} hari lagi.`
  return <section className="panel dashboard-care tone-calm learning-card" aria-labelledby="learning-title">
    <div className="answer-mood"><PlantMood mood={mood} /><div><b>Sedang belajar</b><small>{speciesName}: belum ada acuan terkurasi</small></div></div>
    <h3 id="learning-title">{evidence.level === 1 ? <>Pola <em>pot Anda</em></> : <>Mengamati <em>dulu</em></>}</h3>
    <p>{explanation.text}</p>
    <p className="learning-label">{explanation.label}</p>
    <ul className="learning-progress" aria-label="Kemajuan belajar">
      <li><span>Hari diamati</span><progress max={THRESHOLDS.days} value={Math.min(evidence.days, THRESHOLDS.days)} aria-label="Hari diamati" /><b>{evidence.days} dari {THRESHOLDS.days}</b></li>
      <li><span>Pengecekan</span><progress max={THRESHOLDS.inspections} value={Math.min(evidence.inspections, THRESHOLDS.inspections)} aria-label="Pengecekan" /><b>{evidence.inspections} dari {THRESHOLDS.inspections}</b></li>
      <li><span>Siraman terukur</span><progress max={THRESHOLDS.waterings} value={Math.min(evidence.waterings, THRESHOLDS.waterings)} aria-label="Siraman terukur" /><b>{evidence.waterings} dari {THRESHOLDS.waterings}</b></li>
    </ul>
    <p className="learning-next">{next}</p>
    <div className="learning-checks" role="group" aria-label="Catat pengecekan">
      {STATES.map(({ value, label }) => <button key={value} type="button" className="button" onClick={() => onInspect(value)}>{label}</button>)}
    </div>
    {lastCheck && <p className="section-hint learning-last">Pengecekan terakhir: {lastCheck}.</p>}
    {evidence.level === 0 && missing.inspections === 0 && missing.waterings > 0 && <a className="button primary answer-open" href="#simulasi" onClick={onOpen}>Buka perawatan<ArrowRight aria-hidden="true" /></a>}
  </section>
}
