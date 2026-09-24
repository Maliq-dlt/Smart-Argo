import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clockTime, clockDate, logClock, utcLabel, instantAt, parseClock } from '../src/lib/sessionClock.ts'
import { createSession, parseSession, exportSession, importSession } from '../src/lib/sessionStore.ts'
import { scenePeriod, skyAt, advanceSimulation, createJourney, plantSeed, simulationOf } from '../src/lib/simulation.ts'
import { parseTelemetry, deviceStatuses } from '../src/lib/telemetry.ts'

const cases = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))
const example = JSON.parse(readFileSync(new URL('../public/telemetry-example.json', import.meta.url), 'utf8'))
test('UTC tunggal menyamakan jam/log, menangani tengah malam dan offset 15 menit', () => {
  const clock = { startedAtMs: Date.parse('2024-02-28T23:30:00Z'), offsetMinutes: 0 }
  assert.equal(clockTime(clock, .5), '00:00:00'); assert.equal(clockDate(clock, .5), '29/02/2024')
  assert.equal(logClock(clock, '24:30:00'), '01/03/2024 00:00:00')
  const nepal = { ...clock, offsetMinutes: 345 }
  assert.equal(clockTime(nepal, .5), '05:45:00'); assert.equal(utcLabel(nepal, 0), 'UTC+05:45')
  assert.equal(instantAt(nepal, .5), instantAt(clock, .5))
  for (const offsetMinutes of [841, -721, 421, NaN]) assert.throws(() => parseClock({ ...clock, offsetMinutes }, 0))
  assert.throws(() => parseClock({ startedAtMs: '2024', offsetMinutes: null }, 0))
  assert.throws(() => parseClock(null, 0))
})
test('Zona sistem mengikuti perangkat; perubahan zona tidak mengubah UTC dan HST', () => {
  const clock = { startedAtMs: Date.parse('2026-09-24T12:30:00Z'), offsetMinutes: null }
  const date = new Date(clock.startedAtMs)
  assert.equal(clockTime(clock, 0).slice(0, 2), String(date.getHours()).padStart(2, '0'))
  const utc = { ...clock, offsetMinutes: 0 }, wib = { ...clock, offsetMinutes: 420 }
  assert.equal(scenePeriod(0, utc), 'Siang'); assert.equal(scenePeriod(0, wib), 'Malam')
  assert.equal(skyAt(0, wib).light, 0)
  let s = plantSeed(createJourney(cases[0])); s = { ...s, clock: utc, simulation: { ...simulationOf(s), pauseOnCare: false } }
  const next = advanceSimulation(s, 48)
  assert.equal(next.day, 1); assert.equal(next.data.now_h, 24)
  assert.equal(instantAt({ ...next.clock, offsetMinutes: -300 }, next.data.now_h), instantAt(next.clock, next.data.now_h))
})
test('Sesi lama mendapat acuan stabil, metadata UTC/paket dipulihkan lewat ekspor', () => {
  const s = createSession(cases[0], 'Sesi')
  const legacy: Partial<typeof s> = { ...s }; delete legacy.clock
  const migrated = parseSession(legacy)
  assert.equal(instantAt(migrated.clock, migrated.data.now_h), migrated.updatedAt)
  assert.deepEqual(parseSession(migrated).clock, migrated.clock)
  const packet = parseTelemetry(example)
  const saved = { ...s, deviceSnapshot: { packet, importedAt: Date.now() } }
  const restored = importSession(exportSession(saved), 'Pulih')
  assert.deepEqual(restored.clock, saved.clock); assert.deepEqual(restored.deviceSnapshot, saved.deviceSnapshot)
  assert.deepEqual(restored.data, s.data)
  assert.throws(() => parseSession({ ...s, clock: null }))
})
test('Batas HST dicatat sebagai acuan, terpisah dari fase perkembangan model', () => {
  const base = plantSeed(createJourney(cases[0]))
  const s = { ...base, day: 30, data: { ...base.data, now_h: 743.5, samples: [{ ...base.data.samples[0], t_h: 743.5 }] },
    simulation: { ...simulationOf(base), growthHours: 240, pauseOnCare: false } }
  const next = advanceSimulation(s)
  assert.equal(next.day, 31)
  assert.ok(next.logs.some(l => l.message.includes('Acuan HST 31: Berbunga') && l.message.includes('tidak dideteksi sensor')))
  assert.ok(simulationOf(next).growthHours < 241)
})
test('Paket memisahkan galat, kosong, nilai nol dan status aliran tak terverifikasi', () => {
  const packet = parseTelemetry(example)
  assert.equal(packet.measured_at, '2026-09-23T23:00:00.000Z')
  const statuses = deviceStatuses(packet, Date.parse(packet.measured_at))
  assert.equal(statuses.find(s => s.label === 'Suhu tanah')?.severity, 'error')
  assert.equal(statuses.find(s => s.label === 'pH tanah')?.severity, 'warning')
  const on = { ...packet, drip: { installed: true, command: 'on' as const, feedback: 'on' as const, flow_ml_min: null, fault: null } }
  assert.match(deviceStatuses(on).at(-1)!.message, /belum terverifikasi/)
  assert.equal(deviceStatuses({ ...on, drip: { ...on.drip, flow_ml_min: 0 } }).at(-1)!.severity, 'warning')
  assert.equal(deviceStatuses({ ...on, drip: { ...on.drip, flow_ml_min: 5 } }).at(-1)!.severity, 'ok')
  assert.equal(deviceStatuses({ ...on, drip: { ...on.drip, fault: 'NO_FLOW' } }).at(-1)!.severity, 'error')
  assert.equal(deviceStatuses(packet, Date.parse(packet.measured_at) + 300001)[0].severity, 'warning')
  assert.equal(deviceStatuses(packet, Date.parse(packet.measured_at) - 300001)[0].severity, 'error')
})
test('Batas paket menolak timestamp lokal, tanggal mustahil, nilai gagal palsu, dan status tetesan kontradiktif', () => {
  for (const measured_at of ['2026-09-24T06:00:00', '2026-02-30T00:00:00Z', '2026-09-24T24:00:00Z']) assert.throws(() => parseTelemetry({ ...example, measured_at }))
  for (const value of [101, '55', Infinity, null]) assert.throws(() => parseTelemetry({ ...example, sensors: { ...example.sensors, moisture: { status: 'ok', value } } }))
  assert.throws(() => parseTelemetry({ ...example, sensors: { ...example.sensors, soil_temperature: { status: 'error', value: 25, error: 'CRC' } } }))
  assert.throws(() => parseTelemetry({ ...example, drip: { ...example.drip, command: 'on' } }))
  assert.throws(() => parseTelemetry({ ...example, schema_version: 2 }))
})
