import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto'
import { parseTelemetryV2 } from '../src/lib/telemetry.ts'
import { parseDeviceReadings, parseDeviceUnits, parsePublishedProfiles } from '../src/lib/deviceTelemetryClient.ts'
import { verifyDeviceSignature } from '../supabase/functions/_shared/deviceSignature.ts'

const packet = () => ({ domain: 'smart-agro.telemetry.v2', schema_version: 2, source: 'device',
  device_id: randomUUID(), unit_id: randomUUID(), boot_id: randomUUID(), sequence: 1,
  measured_at: '2026-11-05T12:00:00+07:00', clock_status: 'synced', sensors: {
    moisture: { status: 'ok', value: 55 }, soil_temperature: { status: 'ok', value: 28 },
    soil_ph: { status: 'not_measured', value: null },
  } })
test('Telemetri v2 memvalidasi sumber, UUID, sequence, waktu dan kualitas per sensor', () => {
  const valid = parseTelemetryV2(packet())
  assert.equal(valid.measured_at, '2026-11-05T05:00:00.000Z')
  assert.equal(valid.sensors.soil_ph.value, null)
  for (const invalid of [
    { ...packet(), source: 'simulation' }, { ...packet(), domain: 'smart-agro.activation.v1' },
    { ...packet(), sequence: 0.5 }, { ...packet(), sequence: -1 }, { ...packet(), sequence: 2147483648 },
    { ...packet(), unit_id: 'other' }, { ...packet(), boot_id: 'reset' }, { ...packet(), clock_status: 'unknown' },
    { ...packet(), measured_at: '2026-02-30T12:00:00Z' }, { ...packet(), measured_at: '2026-11-05T12:00:00' },
    { ...packet(), sensors: { ...packet().sensors, moisture: { status: 'ok', value: 101 } } },
    { ...packet(), sensors: { ...packet().sensors, soil_ph: { status: 'error', value: 0, error: 'probe' } } },
    { ...packet(), sensors: { ...packet().sensors, moisture: { status: 'error', value: null } } },
  ]) assert.throws(() => parseTelemetryV2(invalid))
  assert.equal(parseTelemetryV2({ ...packet(), sensors: { ...packet().sensors,
    moisture: { status: 'error', value: null, error: 'Probe disconnected' } } }).sensors.moisture.status, 'error')
})
test('Ed25519 memverifikasi byte asli dan menolak perubahan paket, kunci, serta encoding palsu', async () => {
  const keys = generateKeyPairSync('ed25519'), message = JSON.stringify(packet())
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64')
  const signature = sign(null, Buffer.from(message), keys.privateKey).toString('base64')
  assert.equal(await verifyDeviceSignature(publicKey, signature, message), true)
  assert.equal(await verifyDeviceSignature(publicKey, signature, message + ' '), false)
  assert.equal(await verifyDeviceSignature(publicKey, signature, message.replace('55', '56')), false)
  assert.equal(await verifyDeviceSignature(publicKey, signature.slice(1), message), false)
  assert.equal(await verifyDeviceSignature(publicKey, 'sig:fake', message), false)
  const other = generateKeyPairSync('ed25519')
  assert.equal(await verifyDeviceSignature(Buffer.from(other.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64'), signature, message), false)
})

test('Owner response boundary rejects mismatched quality, sources, IDs and oversized history', () => {
  const reading = { id: randomUUID(), boot_id: randomUUID(), sensor_id: 'soil_ph', quality_status: 'not_measured', value_nullable: null, error_message: null, measured_at: new Date().toISOString(), received_at: new Date().toISOString(), source: 'device', clock_status: 'unsynced', sequence: 0 }
  assert.equal(parseDeviceReadings([reading])[0].value_nullable, null)
  for (const invalid of [{ ...reading, value_nullable: 0 }, { ...reading, quality_status: 'error' }, { ...reading, source: 'simulation' }, { ...reading, id: 'other' }, { ...reading, measured_at: 'not a date' }]) assert.throws(() => parseDeviceReadings([invalid]))
  assert.throws(() => parseDeviceReadings(Array(121).fill(reading)))
  assert.throws(() => parseDeviceUnits([{ unit_id: 'other' }]))
  assert.throws(() => parsePublishedProfiles([{ id: randomUUID(), version: 0 }]))
})
