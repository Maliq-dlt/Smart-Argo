import assert from 'node:assert/strict'
import test from 'node:test'
import { bandSourceLabel, parseCarePlants, parseAlertPreferences, parseUnitHealth, parseOutlook, arrange, headline, statusOf, summaryLine, wateringWindow, type OverviewPlant } from '../src/lib/overview.ts'

// Plants here are SYNTHETIC: built for the test, not read from any pot.
const plant = (id: string, over: Partial<OverviewPlant> = {}): OverviewPlant => ({
  id, name: id, tag: null, place: null, species: 'cabai', moisture: 50, status: statusOf('AMATI', { learning: false, planted: true }),
  etaH: null, day: 10, planted: true, hour: 10, slotId: null, sessionId: id, ...over,
})
const dry = statusOf('PERIKSA_MEDIA_KERING', { learning: false, planted: true })
const soon = statusOf('PERIKSA_SEBELUM_PERGI', { learning: false, planted: true })

test('statusOf maps engine decisions to a word, a tone and whether it needs attention', () => {
  assert.deepEqual(dry, { tone: 'dry', word: 'Perlu disiram', attention: true })
  assert.equal(statusOf('PERIKSA_SENSOR', { learning: false, planted: true }).attention, true)
  assert.equal(statusOf('AMATI', { learning: false, planted: true }).word, 'Baik')
  assert.equal(soon.attention, false)
  assert.equal(statusOf('AMATI', { learning: true, planted: true }).tone, 'learn')
  // A learning plant's session is never validated, so the engine always asks for a local reference: that is the plan, not an alarm.
  assert.equal(statusOf('KALIBRASI_LOKAL', { learning: true, planted: true }).tone, 'learn')
  assert.equal(statusOf('UKUR_ULANG_PH', { learning: true, planted: true }).tone, 'learn')
  assert.equal(statusOf('PERIKSA_SENSOR', { learning: true, planted: true }).tone, 'check')
  assert.equal(statusOf('AMATI', { learning: false, planted: false }).word, 'Belum ditanam')
})

test('one plant is shown alone, as a wide card', () => {
  const out = arrange([plant('a')])
  assert.equal(out.mode, 'single'); assert.equal(out.featured.length, 1); assert.equal(out.rest.length, 0)
})

test('plants that need attention lead, at most three, the rest become tiles', () => {
  const list = [plant('ok1'), plant('d1', { status: dry }), plant('ok2'), plant('d2', { status: dry }), plant('d3', { status: dry }), plant('d4', { status: dry })]
  const out = arrange(list)
  assert.equal(out.mode, 'attention')
  assert.deepEqual(out.featured.map(p => p.id), ['d1', 'd2', 'd3'])
  assert.deepEqual(out.rest.map(p => p.id), ['d4', 'ok1', 'ok2'])
})

test('with nothing to do, the plant due soonest is featured as next', () => {
  const out = arrange([plant('late', { etaH: 20 }), plant('soon', { status: soon, etaH: 4 }), plant('none')])
  assert.equal(out.mode, 'next')
  assert.deepEqual(out.featured.map(p => p.id), ['soon'])
  assert.deepEqual(out.rest.map(p => p.id), ['late', 'none'])
})

test('headline names one plant, counts several, and is calm otherwise', () => {
  assert.equal(headline([plant('Cabai 1', { status: dry }), plant('b')]), 'Cabai 1 perlu disiram.')
  assert.equal(headline([plant('a', { status: dry }), plant('b', { status: dry })]), '2 tanaman perlu disiram.')
  assert.equal(headline([plant('a'), plant('b')]), 'Semua tanaman baik.')
  // A plant still being learned is not "fine" yet; nothing needs doing, which is what the sentence says.
  assert.equal(headline([plant('a'), plant('b', { status: statusOf('AMATI', { learning: true, planted: true }) })]), 'Tidak ada yang perlu dilakukan sekarang.')
  assert.equal(headline([plant('Cabai 1')]), 'Cabai 1 baik.')
  assert.equal(headline([plant('Cabai 1', { status: statusOf('PERIKSA_SENSOR', { learning: false, planted: true }) })]), 'Cabai 1 perlu diperiksa.')
})

