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
export type TelemetryClient = Pick<ProductAccountClient, 'rpc' | 'session' | 'explain'>
