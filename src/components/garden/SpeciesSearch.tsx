import { useId, useState } from 'react'
import { PLANTABLE, searchSpecies } from '../../lib/species'

/** Picks a plant by typing a few letters of its name, an alias or its Latin name, then choosing from what is found. The
 * results are radio buttons so the choice works with a keyboard and a screen reader without a custom widget. */
export default function SpeciesSearch({ value, onChange, label = 'Tanaman' }: { value: number | null; onChange: (speciesId: number) => void; label?: string }) {
  const group = useId()
  const [query, setQuery] = useState('')
  const found = searchSpecies(query).filter(species => PLANTABLE.includes(species))
  return <div className="species-search">
    <label className="species-query"><span>{label}</span>
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari: cabai, bawang, anggrek" autoComplete="off" /></label>
    <div className="species-results" role="radiogroup" aria-label={`Hasil pencarian: ${label.toLowerCase()}`}>
      {found.map(species => <label key={species.id} className="species-option">
        <input type="radio" name={group} value={species.speciesId} checked={value === species.speciesId} onChange={() => onChange(species.speciesId)} />
        <span><strong>{species.name}</strong><small>{species.tier === 'kurasi' ? 'Acuan terkurasi' : 'Belajar dari pengamatan'}</small></span>
      </label>)}
      {found.length === 0 && <p className="section-hint">Tidak ada tanaman yang cocok.</p>}
    </div>
  </div>
}
