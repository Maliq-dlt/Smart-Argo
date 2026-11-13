import assert from 'node:assert/strict'
import test from 'node:test'
import type { DecisionCode } from '../src/lib/agronomyEngine.ts'
import { moodFor, settledMood } from '../src/lib/mascot.ts'
import { explainDeviceEvidence } from '../src/lib/deviceExplanation.ts'

test('Setiap keputusan aturan punya satu ekspresi sesuai tabel spesifikasi', () => {
  const table: Record<DecisionCode, string> = {
    KALIBRASI_LOKAL: 'unknown', PULIHKAN_DATA: 'unknown', PERIKSA_SENSOR: 'unknown', AMATI: 'calm',
    PERIKSA_MEDIA_KERING: 'care', PERIKSA_SIRAMAN: 'care', PERIKSA_SEBELUM_PERGI: 'care',
    PERIKSA_PANAS: 'alert', PERIKSA_DRAINASE: 'alert', UKUR_ULANG_PH: 'alert',
  }
  for (const [decision, mood] of Object.entries(table)) assert.equal(moodFor(decision as DecisionCode), mood, decision)
})

test('Kondisi memburuk tampil seketika; membaik baru tampil setelah dua evaluasi sepakat', () => {
  assert.equal(settledMood('PERIKSA_PANAS', 'AMATI'), 'alert')
  assert.equal(settledMood('PERIKSA_MEDIA_KERING', 'AMATI'), 'care')
  // Noise around a threshold: one calm sample after a dry one keeps the attentive face.
  assert.equal(settledMood('AMATI', 'PERIKSA_MEDIA_KERING'), 'care')
  assert.equal(settledMood('AMATI', 'AMATI'), 'calm')
  assert.equal(settledMood('PERIKSA_SIRAMAN', 'PERIKSA_DRAINASE'), 'alert')
  assert.equal(settledMood('AMATI', null), 'calm')
})

test('Kualitas data selalu didahulukan dan tidak menahan wajah lama', () => {
  assert.equal(settledMood('PULIHKAN_DATA', 'PERIKSA_PANAS'), 'unknown')
  assert.equal(settledMood('AMATI', 'PERIKSA_SENSOR'), 'calm')
})

test('Penjelasan perangkat memakai pemetaan maskot yang sama', () => {
  const context = { ok: true as const, unit_id: '00000000-0000-4000-8000-000000000001', device_id: '00000000-0000-4000-8000-000000000002', ownership_id: '00000000-0000-4000-8000-000000000003', profile_version_id: '00000000-0000-4000-8000-000000000004', device_status: 'active', registry_status: 'active', evaluated_at: '2026-11-13T00:00:00Z', profile: null, packets: [] }
  assert.equal(explainDeviceEvidence(context).mascot_state, 'bingung_menunggu')
})
