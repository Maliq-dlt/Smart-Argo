import { useEffect, useRef, useState, type FormEvent } from 'react'
import { exportRange, parseComparison, parseHistoryPage, parseJournalPage, weekWindows, type CareKind, type DeviceReading, type HistoryPage, type JournalPage, type SensorComparison, type TelemetryClient } from '../lib/deviceTelemetryClient'
import { SelectField } from './ui/select'

const KINDS: Record<CareKind, string> = { watering: 'Siram', fertilizing: 'Pupuk', inspection: 'Periksa', note: 'Catatan' }
const SENSORS = { moisture: 'Kelembapan (0–100)', soil_temperature: 'Suhu tanah (°C)', soil_ph: 'pH tanah' }
const pad = (n: number) => String(n).padStart(2, '0')
const day = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
const localNow = () => { const t = new Date(); return `${day(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}` }
const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
const num = (v: number | null, sign = false) => v === null ? '—' : `${sign && v > 0 ? '+' : ''}${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}`
const reading = (r: DeviceReading) => r.quality_status === 'ok' ? num(r.value_nullable) : r.quality_status === 'error' ? `Galat: ${r.error_message}` : 'Tidak diukur'
type Area = 'journal' | 'compare' | 'export'
type RangedPage = HistoryPage & { from: string; to: string }

/** One owned unit's care journal (what the owner did) and sensor history (what the device measured).
 * Backend contract: docs/care-history-api.md (Codex, stage 3). */
