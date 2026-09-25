import { Clock3, ChevronDown } from 'lucide-react'
import { clockDate, clockTime, utcLabel, type SessionClock } from '../lib/sessionClock'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { SelectField } from './ui/select'

export default function ClockSettings({ clock, hour, onChange }: { clock: SessionClock; hour: number; onChange: (clock: SessionClock) => void }) {
  return <Popover><PopoverTrigger asChild><button className="clock-settings-trigger"><Clock3 />{utcLabel(clock, hour)} · {clock.offsetMinutes === null ? 'Zona perangkat' : 'Zona manual'}<ChevronDown /></button></PopoverTrigger>
    <PopoverContent className="clock-popover" align="end" aria-label="Pengaturan zona waktu">
      <h2>Zona waktu</h2><label className="settings-field">Tampilan web & terminal<SelectField label="Zona waktu sesi" value={clock.offsetMinutes === null ? 'system' : clock.offsetMinutes}
        onValueChange={value => onChange({ ...clock, offsetMinutes: value === 'system' ? null : Number(value) })}
        options={[{ value: 'system', label: `Ikuti perangkat · ${Intl.DateTimeFormat().resolvedOptions().timeZone}` }, ...Array.from({ length: 105 }, (_, i) => -720 + i * 15).map(offset => ({ value: offset, label: utcLabel({ ...clock, offsetMinutes: offset }, hour) }))]} /></label>
      <p>Web, grafik, dan terminal memakai waktu yang sama. Mengganti zona tidak mengubah durasi HST. Langit mengikuti jam lokal pilihan.</p><small>Awal sesi: {clockDate(clock, 0)} {clockTime(clock, 0)}.</small>
    </PopoverContent>
  </Popover>
}
