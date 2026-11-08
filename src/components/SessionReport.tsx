import { evaluate } from '../lib/agronomyEngine'
import { careEvents, chartSegments, summarizeSamples } from '../lib/chartData'
import { clockDate, clockTime, utcLabel } from '../lib/sessionClock'
import type { Session } from '../lib/sessionStore'
import { canUndoWater, simulationOf } from '../lib/simulation'
import AgroMark from './AgroMark'

// ponytail: native print renders one session snapshot; add a PDF library only for server exports.
export default function SessionReport({ session }: { session: Session }) {
  const { data, clock } = session, last = data.samples.at(-1)!, result = evaluate(data)
  const sim = simulationOf(session), awaitingPlant = sim.mode === 'journey' && !sim.planted
  const ph = [...data.samples].reverse().find(row => row.valid && row.ph !== null)
  const rows = data.samples.slice(-120), stats = summarizeSamples(data.samples, 'moisture')
  const events = careEvents(session.logs, data), start = rows[0].t_h, end = rows.at(-1)!.t_h
  const x = (hour: number) => 40 + (hour - start) / Math.max(.5, end - start) * 660
  const y = (value: number) => 170 - value * 1.4
  const format = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('id-ID', { maximumFractionDigits: 1 })
  const time = (hour: number) => clockDate(clock, hour) + ' ' + clockTime(clock, hour)
  return <article className="session-report" aria-label="Ringkasan sesi untuk dicetak">
    <header><div><AgroMark /><span>smartagro · Simulasi lokal</span></div><h1>{session.name}</h1><p>{data.profile.crop} · {data.profile.media} · {data.profile.pot_id}</p><p>Waktu sesi: {time(data.now_h)} · {utcLabel(clock, data.now_h)}</p></header>
    <section><h2>Kondisi terakhir</h2><dl className="report-readings">
      <div><dt>Kelembapan</dt><dd>{last.valid ? format(last.moisture) + ' / 100' : 'Pembacaan gagal'}</dd></div>
      <div><dt>Suhu tanah</dt><dd>{last.valid ? format(last.temp_c) + ' °C' : 'Pembacaan gagal'}</dd></div>
      <div><dt>pH terakhir</dt><dd>{format(ph?.ph)}</dd></div>
    </dl><p>Sampel terakhir: {time(last.t_h)}. {stats.count} dari {data.samples.length} sampel memiliki kelembapan valid.</p><p>{result.evidence.ph_status} · Acuan media {data.profile.validated ? 'disahkan dalam sesi' : 'belum disahkan'}.</p></section>
    <section><h2>{awaitingPlant ? 'Bibit siap memulai perjalanan' : result.action}</h2><p>{awaitingPlant ? 'Tanam untuk memulai waktu, lalu amati perubahan media dan perkembangan tanaman.' : result.reason}</p>
      {canUndoWater(session) && <p className="report-pending">Siraman {data.watering!.volume_ml} mL menunggu sampel berikutnya; masih dapat dibatalkan di aplikasi.</p>}
    </section>
    <figure><h2>Riwayat kelembapan</h2><svg viewBox="0 0 740 210" role="img" aria-label="Kelembapan 0 sampai 100 menurut waktu sesi">
      {[0, 50, 100].map(value => <g key={value}><line x1="40" x2="700" y1={y(value)} y2={y(value)} /><text x="30" y={y(value) + 4} textAnchor="end">{value}</text></g>)}
      {chartSegments(rows, 'moisture').map((segment, index) => <g key={index}><polyline points={segment.map(row => x(row.t_h) + ',' + y(row.moisture)).join(' ')} />{segment.map(row => <circle key={row.t_h} cx={x(row.t_h)} cy={y(row.moisture)} r="2.5" />)}</g>)}
      <text x="40" y="200">{time(start)}</text><text x="700" y="200" textAnchor="end">{time(end)}</text>
    </svg><figcaption>{rows.length} sampel terakhir dari {data.samples.length}. Garis terputus pada pembacaan gagal atau jeda lebih dari satu jam. Indeks kelembapan bukan kadar air volumetrik.</figcaption></figure>
    <section><h2>Perawatan tercatat</h2>{events.length ? <table><thead><tr><th>Waktu sesi</th><th>Tindakan</th></tr></thead><tbody>{events.slice(-12).map((event, index) => <tr key={index}><td>{time(event.t_h)}</td><td>{event.label}</td></tr>)}</tbody></table> : <p>Belum ada perawatan tercatat.</p>}<p>Maksimal 12 tindakan dari catatan sesi yang tersedia. Siraman dibatalkan tidak disertakan. Volume bukan saran dosis; pupuk hanya catatan pengguna.</p></section>
    <footer>Ringkasan data simulasi lokal. Belum terhubung ke sensor atau perangkat nyata; bukan diagnosis tanaman atau model agronomi yang tervalidasi. Ekspor JSON di menu Berkas untuk menyimpan data sesi lengkap.</footer>
  </article>
}