export default function ProductCareHistory({ client, unitId, onSessionExpired }: { client: TelemetryClient; unitId: string; onSessionExpired: () => void }) {
  const [journal, setJournal] = useState<JournalPage | null>(null)
  const [kind, setKind] = useState<CareKind>('watering')
  const [amount, setAmount] = useState('200')
  const [notes, setNotes] = useState('')
  const [at, setAt] = useState(localNow)
  const [compare, setCompare] = useState<SensorComparison[] | null>(null)
  const [fromDay, setFromDay] = useState(() => day(new Date(Date.now() - 6 * 86400000)))
  const [toDay, setToDay] = useState(() => day(new Date()))
  const [history, setHistory] = useState<RangedPage | null>(null)
  const [busy, setBusy] = useState(true)
  // A result shows next to the action that caused it; one always-mounted hidden region announces it once.
  const [message, setMessage] = useState<{ area: Area; text: string }>({ area: 'journal', text: '' })
  const alive = useRef(true)
  // A retried save sends the same request id and payload, so the server returns the first record instead of a copy.
  const retry = useRef<{ key: string; body: Record<string, unknown> } | null>(null)

  async function run(area: Area, task: () => Promise<string | void>) {
    setBusy(true); setMessage({ area, text: '' })
    try { const done = await task(); if (alive.current && done) setMessage({ area, text: done }) }
    catch (err) { if (!alive.current) return; setMessage({ area, text: err instanceof Error ? err.message : 'Permintaan gagal.' }); if (!client.session) onSessionExpired() }
    finally { if (alive.current) setBusy(false) }
  }
  const say = (area: Area) => message.area === area && message.text ? <p aria-hidden="true">{message.text}</p> : null
  // Older pages keep the first page's snapshot so entries saved meanwhile do not shift the cursor.
  const page = async (older?: JournalPage) => parseJournalPage(await client.rpc('read_my_care_journal', { p_unit_id: unitId, p_limit: 20,
    ...(older?.next && { p_snapshot_as_of: older.snapshot, p_before_observed_at: older.next.observed_at, p_before_id: older.next.id }) }))

  useEffect(() => {
    alive.current = true
    void run('journal', async () => { const first = await page(); if (alive.current) setJournal(first) })
    return () => { alive.current = false }
    // The parent keys this panel by unit, so it loads once per unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function save(event: FormEvent) {
    event.preventDefault()
    const fields = { p_kind: kind, p_observed_at: new Date(at).toISOString(), p_amount_ml: kind === 'watering' ? Number(amount) : null, p_notes: notes.trim() }
    const key = JSON.stringify(fields)
    const attempt = retry.current?.key === key ? retry.current : { key, body: { p_unit_id: unitId, p_request_id: crypto.randomUUID(), ...fields } }
    retry.current = attempt
    void run('journal', async () => {
      const result = await client.rpc('append_my_care_journal', attempt.body)
      retry.current = null
      const first = await page()
      if (!alive.current) return
      setJournal(first); setNotes(''); setAt(localNow())
      return result.idempotent ? 'Catatan ini sudah tersimpan.' : 'Catatan tersimpan.'
    })
  }

  // A page keeps its own range and the first page's snapshot, so editing the dates afterwards cannot break the cursor.
  const readings = (from: string, to: string, older?: RangedPage) => run('export', async () => {
    const next = parseHistoryPage(await client.rpc('read_my_measurement_history', { p_unit_id: unitId, p_from: from, p_to: to, p_limit: 60,
      ...(older?.next && { p_snapshot_as_of: older.snapshot, p_cursor_at: older.next.measured_at, p_cursor_id: older.next.id }) }))
    if (!alive.current) return
    setHistory({ ...next, from, to, readings: older ? [...older.readings, ...next.readings] : next.readings })
    if (!older && !next.readings.length) return 'Belum ada bacaan dalam rentang ini.'
  })

  function download(event: FormEvent) {
    event.preventDefault()
    void run('export', async () => {
      const range = exportRange(fromDay, toDay)
      const { csv, rows } = await client.exportHistory(unitId, range.from, range.to)
      const url = URL.createObjectURL(csv), link = document.createElement('a')
      link.href = url; link.download = `smart-agro-${fromDay}_${toDay}.csv`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return `${rows} bacaan diunduh.`
    })
  }

  return <section className="care-history" aria-labelledby={`care-${unitId}`} aria-busy={busy}>
    <h4 id={`care-${unitId}`}>Jurnal perawatan</h4>
    <p>Catatan Anda sendiri. Tidak mengubah bacaan sensor, tidak menyalakan pompa, dan tidak memberi reward.</p>
    <p className="sr-only" aria-live="polite">{message.text}</p>
    <form onSubmit={save}><fieldset className="product-account-form" disabled={busy}><legend>Catat tindakan</legend>
      <label className="miro-field"><span>Jenis</span><SelectField label="Jenis tindakan" value={kind} onValueChange={v => setKind(v as CareKind)} options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} /></label>
      {kind === 'watering' && <label className="miro-field"><span>Air (ml)</span><input type="number" required min={1} max={100000} step={1} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
      <label className="miro-field"><span>Waktu</span><input type="datetime-local" required value={at} max={localNow()} onChange={e => setAt(e.target.value)} /></label>
      <label className="miro-field"><span>{kind === 'note' ? 'Catatan' : 'Catatan (opsional)'}</span><textarea required={kind === 'note'} maxLength={2000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <button className="button" type="submit">Simpan catatan</button>
    </fieldset></form>
    {say('journal')}
    {journal && (journal.entries.length
      ? <ul className="miro-list" aria-label="Catatan perawatan">{journal.entries.map(e => <li key={e.id}><div>
          <strong>{KINDS[e.kind]}{e.amount_ml !== null && ` ${e.amount_ml} ml`}</strong> · {when(e.observed_at)}{e.notes && <p>{e.notes}</p>}
        </div></li>)}</ul>
      : <p>Belum ada catatan dalam 31 hari terakhir.</p>)}
    {journal?.next && <button className="button" type="button" disabled={busy} onClick={() => void run('journal', async () => { const older = await page(journal); if (alive.current) setJournal({ ...older, entries: [...journal.entries, ...older.entries] }) })}>Muat yang lebih lama</button>}

    <h4>Histori sensor</h4>
    <button className="button" type="button" disabled={busy} onClick={() => void run('compare', async () => {
      const rows = parseComparison(await client.rpc('compare_my_measurement_history', { p_unit_id: unitId, ...weekWindows() }))
      if (alive.current) setCompare(rows)
      if (!rows.length) return 'Belum ada bacaan dalam dua minggu terakhir.'
    })}>Bandingkan dengan minggu lalu</button>
    {say('compare')}
    {!!compare?.length && <div className="care-compare-wrap"><table className="care-compare">
      <caption className="sr-only">Rata-rata 7 hari terakhir dibanding 7 hari sebelumnya</caption>
      <thead><tr><th scope="col">Sensor</th><th scope="col">Minggu lalu</th><th scope="col">7 hari terakhir</th><th scope="col">Selisih</th></tr></thead>
      <tbody>{compare.map(s => <tr key={s.sensor_id}>
        <th scope="row">{SENSORS[s.sensor_id]}</th>
        <td>{num(s.first.avg)}<small>{s.first.eligible} bacaan</small></td>
        <td>{num(s.second.avg)}<small>{s.second.eligible} bacaan</small></td>
        <td>{num(s.avg_delta, true)}</td>
      </tr>)}</tbody>
    </table></div>}
    {!!compare?.length && <small>Hanya bacaan OK dengan jam tersinkron. Selisih menggambarkan data, bukan penyebab.</small>}
    <form onSubmit={download}><fieldset className="product-account-form" disabled={busy}><legend>Bacaan per rentang tanggal</legend>
      <label className="miro-field"><span>Dari</span><input type="date" required value={fromDay} max={toDay} onChange={e => setFromDay(e.target.value)} /></label>
      <label className="miro-field"><span>Sampai</span><input type="date" required value={toDay} min={fromDay} onChange={e => setToDay(e.target.value)} /></label>
      <div className="miro-actions-row">
        <button className="button" type="button" onClick={() => { try { const r = exportRange(fromDay, toDay); void readings(r.from, r.to) } catch (err) { setMessage({ area: 'export', text: err instanceof Error ? err.message : 'Rentang tidak valid.' }) } }}>Tampilkan bacaan</button>
        <button className="button" type="submit">Unduh CSV</button>
      </div>
      <small>Berisi data sensor pribadi. Paling lama 31 hari per rentang.</small>
    </fieldset></form>
    {say('export')}
    {!!history?.readings.length && <ul className="miro-list care-readings" aria-label="Bacaan dalam rentang" tabIndex={0}>{history.readings.map(r => <li key={r.id}><div>
      <strong>{SENSORS[r.sensor_id]}: {reading(r)}</strong> · {when(r.measured_at)}{r.clock_status === 'unsynced' && ' · jam perangkat belum tersinkron'}
    </div></li>)}</ul>}
    {history?.next && <button className="button" type="button" disabled={busy} onClick={() => void readings(history.from, history.to, history)}>Muat bacaan lebih lama</button>}
  </section>
}
