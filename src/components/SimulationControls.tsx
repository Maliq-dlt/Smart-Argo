import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger, SheetClose } from './ui/sheet'
import { SelectField } from './ui/select'
import { Play, Pause, Sprout, Droplets, SkipForward, ChevronDown, ListChecks, Settings2 } from 'lucide-react'
import { feedingDue, scenePeriod, worldTime, simulationOf, simulationStopped, sampleIntervalMs, type SimulationState } from '../lib/simulation'
import { clockDate, utcLabel, logClock } from '../lib/sessionClock'
import type { Session } from '../lib/sessionStore'

export default function SimulationControls({ session, running, pauseNote, recommendation, onChange, onRun, onAdvance, onPlant, onWater, onFeed }: {
  session: Session; running: boolean; pauseNote: string; recommendation: ReactNode; onChange: (change: Partial<SimulationState>) => void
  onRun: () => void; onAdvance: (steps: number) => void; onPlant: () => void; onWater: () => void; onFeed: () => void
}) {
  const sim = simulationOf(session), journey = sim.mode === 'journey'
  const complete = journey && session.day >= (session.data.profile.crop.toLowerCase().includes('bawang') ? 65 : 90)
  const events = session.logs.filter(l => l.kind !== 'data').slice(-3).reverse()
  return <section className="panel simulation-controls" aria-labelledby="simulation-control-heading">
    <div className="panel-heading"><h2 id="simulation-control-heading">Waktu & perawatan</h2><span className="playback-state"><i className={running ? 'running-dot' : ''} />{running ? 'Berjalan' : sim.planted ? 'Dijeda' : 'Siap'}</span></div>
    <div className="simulation-control-body">
      <div className="world-clock"><span>{scenePeriod(session.data.now_h, session.clock)}<strong>{worldTime(session.data.now_h, session.clock)}</strong></span><span className="clock-context">{journey ? `HST ${session.day}` : `Jam sensor ${session.data.now_h.toFixed(1)}`}<small>{clockDate(session.clock, session.data.now_h)}<br />{utcLabel(session.clock, session.data.now_h)}</small></span></div>
      {!sim.planted ? <><p className="section-hint">Mulai dari bibit. Waktu berjalan otomatis; rawat tanaman mengikuti kondisi media.</p><button className="button primary plant-seed" onClick={onPlant}><Sprout />Tanam & mulai</button></> : sim.source !== 'manual' && <>
        {complete ? <p className="journey-complete" role="status">Perjalanan selesai. Bentuk akhir mengikuti perawatan dalam model. Tinjau jurnal atau mulai pot baru.</p> : <>
          <div className="playback-controls"><button className="button primary" onClick={onRun} disabled={simulationStopped(session)}>{running ? <Pause /> : <Play />}{running ? 'Jeda' : 'Lanjutkan waktu'}</button><SelectField label="Laju waktu sensor" value={sim.rate} onValueChange={value => onChange({ rate: Number(value) })} options={[{ value: 1, label: 'Lambat' }, { value: 12, label: 'Normal' }, { value: 48, label: 'Cepat' }]} /></div>
          <p className="playback-caption">1 hari = {sampleIntervalMs(sim.rate) * 48 / 1000} detik · sampel tiap 30 menit simulasi</p>
        </>}
      </>}
      {sim.planted && pauseNote && <div className="clock-state-note" role="status"><p>{pauseNote}</p>{sim.source === 'manual' && <button className="text-button" onClick={() => onChange({ source: 'auto' })}>Gunakan waktu otomatis</button>}</div>}
      {recommendation}
      {sim.planted && sim.source !== 'manual' && <div className="care-actions"><button className="button" disabled={complete} onClick={onWater}><Droplets />Siram 150 mL</button><p>Volume latihan. Respons pada sampel berikutnya.</p></div>}
      {feedingDue(session) && <div className="feed-reminder" role="status"><ListChecks /><div><strong>Pengingat pupuk tiba</strong><p>Periksa jadwal perawatan pribadimu.</p><button className="text-button" onClick={onFeed} disabled={complete}>Catat sudah diberi pupuk</button></div></div>}
      <Sheet><SheetTrigger asChild><button className="settings-row"><Settings2 /><span>Pengaturan waktu & sampel</span><ChevronDown /></button></SheetTrigger><SheetContent><header className="sheet-heading"><SheetTitle>Waktu & sampel</SheetTitle><SheetDescription>Atur ritme simulasi dan pengingat perawatan.</SheetDescription></header><div className="settings-section">
        <fieldset className="source-options"><legend>Sumber sampel</legend>{([['auto', 'Otomatis'], ['random', 'Acak'], ['manual', 'Manual']] as const).filter(([v]) => !journey || v !== 'manual').map(([v,label]) => <label key={v}><input type="radio" name="sample-source" value={v} checked={sim.source === v} onChange={() => onChange({ source: v, pendingWater: 0 })} />{label}</label>)}</fieldset>
        <p className="section-hint">Otomatis mengikuti siang–malam. Acak menambah variasi. {journey ? 'Manual tersedia dalam Eksperimen.' : 'Manual mengatur setiap pembacaan.'}</p>
        {sim.source !== 'manual' && <><label className="check-label"><input type="checkbox" checked={sim.pauseOnCare} onChange={e => onChange({ pauseOnCare: e.target.checked })} />Jeda otomatis saat perlu tindakan</label><p className="section-hint">Opsional. Berhenti saat muncul perhatian baru. Lanjutkan waktu melewati peringatan yang sudah dilihat.</p><div className="simulation-actions"><button className="button" onClick={() => onAdvance(1)} disabled={running || simulationStopped(session)}><SkipForward />+30 menit</button><button className="button" onClick={() => onAdvance(48)} disabled={running || simulationStopped(session)}>+1 hari</button></div></>}
      </div>
      {journey && <section className="settings-section"><h3>Jadwal pupuk pribadi</h3><div className="fertilizer-schedule">
        <label>Ulangi setiap (hari)<input aria-label="Interval pengingat pupuk" type="number" min="0" max="90" step="1" value={sim.feedEveryDays} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 90) onChange({ feedEveryDays: n }) }} /></label>
        <p>{sim.feedEveryDays ? `Pengingat berikutnya: HST ${Math.floor(sim.lastFedAt / 24) + sim.feedEveryDays}.` : '0 = nonaktif. Atur sesuai rencana perawatanmu.'}</p>
        <button className="button" onClick={onFeed} disabled={complete || !sim.planted}>Catat pupuk</button><small>Pengingat kalender. Sensor tidak menentukan kebutuhan atau dosis pupuk.</small>
      </div></section>}<SheetClose asChild><button className="button primary sheet-done">Selesai</button></SheetClose></SheetContent></Sheet>
      {journey && events.length > 0 && <details className="control-details"><summary>Jurnal terbaru<ChevronDown /></summary><div className="journey-journal"><ol>{events.map(e => <li key={e.id}><time>{logClock(session.clock, e.time)}</time><p>{e.message}</p></li>)}</ol><a href="#terminal" className="text-button">Lihat seluruh log</a></div></details>}
    </div>
  </section>
}
