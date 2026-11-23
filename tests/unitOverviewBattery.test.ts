import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOverview } from '../src/lib/deviceTelemetryClient.ts'
import { parseTelemetryV2 } from '../src/lib/telemetry.ts'

const unit = (battery?: unknown) => ({ unit_id: '11111111-1111-4111-8111-111111111111', location_label: 'Teras', serial_public: 'SA-1',
  last_packet_at: '2026-11-21T10:00:00Z', alerts: [], sensors: [], energy: { windows: 0 }, assessment: null,
  ...(battery === undefined ? {} : { battery }) })

test('overview battery voltage is optional and bounded', () => {
  const [ok, missing, nonsense, empty] = parseOverview({ units: [
    unit({ voltage: 3.92, measured_at: '2026-11-21T10:00:00Z' }), unit(), unit({ voltage: 12, measured_at: '2026-11-21T10:00:00Z' }), unit(null),
  ] })
  assert.deepEqual(ok.battery, { voltage: 3.92, measured_at: '2026-11-21T10:00:00Z' })
  assert.equal(missing.battery, null, 'servers before 20261121010000 send no battery key')
  assert.equal(nonsense.battery, null)
  assert.equal(empty.battery, null)
})

test('telemetry v2 accepts the optional battery object without counting it as a sensor', () => {
  const packet = parseTelemetryV2({ domain: 'smart-agro.telemetry.v2', schema_version: 2, source: 'device',
    device_id: '22222222-2222-4222-8222-222222222222', unit_id: '33333333-3333-4333-8333-333333333333',
    boot_id: '44444444-4444-4444-8444-444444444444', sequence: 1, measured_at: '2026-11-21T10:00:00Z', clock_status: 'synced',
    sensors: { moisture: { status: 'ok', value: 50 }, soil_temperature: { status: 'ok', value: 26 }, soil_ph: { status: 'not_measured', value: null } },
    battery: { status: 'ok', value: 3.92 } })
  assert.equal(Object.keys(packet.sensors).length, 3)
})
