import { useState } from 'react'
import { Copy, GitCompareArrows, ChevronDown, X, Sprout, FlaskConical, Pencil, ArrowUpRight, Check } from 'lucide-react'
import { evaluate } from '../lib/agronomyEngine'
import { clockTime, clockDate, utcLabel } from '../lib/sessionClock'
import { type Session } from '../lib/sessionStore'
import { simulationOf, simulationStopped } from '../lib/simulation'

export function SessionLibrary({ sessions, activeId, running, onResume, onRename, onClose }: {
  sessions: Session[]; activeId: string; running: boolean; onResume: (id: string) => void; onRename: (id: string, name: string) => void; onClose: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const finishRename = (id: string) => { setEditing(null); document.getElementById(`rename-${id}`)?.focus({ preventScroll: true }) }
  return <>
    <div className="dialog-heading"><div><span className="library-eyebrow">Ruang tersimpan · {sessions.length} sesi</span><h2 id="sessions-title">Lanjutkan sesi</h2><p>Kembali ke tanaman dan eksplorasi terakhir.</p></div><button className="icon-button" onClick={onClose} aria-label="Tutup daftar sesi"><X /></button></div>
    <ul className="session-list">{[...sessions].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId) || b.updatedAt - a.updatedAt).map(s => {
      const active = s.id === activeId, journey = simulationOf(s).mode === 'journey'
      return <li key={s.id} className="session-card" data-active={active}>
        <header><span className="session-card-icon" aria-hidden="true">{journey ? <Sprout /> : <FlaskConical />}</span><div><span className="session-kind">{journey ? 'Perjalanan tanam' : 'Eksperimen'}{active && <span className="session-active"><Check />Aktif</span>}</span><h3 title={s.name}>{s.name}</h3><p>{s.data.profile.crop} · {s.data.profile.media}</p></div><button id={`rename-${s.id}`} className="icon-button rename-session" aria-label={`Ubah nama ${s.name}`} title="Ubah nama" aria-expanded={editing === s.id} onClick={() => setEditing(editing === s.id ? null : s.id)}><Pencil /></button></header>
        {editing === s.id && <form className="session-rename" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishRename(s.id) } }} onSubmit={e => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement
          const name = input.value.trim()
          if (!name) { input.setCustomValidity('Masukkan nama sesi.'); input.reportValidity(); return }
          onRename(s.id, name); finishRename(s.id)
        }}><label className="sr-only" htmlFor={`name-${s.id}`}>Nama sesi {s.name}</label><input autoFocus id={`name-${s.id}`} name="name" defaultValue={s.name} required maxLength={120} onInput={e => e.currentTarget.setCustomValidity('')} /><button className="button" type="submit">Simpan</button><button className="text-button" type="button" onClick={() => finishRename(s.id)}>Batal</button></form>}
        <dl className="session-facts"><div><dt>Riwayat sensor</dt><dd>{s.data.samples.length} <span>sampel</span></dd></div><div><dt>Waktu sesi · {clockDate(s.clock, s.data.now_h)}</dt><dd>{clockTime(s.clock, s.data.now_h)} <span>{utcLabel(s.clock, s.data.now_h)}</span></dd></div></dl>
        <footer><time dateTime={new Date(s.updatedAt).toISOString()}>Disimpan {new Date(s.updatedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><button className={`button ${active ? 'primary' : ''}`} onClick={() => active && running ? onClose() : onResume(s.id)}>{active && running ? 'Kembali ke sesi' : simulationStopped(s) ? 'Buka sesi' : 'Lanjutkan'}<ArrowUpRight /></button></footer>
      </li>
    })}</ul>
    <p className="library-footnote">Tersimpan di browser ini. Gunakan ekspor JSON untuk cadangan atau pindah perangkat.</p>
  </>
}

export default function SessionComparison({ sessions, activeId, onSnapshot }: {
  sessions: Session[]; activeId: string; onSnapshot: () => string
}) {
  const [leftId, setLeftId] = useState(activeId)
  const [rightId, setRightId] = useState(sessions.find(s => s.id !== activeId)?.id ?? '')
  const left = sessions.find(s => s.id === leftId), right = sessions.find(s => s.id === rightId)
  const selectors = [{ value: leftId, set: setLeftId, label: 'Sesi A' }, { value: rightId, set: setRightId, label: 'Sesi B' }]
  return <details className="panel session-comparison">
    <summary><GitCompareArrows /><span>Bandingkan sesi<small>Dua riwayat, nilai terakhir, dan alasan tindakan</small></span><ChevronDown /></summary>
    <div className="comparison-body">
      <p>Bandingkan nilai terakhir, tren, dan alasan tindakan. Simpan salinan sebelum mengubah masukan untuk membandingkan keadaan sebelum dan sesudah.</p>
      <button className="button" onClick={() => { const id = onSnapshot(); setLeftId(activeId); setRightId(id) }}><Copy />Simpan salinan sesi aktif</button>
      <div className="comparison-selectors">{selectors.map(({ value, set, label }) => <label key={label}>{label}<select aria-label={label} value={value} onChange={e => set(e.target.value)}><option value="">Pilih sesi</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.data.samples.length} sampel{s.id === activeId ? ' (aktif)' : ''}</option>)}</select></label>)}</div>
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
  </details>
}
