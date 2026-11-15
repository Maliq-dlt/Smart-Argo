import { ArrowsClockwise, CaretDown, Plus, Plant } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/popover'
import type { GardenBook, Placement, Slot } from '../../lib/garden'

const PLACEMENT_LABEL: Record<Placement, string> = { indoor: 'Dalam ruangan', outdoor: 'Luar ruangan', rooftop: 'Atap' }

/** The pot pill in the top bar, made into the place where a person moves between their pots and gardens (one dashboard, many
 * profiles). `children` is the pill's own face (mascot, name, day); `describe` says what grows in a slot and how far along. */
export default function SlotPicker({ book, describe, canSwitch, canLoadDemo, onSelect, onAdd, onSwitch, onDemo, children }: {
  book: GardenBook; describe: (slot: Slot) => string; canSwitch: boolean; canLoadDemo: boolean
  onSelect: (slotId: string) => void; onAdd: () => void; onSwitch: () => void; onDemo: () => void; children: ReactNode
}) {
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="pill-trigger" aria-label="Pot dan kebun saya">{children}<CaretDown className="pill-caret" aria-hidden="true" /></button></PopoverTrigger>
    <PopoverContent className="slot-picker" align="start">
      {book.sites.length === 0
        ? <p className="section-hint slot-empty">Belum ada pot atau kebun yang disimpan di perangkat ini. Sesi yang sedang dibuka tetap bisa dipakai.</p>
        : book.sites.map(site => <section key={site.id} className="slot-site" aria-label={site.name}>
          <h3>{site.name}<small>{site.kind === 'garden' ? 'Kebun' : 'Pot pribadi'} · {PLACEMENT_LABEL[site.placement]}</small></h3>
          <ul>{book.slots.filter(slot => slot.siteId === site.id).map(slot => <li key={slot.id}>
            <PopoverClose asChild><button type="button" className="slot-option" aria-current={book.activeSlotId === slot.id ? 'true' : undefined} onClick={() => onSelect(slot.id)}>
              <Plant aria-hidden="true" /><span><strong>{slot.name}</strong><small>{describe(slot)}</small></span></button></PopoverClose></li>)}</ul>
        </section>)}
      <div className="slot-actions">
        {canSwitch && <PopoverClose asChild><button type="button" className="button" onClick={onSwitch}><ArrowsClockwise aria-hidden="true" />Ganti tanaman</button></PopoverClose>}
        <PopoverClose asChild><button type="button" className="button" onClick={onAdd}><Plus aria-hidden="true" />Tambah pot atau kebun</button></PopoverClose>
        {canLoadDemo && <PopoverClose asChild><button type="button" className="button" onClick={onDemo}>Muat contoh kebun</button></PopoverClose>}
      </div>
    </PopoverContent>
  </Popover>
}
