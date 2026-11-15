import { Info, Plant } from '@phosphor-icons/react'
import PlantScene, { type CareEffect, type SceneReadings } from './PlantScene'
import { phaseAt } from '../lib/agronomyEngine'
import { curated, phaseRanges, type CuratedId } from '../lib/species'
import { type SessionClock } from '../lib/sessionClock'
import { clockHour, scenePeriod, worldTime } from '../lib/simulation'

export type { CareEffect }
interface Props { careEffect?: CareEffect | null; clock: SessionClock; day: number; developmentDay?: number; elapsed?: number; planted?: boolean; journey?: boolean; species: CuratedId; moisture: number; contact: boolean; readings?: SceneReadings }
export default function PlantPotVisualizer({ careEffect, clock, day: age, developmentDay: day = age, elapsed = 0, planted = true, journey = false, species, moisture, contact, readings }: Props) {
  const period = scenePeriod(elapsed, clock), phase = planted ? phaseAt(day, species) : 'Belum ditanam'
  return <section className="panel plant-panel" aria-labelledby="plant-heading">
    <div className="panel-heading"><h2 id="plant-heading"><Plant />Ilustrasi fase tanaman</h2><span>{age} HST</span></div>
    <div className="plant-scene-heading"><span className="scene-clock">{period} · {worldTime(elapsed, clock)}</span><span className="phase-label"><span className="status-dot" />{phase}</span></div>
    <div className="plant-stage-frame">
      <PlantScene species={species} day={day} planted={planted} moisture={moisture} contact={contact} hour={clockHour(elapsed, clock)} readings={readings} careEffect={careEffect}
        label={`Pot ${curated(species).name.toLowerCase()}, ${phase}, hari ke-${age}.`} />
    </div>
    <p className="panel-footnote"><Info />{journey ? 'Model latihan: waktu dan perawatan memengaruhi perkembangan visual. Bukan prediksi tanaman nyata.' : 'Fase tumbuh ilustratif. Bentuk tanaman bukan hasil prediksi sensor.'}</p>
    <details className="phase-guide"><summary>Acuan fase per HST</summary><div>
      <p><strong>Acuan HST {age}: {phaseAt(age, species)}</strong>{journey && planted && <> · gambar model: {phaseAt(day, species)}</>}</p>
      <ol>{phaseRanges(species).map(([range, label]) => <li key={range}><span>{range} HST</span><strong>{label}</strong></li>)}</ol>
      <p>Rentang ilustrasi bawaan, belum dikalibrasi terhadap varietas atau tanaman nyata. Cocokkan dengan pengamatan lapangan. Sensor kelembapan, suhu, dan pH tidak mendeteksi bunga atau buah.</p>
    </div></details>
  </section>
}
