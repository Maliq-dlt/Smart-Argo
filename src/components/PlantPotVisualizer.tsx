import { useState } from 'react'
import PlantIllustration from './PlantIllustration'
import { Sprout, Info, ScanLine } from 'lucide-react'
import SegmentedControl from './ui/segmented-control'
import { phaseAt } from '../lib/agronomyEngine'
import { type SessionClock } from '../lib/sessionClock'
import SkyScene from './SkyScene'
import { scenePeriod, worldTime } from '../lib/simulation'

export type CareEffect = { kind: 'plant' | 'water'; id: number }
interface Props { careEffect?: CareEffect | null; clock: SessionClock; running: boolean; rate: number; day: number; developmentDay?: number; elapsed?: number; planted?: boolean; journey?: boolean; onion: boolean; moisture: number; contact: boolean }
export default function PlantPotVisualizer({ careEffect, clock, running, rate, day: age, developmentDay: day = age, elapsed = 0, planted = true, journey = false, onion, moisture, contact }: Props) {
  const [view, setView] = useState('plant')
  const showSensors = view === 'roots'
  const period = scenePeriod(elapsed, clock)
  return <section className="panel plant-panel" aria-labelledby="plant-heading">
    <div className="panel-heading"><h2 id="plant-heading"><Sprout />Ilustrasi fase tanaman</h2><span>{age} HST</span></div>
    <div className="plant-scene-heading"><span className="scene-clock">{period} · {worldTime(elapsed, clock)}</span><span className="phase-label"><span className="status-dot" />{planted ? phaseAt(day, onion) : 'Belum ditanam'}</span></div>
    <div className="plant-canvas" data-period={period}>
      <SkyScene key={`${clock.startedAtMs}-${clock.offsetMinutes}`} worldClock={clock} elapsed={elapsed} running={running} rate={rate} />
      <PlantIllustration day={day} age={age} onion={onion} moisture={moisture} contact={contact} planted={planted} showSensors={showSensors} shellOpacity={showSensors ? 0 : 1} careEffect={careEffect} />
      {/* Spatial Product Showcase: https://21st.dev/@daiwiikharihar/components/spatial-product-showcase */}
      <div className="plant-view-switch"><SegmentedControl label="Tampilan pot" value={view} onValueChange={setView} options={[
        { value: 'plant', label: <><Sprout aria-hidden="true" />Tanaman</> },
        { value: 'roots', label: <><ScanLine aria-hidden="true" />Penampang</> },
      ]} /></div>
    </div>
    <p className="panel-footnote"><Info />{journey ? 'Model latihan: waktu dan perawatan memengaruhi perkembangan visual. Bukan prediksi tanaman nyata.' : 'Fase tumbuh ilustratif. Bentuk tanaman bukan hasil prediksi sensor.'}</p>
    <details className="phase-guide"><summary>Acuan fase per HST</summary><div>
      <p><strong>Acuan HST {age}: {phaseAt(age, onion)}</strong>{journey && planted && <> · gambar model: {phaseAt(day, onion)}</>}</p>
      <ol>{(onion ? [['0', 'Awal tanam'], ['1–25', 'Vegetatif'], ['26–50', 'Pembentukan umbi'], ['51–65', 'Pematangan umbi']] : [['0', 'Awal tanam'], ['1–30', 'Vegetatif'], ['31–55', 'Berbunga'], ['56–90', 'Berbuah']]).map(([range, label]) => <li key={range}><span>{range} HST</span><strong>{label}</strong></li>)}</ol>
      <p>Rentang ilustrasi bawaan, belum dikalibrasi terhadap varietas atau tanaman nyata. Cocokkan dengan pengamatan lapangan. Sensor kelembapan, suhu, dan pH tidak mendeteksi bunga atau buah.</p>
    </div></details>
  </section>
}
