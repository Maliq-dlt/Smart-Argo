export type ReadingStatus = 'ok' | 'error' | 'not_measured'
export interface DeviceReading { value: number | null; status: ReadingStatus; error?: string }
export interface TelemetryPacket {
  schema_version: 1; source: 'device' | 'example'; device_id: string; sample_id: string; measured_at: string
  sensors: { moisture: DeviceReading; soil_temperature: DeviceReading; soil_ph: DeviceReading }
  drip: { command: 'on' | 'off' | 'unknown'; feedback: 'on' | 'off' | 'unknown'; flow_ml_min: number | null; fault: string | null; installed: boolean }
}
export interface DeviceSnapshot { packet: TelemetryPacket; importedAt: number }
export interface DeviceStatus { label: string; severity: 'ok' | 'warning' | 'error'; message: string }
function object(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Paket perangkat harus berupa objek JSON.')
}
function text(v: unknown, label: string, max = 120): asserts v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label} harus teks 1–${max} karakter.`)
}
export function parseTelemetry(input: unknown): TelemetryPacket {
  object(input)
  if (input.schema_version !== 1 || !['device', 'example'].includes(input.source as string)) throw new Error('schema_version harus 1 dan source harus device atau example.')
  text(input.device_id, 'device_id'); text(input.sample_id, 'sample_id'); text(input.measured_at, 'measured_at', 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(input.measured_at) || !Number.isFinite(Date.parse(input.measured_at)))
    throw new Error('measured_at harus ISO 8601 dengan Z atau offset UTC eksplisit.')
  // Date.parse normalizes impossible dates; reject them at the import boundary.
  const day = input.measured_at.slice(0, 10), time = input.measured_at.slice(11, 19)
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day || +time.slice(0, 2) > 23 || +time.slice(3, 5) > 59 || +time.slice(6, 8) > 59)
    throw new Error('Tanggal atau jam pengukuran tidak valid.')
  object(input.sensors)
  const specs = [['moisture', 0, 100], ['soil_temperature', -20, 60], ['soil_ph', 0, 14]] as const
  const sensors = {} as TelemetryPacket['sensors']
  for (const [name, low, high] of specs) {
    const r = input.sensors[name]; object(r)
    if (!['ok', 'error', 'not_measured'].includes(r.status as string)) throw new Error(`Status ${name} tidak valid.`)
    if (r.status === 'ok' ? typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < low || r.value > high : r.value !== null)
      throw new Error(`${name}: status ok memerlukan nilai ${low}–${high}; status lain harus null.`)
    if (r.error !== undefined) text(r.error, `error ${name}`, 240)
    if (r.status === 'error' && !r.error) throw new Error(`${name}: sertakan keterangan error.`)
    sensors[name] = { value: r.value as number | null, status: r.status as ReadingStatus, ...(r.error ? { error: r.error as string } : {}) }
  }
  const d = input.drip; object(d)
  if (typeof d.installed !== 'boolean' || !['on', 'off', 'unknown'].includes(d.command as string) || !['on', 'off', 'unknown'].includes(d.feedback as string) ||
    (d.flow_ml_min !== null && (typeof d.flow_ml_min !== 'number' || !Number.isFinite(d.flow_ml_min) || d.flow_ml_min < 0 || d.flow_ml_min > 100000))) throw new Error('Status atau aliran pengatur tetesan tidak valid.')
  if (d.fault !== null) text(d.fault, 'fault tetesan', 240)
  if (!d.installed && (d.command !== 'unknown' || d.feedback !== 'unknown' || d.flow_ml_min !== null || d.fault !== null)) throw new Error('Tetesan tidak terpasang: perintah/umpan balik unknown, aliran/fault null.')
  return { schema_version: 1, source: input.source as TelemetryPacket['source'], device_id: input.device_id, sample_id: input.sample_id,
    measured_at: new Date(input.measured_at).toISOString(), sensors, drip: { installed: d.installed, command: d.command as TelemetryPacket['drip']['command'], feedback: d.feedback as TelemetryPacket['drip']['feedback'], flow_ml_min: d.flow_ml_min as number | null, fault: d.fault as string | null } }
}
export function deviceStatuses(packet: TelemetryPacket, now = Date.now()): DeviceStatus[] {
  const age = now - Date.parse(packet.measured_at)
  const rows: DeviceStatus[] = [{ label: 'Waktu paket', severity: age < -300000 ? 'error' : age > 300000 ? 'warning' : 'ok',
    message: age < -300000 ? 'Waktu perangkat lebih dari 5 menit di masa depan; periksa sinkronisasi jam.' : age > 300000 ? 'Pengukuran lebih tua dari 5 menit. Paket ini tidak menunjukkan kondisi saat ini.' : 'Timestamp pengukuran dalam rentang 5 menit dari jam perangkat pengguna.' }]
  for (const [key, label, unit] of [['moisture', 'Kelembapan kapasitif', 'poin'], ['soil_temperature', 'Suhu tanah', '°C'], ['soil_ph', 'pH tanah', 'pH']] as const) {
    const r = packet.sensors[key]
    rows.push({ label, severity: r.status === 'error' ? 'error' : r.status === 'not_measured' ? 'warning' : 'ok', message: r.status === 'error' ? r.error! : r.status === 'not_measured' ? 'Tidak diukur; tidak diganti dengan nol atau nilai lama.' : `${r.value} ${unit} · dilaporkan valid oleh perangkat` })
  }
  const d = packet.drip
  const flowMismatch = d.command === 'on' && d.flow_ml_min === 0 || d.command === 'off' && d.flow_ml_min !== null && d.flow_ml_min > 0
  rows.push({ label: 'Pengatur tetesan', severity: d.fault ? 'error' : !d.installed || d.feedback === 'unknown' || d.flow_ml_min === null || d.command !== d.feedback || flowMismatch ? 'warning' : 'ok',
    message: !d.installed ? 'Belum terpasang.' : d.fault ? `Perangkat melaporkan gangguan: ${d.fault}` : `Perintah ${d.command}; umpan balik ${d.feedback}; ${d.flow_ml_min === null ? 'aliran belum diukur' : `aliran ${d.flow_ml_min} mL/menit`}. ${d.feedback === 'unknown' || d.flow_ml_min === null ? 'Status tetesan belum terverifikasi.' : d.command !== d.feedback ? 'Perintah dan umpan balik berbeda; periksa perangkat.' : flowMismatch ? 'Aliran tidak sesuai perintah. Periksa waktu mulai operasi dan saluran; satu paket belum membuktikan sumbatan atau kebocoran.' : 'Status sesuai paket; bukan hasil pemeriksaan fisik.'}` })
  return rows
}
