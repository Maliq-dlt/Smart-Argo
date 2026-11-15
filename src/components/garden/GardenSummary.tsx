import type { Site, Slot } from '../../lib/garden'

/** At the top of the stage for a garden: every zone with what grows there and the state of its advice, one tap to open it.
 * A zone whose session is not open yet says so rather than guessing. */
export default function GardenSummary({ site, slots, activeSlotId, status, onSelect }: {
  site: Site; slots: Slot[]; activeSlotId: string | null; status: (slot: Slot) => { plant: string; text: string }; onSelect: (slotId: string) => void
}) {
  return <nav className="garden-summary" aria-label={`Zona ${site.name}`}>
    <h3>{site.name}</h3>
    <ul>{slots.map(slot => { const { plant, text } = status(slot); return <li key={slot.id}>
      <button type="button" aria-current={activeSlotId === slot.id ? 'true' : undefined} onClick={() => onSelect(slot.id)}>
        <strong>{slot.name}</strong><span>{plant}</span><small>{text}</small></button></li> })}</ul>
  </nav>
}
