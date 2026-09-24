import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createSession, parseBook, parseSession, readBook, saveBook, appendSession, exportSession, importSession, STORAGE_KEY, type SessionBook } from '../src/lib/sessionStore.ts'
import { chartSegments } from '../src/lib/chartData.ts'
import { evaluate, type PotCase } from '../src/lib/agronomyEngine.ts'

const cases: PotCase[] = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))
function fixture() {
  const session = createSession(cases[0], 'Cabai sebelum siram', '0', 42)
  const book: SessionBook = { version: 1, activeId: session.id, sessions: [session] }
  let raw: string | null = null
  const storage = { getItem: (key: string) => key === STORAGE_KEY ? raw : null, setItem: (key: string, value: string) => { assert.equal(key, STORAGE_KEY); raw = value } }
  return { session, book, storage }
}

test('Sesi pulih lengkap: data, draf, HST, kecepatan, volume, pH baru, dan log', () => {
  const { session, book, storage } = fixture()
  session.day = 85; session.speed = 5; session.volume = '225'; session.freshPh = true; session.reading.moisture = 66
  const raw = saveBook(storage, book, null)
  assert.deepEqual(readBook(storage), { book, raw })
  assert.equal(evaluate(readBook(storage).book!.sessions[0].data).decision, 'PERIKSA_SEBELUM_PERGI')
})

test('Ganti skenario dan salinan tidak menghapus atau mengubah sesi lama', () => {
  const { book } = fixture(), before = structuredClone(book)
  const second = createSession(cases[1], 'Cabai stabil', '1', 25)
  const next = appendSession(book, second)
  assert.deepEqual(book, before)
  assert.deepEqual(next.sessions[0], before.sessions[0])
  assert.equal(next.sessions.length, 2); assert.equal(next.activeId, second.id)
  const third = createSession(cases[7], 'Bawang', '7', 25)
  assert.equal(appendSession(next, third, false).activeId, second.id)
})

test('Kuota gagal menyimpan: simpanan sebelumnya tetap utuh', () => {
  const { book, storage } = fixture(), raw = saveBook(storage, book, null)
  const next = appendSession(book, createSession(cases[1], 'Kedua'))
  const full = { getItem: storage.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.throws(() => saveBook(full, next, raw), /QuotaExceededError/)
  assert.equal(storage.getItem(STORAGE_KEY), raw)
})

test('Perubahan tab lain terdeteksi sebelum menimpa simpanan', () => {
  const { book, storage } = fixture(), raw = saveBook(storage, book, null)
  const other = appendSession(book, createSession(cases[7], 'Tab lain'))
  const changed = saveBook(storage, other, raw)
  assert.throws(() => saveBook(storage, book, raw), /tab lain/)
  assert.equal(storage.getItem(STORAGE_KEY), changed)
})

test('Simpanan rusak, versi asing, sesi duplikat, dan metadata invalid ditolak', () => {
  const { book, storage, session } = fixture()
  storage.setItem(STORAGE_KEY, '{broken')
  assert.throws(() => readBook(storage)); assert.equal(storage.getItem(STORAGE_KEY), '{broken')
  assert.throws(() => parseBook({ ...book, version: 2 }), /Versi/)
  assert.throws(() => parseBook({ ...book, activeId: 'absent' }))
  assert.throws(() => parseBook({ ...book, sessions: [session, session] }))
  assert.throws(() => parseSession({ ...session, updatedAt: Infinity }))
  assert.throws(() => parseSession({ ...session, day: 91 }))
  assert.throws(() => parseSession({ ...session, speed: 100 }))
  assert.throws(() => parseSession({ ...session, freshPh: 'true' }))
  assert.throws(() => parseSession({ ...session, reading: { ...session.reading, moisture: 101 } }))
  assert.throws(() => parseSession({ ...session, logs: [{ id: 0, time: '0', kind: 'script', message: 'x' }] }))
})

test('Ekspor/impor sesi baru pulih lengkap tanpa menggandakan data atau percaya output impor', () => {
  const { session } = fixture()
  session.reading.temp_c = 36; session.freshPh = true; session.volume = '250'; session.day = 60
  const exported = exportSession(session)
  assert.ok(!('data' in exported.session)); assert.ok(!('logs' in exported.session))
  const imported = importSession(JSON.parse(JSON.stringify(exported)), 'Import')
  assert.notEqual(imported.id, session.id)
  assert.deepEqual({ ...imported, id: session.id, updatedAt: session.updatedAt }, session)
  assert.equal(evaluate(imported.data).decision, evaluate(session.data).decision)
  assert.throws(() => importSession({ ...exported, input: { ...session.data, samples: [] } }, 'Bad'))
  assert.throws(() => importSession({ ...exported, version: 3 }, 'Future'), /Versi/)
})

test('Kasus Python dan ekspor versi 1 tetap diterima', () => {
  assert.deepEqual(importSession(cases[1], 'Python').data, cases[1])
  const { session } = fixture()
  const imported = importSession({ source: 'simulasi_sintetis', version: 1, input: session.data, hst_illustration: 44, logs: session.logs }, 'Lama')
  assert.equal(imported.day, 44); assert.deepEqual(imported.logs, session.logs)
})

test('Garis grafik terputus pada gagal, null pH, atau jeda lebih dari 1 jam', () => {
  const rows = structuredClone(cases[1].samples)
  rows[2].valid = false
  assert.deepEqual(chartSegments(rows, 'moisture').map(s => s.length), [2, 3])
  assert.ok(chartSegments(rows, 'moisture').every(s => s.every(r => r.valid)))
  rows[2].valid = true; rows[2].ph = null
  assert.deepEqual(chartSegments(rows, 'ph').map(s => s.length), [2, 3])
  assert.deepEqual(chartSegments(rows, 'temp_c').map(s => s.length), [6])
  rows[3].t_h = 5; rows[4].t_h = 5.5; rows[5].t_h = 6
  assert.deepEqual(chartSegments(rows, 'moisture').map(s => s.length), [3, 3])
  assert.deepEqual(chartSegments(rows.map(r => ({ ...r, ph: null })), 'ph'), [])
})
