import type { ReadingStatus } from './telemetry'
import type { ProductAccountClient } from './productAccountClient'
export interface DeviceUnit { unit_id: string; product_id: string; serial_public: string; location_label: string; device_id: string; device_status: 'active' | 'revoked' | 'offline'; profile_version_id: string }
export interface PublishedProfile { id: string; species_variety: string; version: number; evidence_level: string }
export interface DeviceReading { id: string; sensor_id: 'moisture' | 'soil_temperature' | 'soil_ph'; quality_status: ReadingStatus; value_nullable: number | null; error_message: string | null; measured_at: string; received_at: string; source: 'device'; clock_status: 'synced' | 'unsynced'; sequence: number; boot_id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isId = (v: unknown): v is string => typeof v === 'string' && uuid.test(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const date = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
function rows(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max || value.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('Respons perangkat tidak valid.')
  return value
}
export function parseDeviceUnits(value: unknown): DeviceUnit[] {
  return rows(value, 1000).map(v => {
    if (![v.unit_id,v.product_id,v.device_id,v.profile_version_id].every(isId) || !text(v.serial_public,120) || !text(v.location_label,120) || !['active','revoked','offline'].includes(String(v.device_status))) throw new Error('Data unit tidak valid.')
    return v as unknown as DeviceUnit
  })
}
export function parsePublishedProfiles(value: unknown): PublishedProfile[] {
  return rows(value,1000).map(v => {
    if (!isId(v.id) || !text(v.species_variety,240) || !Number.isInteger(v.version) || Number(v.version)<1 || Number(v.version)>2147483647 || !text(v.evidence_level,240)) throw new Error('Profil terbit tidak valid.')
    return v as unknown as PublishedProfile
  })
}
export function parseDeviceReadings(value: unknown): DeviceReading[] {
  return rows(value,120).map(v => {
    const range = v.sensor_id === 'moisture' ? [0,100] : v.sensor_id === 'soil_temperature' ? [-20,60] : [0,14]
    if (!isId(v.id) || !isId(v.boot_id) || !['moisture','soil_temperature','soil_ph'].includes(String(v.sensor_id)) || !['ok','error','not_measured'].includes(String(v.quality_status)) || !['synced','unsynced'].includes(String(v.clock_status)) || v.source!=='device' || !date(v.measured_at) || !date(v.received_at) || !Number.isInteger(v.sequence) || Number(v.sequence)<0 || Number(v.sequence)>2147483647 || (v.error_message!==null && !text(v.error_message,240))) throw new Error('Bacaan perangkat tidak valid.')
    if (v.quality_status==='ok' ? typeof v.value_nullable!=='number' || !Number.isFinite(v.value_nullable) || v.value_nullable<range[0] || v.value_nullable>range[1] : v.value_nullable!==null) throw new Error('Nilai sensor tidak valid.')
    if (v.quality_status==='error' && !text(v.error_message,240)) throw new Error('Keterangan galat sensor tidak tersedia.')
    return v as unknown as DeviceReading
  })
}
export type TelemetryClient = Pick<ProductAccountClient, 'rpc' | 'session' | 'explain' | 'exportHistory'>

// Care journal and history (docs/care-history-api.md). The journal is the owner's own report: it never changes
// readings, pumps or rewards.
export type CareKind = 'watering' | 'fertilizing' | 'inspection' | 'note'
export interface CareEntry { id: string; kind: CareKind; observed_at: string; amount_ml: number | null; notes: string | null }
export interface JournalPage { entries: CareEntry[]; snapshot: string; next: { observed_at: string; id: string } | null }
export function parseJournalPage(value: Record<string, unknown>): JournalPage {
  const entries = rows(value.entries, 100).map(v => {
    // The server stores "no notes" as '' (p_notes defaults to ''); it is shown as no notes.
    if (!isId(v.id) || !['watering','fertilizing','inspection','note'].includes(String(v.kind)) || !date(v.observed_at) || (v.notes!==null && v.notes!==undefined && v.notes!=='' && !text(v.notes,2000))
      || (v.kind==='watering' ? !Number.isFinite(v.amount_ml) || Number(v.amount_ml)<=0 || Number(v.amount_ml)>100000 : v.amount_ml!==null && v.amount_ml!==undefined)) throw new Error('Catatan perawatan tidak valid.')
    return { id: v.id, kind: v.kind as CareKind, observed_at: v.observed_at, amount_ml: v.kind==='watering' ? Number(v.amount_ml) : null, notes: typeof v.notes==='string' && v.notes ? v.notes : null }
  })
  const next = value.next_cursor as Record<string, unknown> | null
  if (!date(value.snapshot_as_of) || (next!==null && (!next || !date(next.observed_at) || !isId(next.id)))) throw new Error('Halaman jurnal tidak valid.')
  return { entries, snapshot: value.snapshot_as_of, next: next && { observed_at: next.observed_at as string, id: next.id as string } }
}

// read_my_measurement_history: newest first; older pages keep the first page's receipt cutoff (snapshot).
export interface HistoryPage { readings: DeviceReading[]; snapshot: string; next: { measured_at: string; id: string } | null }
export function parseHistoryPage(value: Record<string, unknown>): HistoryPage {
  const readings = parseDeviceReadings(value.readings)
  const next = value.next_cursor as Record<string, unknown> | null
  if (!date(value.snapshot_as_of) || (next!==null && (!next || !date(next.measured_at) || !isId(next.id)))) throw new Error('Halaman riwayat tidak valid.')
  return { readings, snapshot: value.snapshot_as_of, next: next && { measured_at: next.measured_at as string, id: next.id as string } }
}

type Sensor = DeviceReading['sensor_id']
export interface SensorComparison { sensor_id: Sensor; first: { avg: number | null; eligible: number }; second: { avg: number | null; eligible: number }; avg_delta: number | null }
const avg = (v: unknown) => v===null || (typeof v==='number' && Number.isFinite(v))
export function parseComparison(value: Record<string, unknown>): SensorComparison[] {
  return rows(value.sensors, 3).map(s => {
    const side = (v: unknown) => { const r = v as Record<string, unknown>; if (!r || typeof r!=='object' || !avg(r.avg) || !Number.isInteger(r.eligible_count) || Number(r.eligible_count)<0) throw new Error('Perbandingan histori tidak valid.'); return { avg: r.avg as number | null, eligible: Number(r.eligible_count) } }
    if (!['moisture','soil_temperature','soil_ph'].includes(String(s.sensor_id)) || !avg(s.avg_delta)) throw new Error('Perbandingan histori tidak valid.')
    return { sensor_id: s.sensor_id as Sensor, first: side(s.first), second: side(s.second), avg_delta: s.avg_delta as number | null }
  })
}

// APP-02/03: unit overview and management (my_unit_overview, my_units).
export type UnitAlert = 'no_data' | 'stale' | 'sensor_error' | 'device_revoked' | 'energy_deficit' | 'battery_low'
export interface UnitOverview {
  unit_id: string; location_label: string; serial_public: string; last_packet_at: string | null; alerts: UnitAlert[]
  sensors: { sensor_id: Sensor; quality_status: ReadingStatus; value_nullable: number | null; measured_at: string }[]
  energy: { windows: number; solar_wh: number | null; load_wh: number | null; battery_soc_pct: number | null }
  assessment: { state: string; at: string } | null
  /** Latest packet's cell voltage (firmware battery object, migration 20261121010000). */
  battery: { voltage: number; measured_at: string } | null
}
const ALERTS = ['no_data','stale','sensor_error','device_revoked','energy_deficit','battery_low']
const num = (v: unknown) => v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : (() => { throw new Error('Angka tidak valid.') })()
export function parseOverview(value: Record<string, unknown>): UnitOverview[] {
  return rows(value.units, 1000).map(u => {
    if (!isId(u.unit_id) || !text(u.location_label, 120) || !text(u.serial_public, 120) || (u.last_packet_at !== null && !date(u.last_packet_at))
      || !Array.isArray(u.alerts) || u.alerts.some(a => !ALERTS.includes(String(a)))) throw new Error('Ringkasan unit tidak valid.')
    const sensors = rows(u.sensors, 3).map(s => {
      if (!['moisture','soil_temperature','soil_ph'].includes(String(s.sensor_id)) || !['ok','error','not_measured'].includes(String(s.quality_status)) || !date(s.measured_at)) throw new Error('Ringkasan sensor tidak valid.')
      return { sensor_id: s.sensor_id as Sensor, quality_status: s.quality_status as ReadingStatus, value_nullable: num(s.value_nullable), measured_at: s.measured_at as string }
    })
    const e = (u.energy ?? {}) as Record<string, unknown>, a = u.assessment as Record<string, unknown> | null, b = u.battery as Record<string, unknown> | null | undefined
    return { unit_id: u.unit_id, location_label: u.location_label, serial_public: u.serial_public, last_packet_at: u.last_packet_at as string | null, alerts: u.alerts as UnitAlert[], sensors,
      energy: { windows: Number(e.windows) || 0, solar_wh: num(e.solar_wh), load_wh: num(e.load_wh), battery_soc_pct: num(e.battery_soc_pct) },
      assessment: a && typeof a.state === 'string' && date(a.at) ? { state: a.state, at: a.at } : null,
      battery: b && typeof b.voltage === 'number' && b.voltage >= 2.5 && b.voltage <= 4.5 && date(b.measured_at) ? { voltage: b.voltage, measured_at: b.measured_at } : null }
  })
}
export interface OwnedUnit { unit_id: string; product_id: string; serial_public: string; variant: 'single_pot' | 'garden'; location_label: string; species_variety: string; archived_at: string | null }
export interface OwnedDevice { device_id: string; product_id: string; status: 'active' | 'revoked' | 'offline'; unit_id: string | null }
export function parseUnits(value: Record<string, unknown>): { units: OwnedUnit[]; devices: OwnedDevice[] } {
  const units = rows(value.units, 1000).map(u => {
    if (![u.unit_id, u.product_id].every(isId) || !text(u.serial_public, 120) || !['single_pot','garden'].includes(String(u.variant)) || !text(u.location_label, 120)
      || !text(u.species_variety, 240) || (u.archived_at !== null && !date(u.archived_at))) throw new Error('Daftar unit tidak valid.')
    return { unit_id: u.unit_id as string, product_id: u.product_id as string, serial_public: u.serial_public, variant: u.variant as OwnedUnit['variant'], location_label: u.location_label, species_variety: u.species_variety, archived_at: u.archived_at as string | null }
  })
  const devices = rows(value.devices, 1000).map(d => {
    if (![d.device_id, d.product_id].every(isId) || !['active','revoked','offline'].includes(String(d.status)) || (d.unit_id !== null && !isId(d.unit_id))) throw new Error('Daftar perangkat tidak valid.')
    return { device_id: d.device_id as string, product_id: d.product_id as string, status: d.status as OwnedDevice['status'], unit_id: d.unit_id as string | null }
  })
  return { units, devices }
}

const DAY = 86400000
/** Date inputs (YYYY-MM-DD, both days included, local time) → the export's [from,to) in canonical UTC, at most 31 days. */
export function exportRange(fromDay: string, toDay: string) {
  const from = new Date(`${fromDay}T00:00`), end = new Date(`${toDay}T00:00`)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(end.getTime()) || end < from) throw new Error('Pilih tanggal awal yang tidak melewati tanggal akhir.')
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
  if (to.getTime() - from.getTime() > 31 * DAY) throw new Error('Rentang paling lama 31 hari.')
  return { from: from.toISOString(), to: to.toISOString() }
}
/** The last seven days against the seven before them; half-open windows that touch but never overlap. */
export function weekWindows(now = Date.now()) {
  const iso = (t: number) => new Date(t).toISOString()
  return { p_first_from: iso(now - 14 * DAY), p_first_to: iso(now - 7 * DAY), p_second_from: iso(now - 7 * DAY), p_second_to: iso(now) }
}
