import type { ReactNode } from 'react'
import PlantScene, { type CareEffect, type SceneReadings } from '../PlantScene'
import SegmentedControl from '../ui/segmented-control'
import { SIM_WEATHERS, isSimWeather, type SimWeather } from '../../lib/weather'
import { sceneOf, type SpeciesId } from '../../lib/species'
import type { SkyPeriod } from '../../lib/dashboardFacts'

/* The dashboard's centrepiece: the pot in section, with the three readings written beside the part they describe. The
 * scene draws its own sky from the session clock, so a night reading is dark and a noon reading is bright; the section
 * around it only follows the period so the heading and the clock stay readable. */
const WEATHER_LABEL: Record<SimWeather, string> = { cerah: 'Cerah', berawan: 'Berawan', mendung: 'Mendung', hujan: 'Hujan', terik: 'Terik' }
export default function PlantStage({ crop, sub, status, species, day, planted, moisture, contact, readings, hour, period, careEffect, weather, summary, children }: {
  crop: string; sub: string; status: { ok: boolean; text: string }; species: SpeciesId; day: number; planted: boolean; moisture: number; contact: boolean
  readings: SceneReadings; hour: number; period: SkyPeriod; careEffect?: CareEffect | null
  /** The demo weather and its note; null for a pot indoors, which does not see the sky. */
  weather: { kind: SimWeather; onChange: (kind: SimWeather) => void; note: string | null } | null
  /** The zones of a garden, above the heading. */
  summary?: ReactNode; children?: ReactNode
}) {
  return <section className="plant-stage-section dash-stage" data-sky={period} aria-labelledby="plant-stage-title">
    {summary}
    <header className="plant-heading">
      <div><h2 id="plant-stage-title">{crop} <span>dalam pot</span></h2><p>{sub}</p></div>
      <span className="reading-status" data-alert={!status.ok || undefined}><i aria-hidden="true" />{status.text}</span>
    </header>
    <div className="stage-scene">
      <PlantScene species={sceneOf(species)} day={day} planted={planted} moisture={moisture} contact={contact} hour={hour} readings={readings} weather={weather?.kind} careEffect={careEffect}
        label={`${crop} dalam pot, ${sub}. Kelembapan ${readings.kelembapan}, suhu ${readings.suhu}, pH ${readings.ph}.`} />
    </div>
    {weather && <div className="stage-weather">
      <span aria-hidden="true">Cuaca simulasi</span>
      <SegmentedControl label="Cuaca simulasi" value={weather.kind} onValueChange={value => { if (isSimWeather(value)) weather.onChange(value) }} options={SIM_WEATHERS.map(kind => ({ value: kind, label: WEATHER_LABEL[kind] }))} />
    </div>}
    {weather?.note && <p className="stage-weather-note">{weather.note}</p>}
    {children}
  </section>
}
