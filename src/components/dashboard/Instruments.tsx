import type { CSSProperties } from 'react'
import { Check, Leaf } from '@phosphor-icons/react'
import type { Sample } from '../../lib/agronomyEngine'
import { phaseIndex, phaseSteps } from '../../lib/dashboardFacts'
import type { SpeciesId } from '../../lib/species'
import { useWidth } from './useWidth'

const one = (value: number) => value.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const PH_MIN = 4.5, PH_MAX = 8
const phPos = (value: number) => (clamp(value, PH_MIN, PH_MAX) - PH_MIN) / (PH_MAX - PH_MIN) * 100

/** Three instruments that add context instead of repeating the stage's numbers: where the plant is on its journey, the
 * last day of soil temperature against the heat limit, and the last three pH readings against the profile's range. */
export default function Instruments({ samples, now, hot, phRange, phValidated, day, species, awaitingPlant }: {
  samples: Sample[]; now: number; hot: number; phRange: [number, number]; phValidated: boolean; day: number; species: SpeciesId; awaitingPlant: boolean
}) {
  const { names, starts, total } = phaseSteps(species)
  const index = awaitingPlant ? -1 : phaseIndex(day, species)
  const next = index < 0 ? 'Dimulai setelah bibit ditanam' : index >= names.length - 1 ? `Perjalanan selesai di hari ${total}` : `${names[index + 1]} mulai hari ${starts[index + 1]}`

  const temps = samples.filter(r => r.valid && r.t_h >= now - 24)
  const [frame, width] = useWidth<HTMLDivElement>()
  const W = Math.max(200, width || 300), H = 96
  const lo = temps.length ? Math.min(...temps.map(r => r.temp_c)) : 0, hi = temps.length ? Math.max(...temps.map(r => r.temp_c)) : 0
  const dMin = Math.min(15, Math.floor(lo) - 1, hot - 5), dMax = Math.max(40, Math.ceil(hi) + 1, hot + 3)
  const TY = (v: number) => 8 + (H - 16) * (1 - (v - dMin) / (dMax - dMin))
  const t0 = temps[0]?.t_h ?? now, TX = (t: number) => (t - t0) / Math.max(.5, now - t0) * (W - 8) + 4
  const latestTemp = temps.at(-1), overHot = latestTemp ? latestTemp.temp_c > hot : false

  const phRows = samples.filter(r => r.valid && r.ph != null).slice(-3)
  const phLatest = phRows.at(-1)?.ph ?? null
  const phOut = phLatest !== null && (phLatest < phRange[0] || phLatest > phRange[1])
  return <div className="instruments">
    <section className="panel instrument" aria-labelledby="inst-phase">
      <header><div><h3 id="inst-phase">Fase <em>tumbuh</em></h3><p>{next}</p></div>
        <span className="instrument-value">{awaitingPlant ? '—' : day}<small>/{total} hari</small></span></header>
      <ol className="phase-steps" style={{ '--progress': Math.max(0, index) / (names.length - 1) } as CSSProperties}>
        <span className="phase-fill" aria-hidden="true" />
        {names.map((name, i) => <li key={name} data-state={i < index ? 'done' : i === index ? 'now' : 'next'} aria-current={i === index ? 'step' : undefined}>
          <span className="phase-node">{i < index ? <Check aria-hidden="true" /> : i === index ? <Leaf weight="fill" aria-hidden="true" /> : null}</span>{i === 0 ? 'Awal' : name}</li>)}
      </ol>
    </section>

    <section className="panel instrument" aria-labelledby="inst-temp">
      <header><div><h3 id="inst-temp">Suhu <em>tanah</em></h3><p>{!latestTemp ? 'Belum ada riwayat suhu' : overHot ? 'Melewati batas panas' : 'Di bawah batas panas'}, 24 jam terakhir</p></div>
        {temps.length > 0 && <span className="instrument-value">{one(lo)}–{one(hi)}<small>°C</small></span>}</header>
      <div className="spark" ref={frame}>
        {temps.length >= 2 && <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Suhu tanah 24 jam terakhir, ${one(lo)} sampai ${one(hi)} °C; batas panas ${one(hot)} °C`}>
          <line className="spark-limit" x1="0" x2={W} y1={TY(hot)} y2={TY(hot)} />
          <text className="spark-label" x="0" y={TY(hot) - 6}>batas panas {one(hot)} °C</text>
          <polyline className="spark-line" points={temps.map(r => `${TX(r.t_h).toFixed(1)},${TY(r.temp_c).toFixed(1)}`).join(' ')} />
          {latestTemp && <circle className="spark-dot" data-alert={overHot || undefined} cx={TX(latestTemp.t_h)} cy={TY(latestTemp.temp_c)} r="4.5" />}
        </svg>}
      </div>
    </section>

    <section className="panel instrument" aria-labelledby="inst-ph">
      <header><div><h3 id="inst-ph">pH <em>zona akar</em></h3>
        <p>{phLatest === null ? 'Belum diukur' : !phValidated ? 'Belum tervalidasi' : phOut ? 'Di luar rentang profil. Ukur ulang bila berulang' : `Dalam rentang profil ${one(phRange[0])}–${one(phRange[1])}`}</p></div>
        {phRows.length > 0 && <span className="instrument-value is-list">{phRows.map(r => one(r.ph!)).join(' → ')}<small>tiga bacaan terakhir</small></span>}</header>
      {phLatest !== null && <div className="ph-scale">
        <div className="ph-bar"><span className="ph-ideal" style={{ left: `${phPos(phRange[0])}%`, width: `${phPos(phRange[1]) - phPos(phRange[0])}%` }} />
          {phRows.slice(0, -1).map((r, i) => <span key={i} className="ph-dot" style={{ left: `${phPos(r.ph!)}%` }} />)}
          <span className="ph-pin" data-alert={phOut || undefined} style={{ left: `${phPos(phLatest)}%` }} /></div>
        <div className="ph-ticks">{[PH_MIN, phRange[0], phRange[1], PH_MAX].map((v, i) => <span key={i} style={{ left: `${phPos(v)}%` }} data-edge={i === 0 ? 'start' : i === 3 ? 'end' : undefined}>{one(v)}</span>)}</div>
      </div>}
    </section>
  </div>
}
