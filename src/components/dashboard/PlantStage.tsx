import type { ReactNode } from 'react'
import PlantScene, { type CareEffect, type SceneReadings } from '../PlantScene'
import type { CuratedId } from '../../lib/species'
import type { SkyPeriod } from '../../lib/dashboardFacts'

/* The dashboard's centrepiece: the pot in section, with the three readings written beside the part they describe. The
 * scene draws its own sky from the session clock, so a night reading is dark and a noon reading is bright; the section
 * around it only follows the period so the heading and the clock stay readable. */
export default function PlantStage({ crop, sub, status, species, day, planted, moisture, contact, readings, hour, period, careEffect, children }: {
  crop: string; sub: string; status: { ok: boolean; text: string }; species: CuratedId; day: number; planted: boolean; moisture: number; contact: boolean
  readings: SceneReadings; hour: number; period: SkyPeriod; careEffect?: CareEffect | null; children?: ReactNode
}) {
  return <section className="plant-stage-section dash-stage" data-sky={period} aria-labelledby="plant-stage-title">
    <header className="plant-heading">
      <div><h2 id="plant-stage-title">{crop} <span>dalam pot</span></h2><p>{sub}</p></div>
      <span className="reading-status" data-alert={!status.ok || undefined}><i aria-hidden="true" />{status.text}</span>
    </header>
    <div className="stage-scene">
      <PlantScene species={species} day={day} planted={planted} moisture={moisture} contact={contact} hour={hour} readings={readings} careEffect={careEffect}
        label={`${crop} dalam pot, ${sub}. Kelembapan ${readings.kelembapan}, suhu ${readings.suhu}, pH ${readings.ph}.`} />
    </div>
    {children}
  </section>
}
