import { SelectField } from './ui/select'
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { evaluate } from '../lib/agronomyEngine'
import { clockTime, clockDate, utcLabel } from '../lib/sessionClock'
import { type Session } from '../lib/sessionStore'

export default function SessionComparison({ sessions, activeId, onSnapshot }: {
  sessions: Session[]; activeId: string; onSnapshot: () => string
}) {
  const [leftId, setLeftId] = useState(activeId)
  const [rightId, setRightId] = useState(sessions.find(s => s.id !== activeId)?.id ?? '')
  const left = sessions.find(s => s.id === leftId), right = sessions.find(s => s.id === rightId)
  const selectors = [{ value: leftId, set: setLeftId, label: 'Sesi A' }, { value: rightId, set: setRightId, label: 'Sesi B' }]
  return <section className="panel session-comparison" aria-label="Perbandingan sesi">
    <div className="comparison-body">
      <p>Bandingkan nilai terakhir, tren, dan alasan tindakan. Simpan salinan sebelum mengubah masukan untuk membandingkan keadaan sebelum dan sesudah.</p>
      <button className="button" onClick={() => { const id = onSnapshot(); setLeftId(activeId); setRightId(id) }}><Copy />Simpan salinan sesi aktif</button>
      <div className="comparison-selectors">{selectors.map(({ value, set, label }) => <label key={label}>{label}<SelectField label={label} value={value} onValueChange={set} placeholder="Pilih sesi" options={sessions.map(s => ({ value: s.id, label: `${s.name} · ${s.data.samples.length} sampel${s.id === activeId ? ' (aktif)' : ''}` }))} /></label>)}</div>
      {left && right && left.id !== right.id ? <>
        <div className="session-comparison-grid">{[left, right].map((s, i) => {
          const { evidence, action, reason } = evaluate(s.data), last = s.data.samples.at(-1)!
          return <article key={s.id} className="comparison-session" aria-label={`Ringkasan sesi ${i === 0 ? 'A' : 'B'}`}>
            <h3>{s.name}</h3><p>{s.data.profile.crop} · {s.data.profile.media}</p>
            <dl><div><dt>Waktu sensor terakhir</dt><dd>{`${clockDate(s.clock, last.t_h)} ${clockTime(s.clock, last.t_h)}`} <small>{utcLabel(s.clock, last.t_h)}</small></dd></div>
              <div><dt>Kelembapan terakhir</dt><dd>{last.moisture} <small>/ 100</small></dd></div>
              <div><dt>Suhu terakhir</dt><dd>{last.temp_c} °C</dd></div>
              <div><dt>pH pada sampel terakhir</dt><dd>{last.ph ?? 'Tidak diukur'}</dd></div>
              <div><dt>Status sampel</dt><dd>{last.valid ? 'Valid' : 'Gagal'} · umur {Math.round((s.data.now_h - last.t_h) * 60)} menit</dd></div>
              <div><dt>Tren kelembapan</dt><dd>{evidence.slope_per_h === null ? 'Belum tersedia' : `${evidence.slope_per_h > 0 ? '+' : ''}${evidence.slope_per_h} poin/jam`}</dd></div>
              <div><dt>Kecocokan tren R²</dt><dd>{evidence.r2 ?? 'Belum tersedia'}</dd></div>
              <div><dt>Menuju acuan air</dt><dd>{evidence.eta_h === null ? 'Tidak diproyeksikan' : `${evidence.eta_h} jam`}</dd></div>
              <div><dt>Acuan air / kunjungan</dt><dd>{evidence.low} poin / {s.data.profile.next_visit_h} jam</dd></div></dl>
            <h4>{action}</h4><p className="comparison-reason">{reason}</p>
          </article>
        })}</div>
        <p className="comparison-caveat">Tren mengikuti kelayakan prediksi mesin; aturan yang lebih awal bisa menahannya. Perbedaan media dan acuan memengaruhi hasil. Ini perbandingan keputusan, bukan bukti keunggulan pertumbuhan tanaman.</p>
      </> : <p className="comparison-empty">{leftId && leftId === rightId ? 'Pilih dua sesi berbeda.' : 'Pilih dua sesi tersimpan, atau simpan salinan sesi aktif untuk mulai membandingkan.'}</p>}
    </div>
  </section>
}
