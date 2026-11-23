import { useRef, useState } from 'react'
import type { OverviewPlant } from '../../lib/overview'

const m0 = (v: number) => Math.round(v).toLocaleString('id-ID')
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase()

/** Moving between plants on the plant page: a ruler, one tick per plant, each labelled with its code like the numbers
 *  on a tape measure (readable without hovering). The current plant's tick is long and carries its name. Pointing at or
 *  focusing a tick previews that plant just below; the order is the garden's, so ticks never move under the pointer. */
export default function PlantRail({ plants, activeId, onSelect }: { plants: OverviewPlant[]; activeId: string | null; onSelect: (plant: OverviewPlant) => void }) {
  const [peek, setPeek] = useState<{ id: string; x: number } | null>(null)
  const ticks = useRef<HTMLDivElement>(null)
  const show = (id: string, el: HTMLElement) => setPeek({ id, x: el.offsetLeft - (ticks.current?.scrollLeft ?? 0) })
  const shown = peek && peek.id !== activeId ? plants.find(p => p.id === peek.id) : undefined
  return <nav className="plant-rail" aria-labelledby="plant-rail-title">
    <h2 id="plant-rail-title" className="plant-rail-title">Tanaman lain</h2>
    <div className="plant-rail-ticks" ref={ticks} onScroll={() => setPeek(null)}>
      {plants.map(p => <button key={p.id} type="button" className="rail-tick" data-tone={p.status.tone} aria-current={p.id === activeId || undefined}
        aria-label={`${p.name}, ${p.status.word}${p.moisture !== null ? `, kelembapan ${m0(p.moisture)}` : ''}`}
        onClick={() => { setPeek(null); onSelect(p) }} onPointerEnter={e => show(p.id, e.currentTarget)} onPointerLeave={() => setPeek(null)}
        onFocus={e => show(p.id, e.currentTarget)} onBlur={() => setPeek(null)}>
        <i aria-hidden="true" /><span aria-hidden="true">{p.id === activeId ? p.name : p.tag ?? initials(p.name)}</span>
      </button>)}
    </div>
    {/* Outside the scrolling strip, so it is never clipped; the buttons carry the same words for screen readers. */}
    {shown && <p className="plant-rail-peek" style={{ left: `max(0px, min(${peek!.x}px, 100% - 15rem))` }} aria-hidden="true">
      <b>{shown.name}</b><span>{[shown.tag, shown.status.word, shown.moisture !== null && `kelembapan ${m0(shown.moisture)}`].filter(Boolean).join(' · ')}</span>
    </p>}
  </nav>
}
