import { Check, Plus, X } from '@phosphor-icons/react'
import { useState } from 'react'
import SegmentedControl from '../ui/segmented-control'
import { DialogDescription, DialogTitle } from '../ui/dialog'
import SpeciesSearch from './SpeciesSearch'
import { PLACEMENTS, shiftDate, type Location, type Placement } from '../../lib/garden'
import { MAX_BACKFILL_DAYS } from '../../lib/gardenSessions'
import { PLANTABLE } from '../../lib/species'

export interface WizardInput {
  kind: 'pot' | 'garden'; name: string; placement: Placement; location?: Location; plantedOn: string
  plant: { speciesId: number; nickname?: string }
  zones: { name: string; speciesId: number }[]
}
const PLACEMENT_LABEL: Record<Placement, string> = { indoor: 'Dalam ruangan', outdoor: 'Luar ruangan', rooftop: 'Atap' }
const MAX_ZONES = 6

/** "Siapkan": a personal pot or a garden, where it stands, what grows in it and since when. The plant starts on the planting
 * date; an older date has the simulator age it (at most `MAX_BACKFILL_DAYS`), so the dashboard is not an empty seedling. */
export default function SlotWizard({ today, onCreate, onClose }: { today: string; onCreate: (input: WizardInput) => void; onClose: () => void }) {
  const [kind, setKind] = useState<'pot' | 'garden'>('pot')
  const [name, setName] = useState('')
  const [placement, setPlacement] = useState<Placement>('indoor')
  const [lat, setLat] = useState(''), [lon, setLon] = useState('')
  const [speciesId, setSpeciesId] = useState<number | null>(PLANTABLE[0].speciesId)
  const [nickname, setNickname] = useState('')
  const [plantedOn, setPlantedOn] = useState(today)
  const [zones, setZones] = useState([{ name: 'Zona 1', speciesId: PLANTABLE[0].speciesId }, { name: 'Zona 2', speciesId: PLANTABLE[0].speciesId }])
  const [error, setError] = useState('')
  const outdoors = placement !== 'indoor'
  const setZone = (index: number, change: Partial<(typeof zones)[number]>) => setZones(old => old.map((zone, i) => i === index ? { ...zone, ...change } : zone))
  return <form className="profile-form garden-wizard" onSubmit={event => {
    event.preventDefault()
    try {
      if (speciesId === null) throw new RangeError('Pilih tanaman dulu.')
      const location = outdoors && (lat.trim() || lon.trim()) ? { lat: Number(lat), lon: Number(lon) } : undefined
      onCreate({ kind, name, placement, location, plantedOn, plant: { speciesId, nickname: nickname.trim() || undefined }, zones })
    } catch (err) { setError(err instanceof Error ? err.message : 'Tidak dapat menyimpan.') }
  }}>
    <div className="dialog-heading"><div><DialogTitle>Tambah pot atau kebun</DialogTitle><DialogDescription>Disimpan di perangkat ini. Pembacaan tetap data simulasi.</DialogDescription></div>
      <button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><X /></button></div>
    <SegmentedControl label="Jenis" value={kind} onValueChange={value => setKind(value === 'garden' ? 'garden' : 'pot')} options={[{ value: 'pot', label: 'Pot pribadi' }, { value: 'garden', label: 'Kebun' }]} />
    <label>Nama<input value={name} onChange={event => setName(event.target.value)} maxLength={60} required placeholder={kind === 'pot' ? 'Pot dapur' : 'Kebun belakang'} /></label>
    <SegmentedControl label="Penempatan" value={placement} onValueChange={value => setPlacement(PLACEMENTS.find(p => p === value) ?? 'indoor')} options={PLACEMENTS.map(p => ({ value: p, label: PLACEMENT_LABEL[p] }))} />
    {outdoors && <div className="form-grid">
      <label>Lintang<input type="number" inputMode="decimal" step="any" min="-90" max="90" value={lat} onChange={event => setLat(event.target.value)} placeholder="Opsional" /></label>
      <label>Bujur<input type="number" inputMode="decimal" step="any" min="-180" max="180" value={lon} onChange={event => setLon(event.target.value)} placeholder="Opsional" /></label>
      <small className="section-hint">Opsional. Disimpan di perangkat ini untuk cuaca nanti.</small></div>}
    {kind === 'pot'
      ? <>
        <SpeciesSearch value={speciesId} onChange={setSpeciesId} />
        <label>Nama panggilan<input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={60} placeholder="Kosongkan untuk nama otomatis" /></label>
      </>
      : <fieldset className="garden-zones"><legend>Zona</legend>
        {zones.map((zone, index) => <div className="garden-zone" key={index}>
          <label>Nama zona<input value={zone.name} onChange={event => setZone(index, { name: event.target.value })} maxLength={60} required /></label>
          <label>Tanaman<select value={zone.speciesId} onChange={event => setZone(index, { speciesId: Number(event.target.value) })}>
            {PLANTABLE.map(species => <option key={species.id} value={species.speciesId}>{species.name}</option>)}</select></label>
          {zones.length > 1 && <button type="button" className="icon-button" aria-label={`Hapus ${zone.name || 'zona'}`} onClick={() => setZones(old => old.filter((_, i) => i !== index))}><X /></button>}
        </div>)}
        {zones.length < MAX_ZONES && <button type="button" className="button" onClick={() => setZones(old => [...old, { name: `Zona ${old.length + 1}`, speciesId: PLANTABLE[0].speciesId }])}><Plus aria-hidden="true" />Tambah zona</button>}
      </fieldset>}
    <label>Tanggal tanam<input type="date" value={plantedOn} min={shiftDate(today, MAX_BACKFILL_DAYS)} max={today} onChange={event => setPlantedOn(event.target.value)} required />
      <small className="section-hint">Tanggal lebih awal membuat simulasi menumbuhkan tanamannya sampai hari ini (paling jauh {MAX_BACKFILL_DAYS} hari).</small></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button type="submit" className="button primary"><Check aria-hidden="true" />{kind === 'pot' ? 'Buat pot' : 'Buat kebun'}</button>
  </form>
}