test('summary line counts the others by state', () => {
  assert.equal(summaryLine([plant('a', { status: dry }), plant('b'), plant('c'), plant('d', { status: statusOf('AMATI', { learning: true, planted: true }) })]), '2 baik · 1 sedang dipelajari')
  assert.equal(summaryLine([plant('a')]), '')
})

test('watering window: now when dry, ±25 % of the projection otherwise, none beyond a day', () => {
  assert.deepEqual(wateringWindow(plant('a', { status: dry })), { from: 0, to: 0 })
  assert.deepEqual(wateringWindow(plant('a', { status: soon, etaH: 8 })), { from: 6, to: 10 })
  assert.equal(wateringWindow(plant('a', { etaH: 30 })), null)
  assert.equal(wateringWindow(plant('a', { etaH: null })), null)
})

// Scripted API examples: these are contract checks, not evidence from a physical pot.
test('server care labels keep per-pot provenance and missing readings explicit', () => {
  assert.equal(bandSourceLabel('own_pattern'), 'Berdasarkan pola pot Anda')
  assert.equal(bandSourceLabel('profile'), 'Profil kurasi untuk pot ini')
  const row = { slot_id: 'slot', unit_id: 'unit', name: 'Cabai', species_id: 1, moisture: null, state: 'no_reading', band_source: null, outlook: null }
  const [p] = parseCarePlants({ ok: true, plants: [row] })
  assert.equal(p.status.attention, true); assert.equal(p.status.word, 'Bacaan belum tersedia'); assert.equal(p.moisture, null)
  assert.equal(parseCarePlants({ ok: true, plants: [{ ...row, state: 'no_device', unit_id: null }] })[0].status.word, 'Belum ada perangkat')
  assert.equal(wateringWindow(p), null)
  assert.throws(() => parseCarePlants({ ok: true, plants: [{ ...row, state: 'unknown' }] }))
  assert.throws(() => parseCarePlants({ ok: false }))
  assert.throws(() => parseCarePlants({ ok: true, plants: [{ ...row, state: 'constructor' }] }))
  assert.throws(() => parseCarePlants({ ok: true, plants: [{ ...row, moisture: NaN }] }))
  assert.throws(() => parseOutlook({ state: 'window', from: 'invalid', to: null }))
  // The species comes from the shared catalog; an unknown id is a contract error, not a chili.
  assert.equal(parseCarePlants({ ok: true, plants: [{ ...row, species_id: 2 }] })[0].species, 'bawang')
  assert.throws(() => parseCarePlants({ ok: true, plants: [{ ...row, species_id: 99 }] }))
  // The stage draws the plant's real age and the WIB hour, not a day-0 seedling at 10:00.
  const at = Date.parse('2026-11-23T13:00:00Z') // 20.00 WIB
  const [aged] = parseCarePlants({ ok: true, plants: [row] }, { slot: '2026-11-13' }, at)
  assert.equal(aged.day, 10); assert.equal(aged.hour, 20)
  assert.equal(parseCarePlants({ ok: true, plants: [row] }, {}, at)[0].day, 0)
})
test('alert preferences validate every kind before presenting a saved result', () => {
  assert.deepEqual(parseAlertPreferences({ ok: true, email_enabled: false, kinds: ['soil_dry'] }), { email_enabled: false, kinds: ['soil_dry'] })
  assert.throws(() => parseAlertPreferences({ ok: true, email_enabled: true, kinds: ['invented'] }))
  assert.throws(() => parseAlertPreferences({ ok: false }))
})

test('malformed health histories are rejected before rendering', () => {
  const health = { ok: true, battery: [], upload_gaps: [], energy_days: [], packets: [], calibration: null }
  assert.equal(parseUnitHealth(health), health)
  assert.throws(() => parseUnitHealth({ ...health, battery: [null] }))
  assert.throws(() => parseUnitHealth({ ...health, packets: ['invalid'] }))
  assert.throws(() => parseUnitHealth({ ...health, calibration: 1 }))
})
