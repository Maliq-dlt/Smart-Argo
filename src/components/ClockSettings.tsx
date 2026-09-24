import { Clock3, ChevronDown } from 'lucide-react'
import { clockDate, clockTime, utcLabel, type SessionClock } from '../lib/sessionClock'

export default function ClockSettings({ clock, hour, onChange }: { clock: SessionClock; hour: number; onChange: (clock: SessionClock) => void }) {
  return <details className="clock-settings"><summary><Clock3 />{utcLabel(clock, hour)} · {clock.offsetMinutes === null ? 'Zona perangkat' : 'Zona manual'}<ChevronDown /></summary>
    <div><label>Zona waktu tampilan<select aria-label="Zona waktu sesi" value={clock.offsetMinutes === null ? 'system' : clock.offsetMinutes} onChange={e => onChange({ ...clock, offsetMinutes: e.target.value === 'system' ? null : Number(e.target.value) })}>
      <option value="system">Ikuti perangkat · {Intl.DateTimeFormat().resolvedOptions().timeZone}</option>
      {Array.from({ length: 105 }, (_, i) => -720 + i * 15).map(offset => <option key={offset} value={offset}>{utcLabel({ ...clock, offsetMinutes: offset }, hour)}</option>)}
    </select></label><p>Web, grafik, dan terminal memakai acuan waktu yang sama. UTC dan durasi HST tetap saat zona diganti. Siklus langit mengikuti jam lokal yang dipilih.</p><small>Awal sesi: {clockDate(clock, 0)} {clockTime(clock, 0)}. Waktu simulasi bergerak saat dijalankan.</small></div>
  </details>
}
