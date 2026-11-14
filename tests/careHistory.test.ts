import assert from 'node:assert/strict'
import test from 'node:test'
import { exportRange, parseComparison, parseHistoryPage, parseJournalPage, weekWindows } from '../src/lib/deviceTelemetryClient.ts'
import { ProductAccountClient } from '../src/lib/productAccountClient.ts'

// Contract: docs/care-history-api.md (backend stage 3).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('journal pages keep the cursor and reject a watering entry without an amount', () => {
  const page = parseJournalPage({ snapshot_as_of: '2026-11-14T05:00:00.000Z', next_cursor: { observed_at: '2026-11-13T01:00:00.000Z', id: id(2) },
    entries: [{ id: id(1), kind: 'watering', observed_at: '2026-11-14T01:00:00.000Z', amount_ml: 200, notes: null }, { id: id(2), kind: 'note', observed_at: '2026-11-13T01:00:00.000Z', amount_ml: null, notes: 'Daun menguning' }] })
  assert.deepEqual(page.next, { observed_at: '2026-11-13T01:00:00.000Z', id: id(2) })
  assert.equal(page.entries[1].notes, 'Daun menguning')
  assert.throws(() => parseJournalPage({ snapshot_as_of: '2026-11-14T05:00:00.000Z', next_cursor: null, entries: [{ id: id(1), kind: 'watering', observed_at: '2026-11-14T01:00:00.000Z', amount_ml: null }] }))
})

test('comparison keeps null averages as null, never zero', () => {
  const [row] = parseComparison({ sensors: [{ sensor_id: 'moisture', first: { avg: null, eligible_count: 0 }, second: { avg: 61.5, eligible_count: 40 }, avg_delta: null }] })
  assert.equal(row.first.avg, null)
  assert.equal(row.avg_delta, null)
  assert.throws(() => parseComparison({ sensors: [{ sensor_id: 'moisture', first: { avg: 'x', eligible_count: 0 }, second: { avg: 1, eligible_count: 1 }, avg_delta: 1 }] }))
})

test('CSV range includes both days and stops at 31 days', () => {
  const one = exportRange('2026-11-01', '2026-11-01')
  assert.match(one.from, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(Date.parse(one.to) - Date.parse(one.from), 86400000)
  assert.doesNotThrow(() => exportRange('2026-11-01', '2026-12-01'))
  assert.throws(() => exportRange('2026-11-01', '2026-12-02'), /31 hari/)
  assert.throws(() => exportRange('2026-11-05', '2026-11-01'))
})

test('the two comparison weeks touch but do not overlap (server rejects overlap)', () => {
  const w = weekWindows(Date.parse('2026-11-14T00:00:00.000Z'))
  assert.equal(w.p_first_to, w.p_second_from)
  assert.ok(!(w.p_first_from < w.p_second_to && w.p_second_from < w.p_first_to))
})

test('backend codes get Indonesian text, and prototype names are not treated as codes', async () => {
  Object.assign(globalThis, { sessionStorage: { setItem() {}, getItem: () => null, removeItem() {} } })
  const answers = [{ ok: false, code: 'range_too_large', message: 'Too many measurements.' }, { ok: false, code: 'toString', message: 'Server words' }]
  globalThis.fetch = (async () => new Response(JSON.stringify(answers.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
  const client = new ProductAccountClient()
  client.session = { access_token: 'a.b.c', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600 }
  await assert.rejects(client.rpc('compare_my_measurement_history', {}), /Perkecil rentangnya/)
  await assert.rejects(client.rpc('compare_my_measurement_history', {}), /^Error: Server words$/)
})

test('history pages carry the receipt snapshot and cursor; a failed sensor stays null', () => {
  const reading = (n: number, extra: Record<string, unknown>) => ({ id: id(n), unit_id: id(90), device_id: id(91), packet_id: id(92), sensor_id: 'moisture', quality_status: 'ok', value_nullable: 41,
    error_message: null, measured_at: '2026-11-14T01:00:00.123456+00:00', received_at: '2026-11-14T01:00:02+00:00', source: 'device', clock_status: 'synced', sequence: 3, boot_id: id(93), ...extra })
  const page = parseHistoryPage({ snapshot_as_of: '2026-11-14T05:00:00.5+00:00', next_cursor: { measured_at: '2026-11-14T01:00:00.123456+00:00', id: id(2) },
    readings: [reading(1, {}), reading(2, { sensor_id: 'soil_temperature', quality_status: 'error', value_nullable: null, error_message: 'Probe disconnected' })] })
  assert.equal(page.snapshot, '2026-11-14T05:00:00.5+00:00')
  assert.deepEqual(page.next, { measured_at: '2026-11-14T01:00:00.123456+00:00', id: id(2) })
  assert.equal(page.readings[1].value_nullable, null)
  assert.throws(() => parseHistoryPage({ snapshot_as_of: 'nanti', next_cursor: null, readings: [] }))
  assert.throws(() => parseHistoryPage({ snapshot_as_of: '2026-11-14T05:00:00Z', next_cursor: null, readings: [reading(3, { quality_status: 'error', value_nullable: 0, error_message: 'x' })] }))
})
