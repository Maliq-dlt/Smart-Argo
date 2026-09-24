import { useId, useState } from 'react'
import { motion } from 'framer-motion'
import { Sprout, Info, ScanLine } from 'lucide-react'
import { phaseAt } from '../lib/agronomyEngine'
import { type SessionClock } from '../lib/sessionClock'
import SkyScene from './SkyScene'
import { scenePeriod, worldTime } from '../lib/simulation'

interface Props { clock: SessionClock; running: boolean; rate: number; day: number; developmentDay?: number; elapsed?: number; planted?: boolean; journey?: boolean; onion: boolean; moisture: number; contact: boolean }
export default function PlantPotVisualizer({ clock, running, rate, day: age, developmentDay: day = age, elapsed = 0, planted = true, journey = false, onion, moisture, contact }: Props) {
  const id = useId().replaceAll(':', '')
  const [showSensors, setShowSensors] = useState(false)
  const period = scenePeriod(elapsed, clock)
  const growth = Math.min(1, .12 + day / (onion ? 48 : 62))
  const height = 214 * growth
  const leafCount = Math.min(7, 2 + Math.floor(day / 8))
  return <section className="panel plant-panel" aria-labelledby="plant-heading">
    <div className="panel-heading"><h2 id="plant-heading"><Sprout />Ilustrasi fase tanaman</h2><button className="plant-sensor-toggle" aria-pressed={showSensors} onClick={() => setShowSensors(!showSensors)}><ScanLine />Sensor</button></div>
    <div className="plant-canvas" data-period={period}>
      <SkyScene key={`${clock.startedAtMs}-${clock.offsetMinutes}`} worldClock={clock} elapsed={elapsed} running={running} rate={rate} />
      <span className="scene-clock">{period} · {worldTime(elapsed, clock)}</span>
      <span className="canvas-caption">{age} HST · ILUSTRASI</span>
      <span className="phase-label"><span className="status-dot" />{planted ? phaseAt(day, onion) : 'Belum ditanam'}</span>
      <svg viewBox="0 0 460 485" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{onion ? 'Bawang merah' : 'Cabai'} pada {age} hari setelah tanam</title>
        <desc id={`${id}-desc`}>Ilustrasi fase tumbuh, akar, pot dan tiga sensor lokal. Bukan model pertumbuhan atau diagnosis tanaman.</desc>
        <defs>
          <pattern id={`${id}-soil`} width="22" height="17" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1" fill="var(--soil-grain)" /><path d="m13 10 3 1m-11 4 2-1" stroke="var(--soil-grain)" strokeWidth="1" /></pattern>
          <linearGradient id={`${id}-pot`} x1="0" x2="1"><stop offset="0" stopColor="var(--pot-dark)" /><stop offset=".4" stopColor="var(--pot)" /><stop offset="1" stopColor="var(--pot-light)" /></linearGradient>
          <clipPath id={`${id}-clip`}><path d="M114 316H340L314 435H140Z" /></clipPath>
        </defs>
        <ellipse cx="228" cy="451" rx="145" ry="12" fill="var(--plant-shadow)" />
        <path d="M104 313H350L321 444Q226 459 133 444Z" fill={`url(#${id}-pot)`} />
        <path d="M114 316H340L314 435H140Z" fill="var(--soil-dry)" />
        <motion.path d="M114 316H340L314 435H140Z" fill="var(--soil-wet)" animate={{ opacity: moisture / 100 }} transition={{ duration: .6 }} />
        <path d="M114 316H340L314 435H140Z" fill={`url(#${id}-soil)`} />
        <path d="M119 339Q181 334 231 341T335 337M127 380Q175 386 228 379T326 384" fill="none" stroke="var(--soil-layer)" strokeWidth="1" />
        <g clipPath={`url(#${id}-clip)`} stroke="var(--root)" fill="none" strokeLinecap="round">
          <motion.g animate={{ scaleY: .28 + growth * .72 }} style={{ transformOrigin: '225px 315px' }} transition={{ type: 'spring', stiffness: 70, damping: 20 }}>
            <path d="M226 307Q228 338 215 357T222 415M227 327Q248 344 253 374L270 398M221 335Q189 351 184 379L174 402M222 355Q207 382 204 424" strokeWidth="2.2" />
            <path d="m217 350-21 10-16-2m33 17 15 11 5 20m-31-53-18 6-15 15m76-22 21 8 11 24m-20-13-9 20 4 15m-47-1-19 10-9 14m26-1 9 9m-44-23-16 3m57 10 8 9m-23-2-10 8m65-28 12 5" strokeWidth="1" />
          </motion.g>
        </g>
        <path d="M102 306Q225 295 352 306L350 318Q225 307 104 318Z" fill="var(--pot-light)" />
        <path d="M114 312Q229 306 340 312" stroke="var(--pot-dark)" fill="none" />
        <path d="M125 443Q226 454 328 442L335 449Q227 467 118 451Z" fill="var(--pot-dark)" />
        <g className={planted ? 'plant-growth' : 'seed-waiting'} stroke="var(--stem)" strokeLinecap="round" fill="none">
          {!planted ? <g><ellipse cx="226" cy="308" rx="6" ry="3" fill="var(--root)" /><path d="M224 308h4" stroke="var(--soil-dry)" /></g> : <>
          {onion ? <>
            {Array.from({ length: 9 }, (_, i) => <motion.path key={i} d={`M${218 + (i % 3) * 7} 312Q${190 + i * 7} ${265 - height * .3} ${163 + i * 16} ${308 - height + Math.abs(4 - i) * 16}`} strokeWidth={3 + i % 3} animate={{ pathLength: growth }} transition={{ duration: .6 }} />)}
            {day >= 26 && [0, 1, 2].map(i => <motion.ellipse key={i} cx={209 + i * 18} cy="314" rx="13" ry="20" fill="var(--onion)" stroke="var(--onion-dark)" strokeWidth="1.2" initial={{ scale: .2 }} animate={{ scale: Math.min(1, (day - 20) / 30) }} />)}
          </> : <>
            <motion.path d={`M227 311Q217 ${315 - height / 2} 226 ${310 - height}`} strokeWidth="4" initial={false} animate={{ d: `M227 311Q217 ${315 - height / 2} 226 ${310 - height}` }} transition={{ type: 'spring', stiffness: 65, damping: 18 }} />
            {Array.from({ length: leafCount * 2 }, (_, i) => {
              const tier = Math.floor(i / 2), side = i % 2 ? 1 : -1
              const y = 292 - (tier + 1) * height / (leafCount + 1)
              const width = (31 + (leafCount - tier) * 4) * Math.min(1, growth + .4)
              const tipX = 225 + side * width
              const tipY = y - 20 - (i % 3) * 4
              return <motion.g key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .5 }}>
                <path d={`M225 ${y + 13}Q${225 + side * 18} ${y + 8} ${tipX} ${tipY}`} strokeWidth="1.8" />
                <path d={`M${225 + side * 12} ${y + 5}Q${225 + side * 22} ${y - 31} ${tipX + side * 20} ${tipY - 9}Q${tipX + side * 12} ${y + 21} ${225 + side * 12} ${y + 5}`} fill={i % 3 ? 'var(--leaf)' : 'var(--leaf-light)'} stroke="var(--leaf-edge)" strokeWidth=".8" />
                <path d={`M${225 + side * 12} ${y + 5}L${tipX + side * 17} ${tipY - 7}`} stroke="var(--leaf-vein)" strokeWidth=".8" />
                {day >= 31 && day <= 55 && tier > 1 && i % 3 === 0 && <g transform={`translate(${tipX},${tipY + 22})`}>
                  <path d="M0-18V-3" strokeWidth="1" />
                  {[0, 72, 144, 216, 288].map(r => <ellipse key={r} cy="-4" rx="3.5" ry="6" transform={`rotate(${r})`} fill="var(--flower)" stroke="var(--flower-edge)" strokeWidth=".6" />)}
                  <circle r="2.3" fill="var(--flower-center)" stroke="none" />
                </g>}
                {day >= 56 && tier > 1 && i % 3 === 0 && <g transform={`translate(${tipX},${tipY + 8}) rotate(${side * 14})`}>
                  <path d="M0-6V2" strokeWidth="2" />
                  <path d="M-4 0C-14 11-5 29 8 34C-1 17 9 9 4 0Z" fill={day > 73 ? 'var(--chili-ripe)' : 'var(--leaf)'} stroke="none" />
                </g>}
              </motion.g>
            })}
            <path d={`M226 ${310 - height}q-14-20-7-25q15 10 7 25`} fill="var(--leaf-light)" strokeWidth=".6" />
          </>}
          </>}
        </g>
        {showSensors && <g className="plant-sensors"><motion.g animate={{ y: contact ? 0 : -60 }} transition={{ type: 'spring', stiffness: 90, damping: 16 }}>
          <path d="M287 291V263Q286 250 306 250H370" fill="none" stroke="var(--wire)" strokeWidth="2" />
          <rect x="279" y="282" width="16" height="29" rx="3" fill="var(--sensor-green)" />
          <path d="M282 311H292V359L287 367L282 359Z" fill="var(--sensor-green)" stroke="var(--sensor-edge)" strokeWidth="1" />
          <path d="M285 318V354M289 318V354" stroke="var(--sensor-mark)" strokeWidth="1" />
          <circle cx="287" cy="290" r="2" fill="var(--sensor-mark)" />
        </motion.g>
        <path d="M164 330V290Q165 275 143 275H83" fill="none" stroke="var(--wire)" strokeWidth="2" />
        <rect x="160" y="305" width="8" height="51" rx="4" fill="var(--steel)" stroke="var(--wire)" strokeWidth=".8" />
        <path d="M312 359V285Q312 269 326 269H373" fill="none" stroke="var(--wire)" strokeWidth="2" />
        <rect x="308" y="310" width="8" height="72" rx="3" fill="var(--steel)" />
        <rect x="306" y="292" width="12" height="23" rx="3" fill="var(--sensor-head)" />
        <g className="svg-labels">
          <path d="M96 275H66M370 250H384M373 269H388" stroke="var(--label-rule)" fill="none" />
          <text x="42" y="261">DS18B20</text><text x="42" y="275" className="svg-muted">suhu media</text>
          <text x="322" y="230">Kapasitif V1.2</text><text x="337" y="286">pH + DMS</text>
          <path d="M117 379H65V362" stroke="var(--label-rule)" fill="none" />
          <text x="31" y="349">Zona akar</text><text x="31" y="363" className="svg-muted">kontak lokal</text>
        </g>
        </g>}
      </svg>
      <div className="sensor-legend"><span>Kapasitif V1.2 · kelembapan</span><span>DS18B20 · suhu media</span><span>pH + DMS · keasaman</span></div>
    </div>
    <p className="panel-footnote"><Info />{journey ? 'Model latihan: waktu dan perawatan memengaruhi perkembangan visual. Bukan prediksi tanaman nyata.' : 'Fase tumbuh ilustratif. Bentuk tanaman bukan hasil prediksi sensor.'}</p>
    <details className="phase-guide"><summary>Acuan fase per HST</summary><div>
      <p><strong>Acuan HST {age}: {phaseAt(age, onion)}</strong>{journey && planted && <> · gambar model: {phaseAt(day, onion)}</>}</p>
      <ol>{(onion ? [['0', 'Awal tanam'], ['1–25', 'Vegetatif'], ['26–50', 'Pembentukan umbi'], ['51–65', 'Pematangan umbi']] : [['0', 'Awal tanam'], ['1–30', 'Vegetatif'], ['31–55', 'Berbunga'], ['56–90', 'Berbuah']]).map(([range, label]) => <li key={range}><span>{range} HST</span><strong>{label}</strong></li>)}</ol>
      <p>Rentang ilustrasi bawaan, belum dikalibrasi terhadap varietas atau tanaman nyata. Cocokkan dengan pengamatan lapangan. Sensor kelembapan, suhu, dan pH tidak mendeteksi bunga atau buah.</p>
    </div></details>
  </section>
}
