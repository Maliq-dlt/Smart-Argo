import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addSample, evaluate, parseCase, phaseAt, recordWatering, type PotCase } from '../src/lib/agronomyEngine.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const cases: PotCase[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))
const clone = (index = 1) => structuredClone(cases[index])
const python = process.env.PYTHON ?? 'python'

test('10 skenario makalah dan nilai ETA', () => {
  for (const c of cases) assert.equal(evaluate(c).decision, c.expected, c.name)
  assert.equal(evaluate(cases[0]).evidence.eta_h, 1.33)
  assert.equal(evaluate(cases[7]).evidence.eta_h, 2.25)
})

test('Kesetaraan keputusan dan bukti terhadap Python untuk 110 kasus', () => {
  const samples = cases.map(c => structuredClone(c))
  // Deterministic inputs cover each priority and different local profiles.
  for (let i = 0; i < 100; i++) {
    const c = clone(i % cases.length)
    c.samples.forEach((r, j) => {
      r.moisture = Math.max(0, Math.min(100, r.moisture + (i % 11) - 5))
      r.temp_c = 25 + i % 14
      r.ph = j % 4 === 0 ? null : 4.5 + (i % 30) / 10
    })
    if (i % 13 === 0) c.profile.validated = false
    if (i % 17 === 0) c.profile.ph_validated = false
    samples.push(c)
  }
  const run = spawnSync(python, ['-c', 'import json,sys,simulasi_pot; print(json.dumps([simulasi_pot.evaluate(c) for c in json.load(sys.stdin)],ensure_ascii=True))'],
    { cwd: root, input: JSON.stringify(samples), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(run.status, 0, run.stderr || String(run.error))
  const expected = JSON.parse(run.stdout)
  samples.forEach((c, i) => {
    const actual = evaluate(c)
    // Python renders integral float ages as 0.0; JS renders 0.
    expected[i].evidence.ph_status = expected[i].evidence.ph_status.replace(/(\d+)\.0(?= jam)/g, '$1')
    assert.deepEqual(actual, expected[i], `Parity case ${i}`)
  })
})

test('Acuan tidak sah, media berubah, dan pH belum sah menahan aturan terkait', () => {
  const c = clone(5)
  c.profile.validated = false; assert.equal(evaluate(c).decision, 'KALIBRASI_LOKAL')
  c.profile.validated = true; c.media_changed = true; assert.equal(evaluate(c).decision, 'KALIBRASI_LOKAL')
  c.media_changed = false; c.profile.ph_validated = false; assert.equal(evaluate(c).decision, 'AMATI')
})

test('Data gagal dan umur tepat 5 menit / lebih dari 5 menit', () => {
  const c = clone(); c.samples.at(-1)!.valid = false
  assert.equal(evaluate(c).decision, 'PULIHKAN_DATA')
  c.samples.at(-1)!.valid = true
  c.now_h = c.samples.at(-1)!.t_h + 5 / 60 - 1e-9
  assert.notEqual(evaluate(c).decision, 'PULIHKAN_DATA')
  c.now_h += 1e-6; assert.equal(evaluate(c).decision, 'PULIHKAN_DATA')
})

test('Siram tercatat tidak mengarang respons dan memutus riwayat prediksi', () => {
  const c = clone(0), saved = JSON.stringify(c)
  const watered = recordWatering(c, 150)
  assert.deepEqual(watered.samples, c.samples)
  assert.equal(evaluate(watered).evidence.eta_h, null)
  assert.equal(JSON.stringify(c), saved)
  assert.throws(() => recordWatering(c, 0))
  assert.throws(() => recordWatering(c, NaN))
})

test('Respons siram dinilai pada sampel berikutnya dan lokasi probe', () => {
  const c = clone(3)
  assert.equal(evaluate(c).decision, 'PERIKSA_SIRAMAN')
  assert.match(evaluate(c).evidence.watering_response, /\+1.0 poin setelah 150 mL/)
  c.samples.at(-1)!.moisture = 45
  assert.equal(evaluate(c).decision, 'AMATI')
})

test('Lonjakan bertindakan dibedakan dari probe bermasalah', () => {
  const c = clone(4)
  assert.equal(evaluate(c).decision, 'PERIKSA_SENSOR')
  c.watering = { t_h: c.samples.at(-2)!.t_h, volume_ml: 100 }
  assert.notEqual(evaluate(c).decision, 'PERIKSA_SENSOR')
})

test('Basah menetap memerlukan durasi dan kontinuitas sampel', () => {
  const c = clone(2)
  c.samples = c.samples.slice(1)
  assert.notEqual(evaluate(c).decision, 'PERIKSA_DRAINASE')
  const gap = clone(2); gap.samples.splice(2, 2)
  assert.notEqual(evaluate(gap).decision, 'PERIKSA_DRAINASE')
})

test('pH tidak diukur adalah null; tiga nilai baru harus di sisi rentang yang sama', () => {
  const c = clone(5)
  c.samples.at(-1)!.ph = 7.5
  assert.equal(evaluate(c).decision, 'AMATI')
  c.samples.forEach(r => { r.ph = null })
  assert.equal(evaluate(c).evidence.ph_status, 'Belum ada pH tervalidasi yang mutakhir')
  assert.equal(evaluate(c).decision, 'AMATI')
})

test('Prediksi menolak riwayat kurang, terputus, gagal, dan horizon >12 jam', () => {
  const short = clone(0); short.samples.shift(); assert.equal(evaluate(short).evidence.eta_h, null)
  const failed = clone(0); failed.samples[2].valid = false; assert.equal(evaluate(failed).evidence.eta_h, null)
  const long = clone(0); long.samples.forEach((r, i) => { r.moisture = 95 - i }); assert.equal(evaluate(long).evidence.eta_h, null)
})

test('Batas masukan menolak jenis salah, NaN, duplikat, dan observasi tidak terpisah', () => {
  for (const bad of [NaN, Infinity, -1, 101, true, '55', null]) {
    const c = clone(); (c.samples.at(-1)! as unknown as Record<string, unknown>).moisture = bad
    assert.throws(() => parseCase(c))
  }
  assert.throws(() => parseCase(null)); assert.throws(() => parseCase({}))
  const c = clone(); c.samples.at(-1)!.t_h = c.samples.at(-2)!.t_h; assert.throws(() => parseCase(c))
  const overlap = clone(); overlap.profile.needs_water = [80, 80, 80]; assert.throws(() => parseCase(overlap))
  const string = clone(); (string as unknown as Record<string, unknown>).media_changed = 'false'; assert.throws(() => parseCase(string))
  const future = clone(); future.now_h = 0; assert.throws(() => parseCase(future))
  const excess = clone(); excess.samples = Array.from({ length: 10001 }, () => excess.samples[0]); assert.throws(() => parseCase(excess))
})

test('Sampel baru tidak menimpa riwayat; HST hanya fase ilustrasi', () => {
  const c = clone(), saved = JSON.stringify(c)
  const next = addSample(c, { moisture: 60, temp_c: 28, ph: null, valid: true })
  assert.equal(next.now_h, c.now_h + .5); assert.equal(next.samples.length, c.samples.length + 1)
  assert.deepEqual(next.samples.slice(0, -1), c.samples); assert.equal(JSON.stringify(c), saved)
  assert.equal(phaseAt(0, false), 'Awal tanam'); assert.equal(phaseAt(30, false), 'Vegetatif')
  assert.equal(phaseAt(31, false), 'Berbunga'); assert.equal(phaseAt(56, false), 'Berbuah')
  assert.equal(phaseAt(26, true), 'Pembentukan umbi'); assert.equal(phaseAt(51, true), 'Pematangan umbi')
})
