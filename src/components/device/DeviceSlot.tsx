import { useLayoutEffect, useRef, type RefObject } from 'react'

import { ariaFor, LABELS, labelsFor, type DeviceMode, type Highlight, type LabelId } from './deviceFacts'
import { motionAllowed, registerSlot, setSlotHighlight, setSlotMode } from './deviceStage'
import './device.css'

const ids = Object.keys(LABELS) as LabelId[]
/** Sections whose live shot opens somewhere else than where it settles have a second poster of that opening shot. */
const OPENS: DeviceMode[] = ['tanah', 'angka']
const posterOf = (mode: DeviceMode) => (OPENS.includes(mode) && motionAllowed() ? `${mode}-open` : mode)

type Props = {
  mode: DeviceMode
  highlight?: Highlight | null
  /** Curved backdrop with leaf light (the hero only). */
  studio?: boolean
  className?: string
  slotRef?: RefObject<HTMLDivElement>
}

/** A place on the page for the shared 3D device: the poster of its state, the live canvas when this slot is the one on
 * screen, and the labels. Without motion or WebGL the poster stays, with the labels as a short legend. */
export default function DeviceSlot({ mode, highlight = null, studio = false, className = '', slotRef }: Props) {
  const own = useRef<HTMLDivElement>(null), el = slotRef ?? own
  const initial = useRef({ mode, studio })
  useLayoutEffect(() => registerSlot(el.current!, initial.current), [el])
  useLayoutEffect(() => setSlotMode(el.current!, mode), [el, mode])
  useLayoutEffect(() => setSlotHighlight(el.current!, highlight), [el, highlight])
  const legend = labelsFor(mode)

  return <div ref={el} className={`device-slot ${className}`} role="img" aria-label={ariaFor(mode)} data-mode={mode}>
    <img className="device-poster" src={`./landing/device/${posterOf(mode)}.webp`} alt="" decoding="async" />
    <div className="device-live" />
    <svg className="device-lines" aria-hidden="true">
      {ids.map(id => <g key={id}><line data-label={id} /><circle data-label={id} r={3} /></g>)}
    </svg>
    {ids.map(id => <span key={id} className="device-label" data-label={id} aria-hidden="true"><b>{LABELS[id].title}</b><span>{LABELS[id].note}</span></span>)}
    {legend.length > 0 && <ul className="device-legend" aria-hidden="true">
      {legend.map(id => <li key={id}><b>{LABELS[id].title}</b> {LABELS[id].note}</li>)}
    </ul>}
  </div>
}
