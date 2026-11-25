import assert from 'node:assert/strict'
import test from 'node:test'
import { ariaFor, LABELS, labelsFor, READING_INTERVAL_MIN, type DeviceMode } from '../src/components/device/deviceFacts.ts'
import { solarInput } from '../src/lib/landingNarrative.ts'

test('Label perangkat memakai angka dari kode, bukan tulisan tangan', () => {
  assert.equal(LABELS.baterai.note, `target desain ${solarInput.autonomyDays} hari`)
  assert.equal(LABELS.led.note, `tiap ${READING_INTERVAL_MIN} menit`)
  assert.equal(LABELS.probe.note, 'kelembapan · suhu · pH')
  assert.equal(LABELS.panel.title, 'Panel surya')
  assert.equal(LABELS.esp32.title, 'ESP32')
})

test('Tiap keadaan perangkat menampilkan label yang sesuai', () => {
  assert.deepEqual(labelsFor('studio'), [])
  assert.deepEqual(labelsFor('label'), ['panel', 'led', 'probe'])
  assert.deepEqual([...labelsFor('tembus')].sort(), ['baterai', 'esp32', 'led', 'panel', 'probe'])
  // Named once: the soil and numbers scenes animate what the parts do instead of naming them again.
  assert.deepEqual(labelsFor('tanah'), [])
  assert.deepEqual(labelsFor('angka'), [])
})

test('Setiap keadaan punya deskripsi aksesibel yang berbeda', () => {
  const modes: DeviceMode[] = ['studio', 'label', 'tembus', 'tanah', 'angka']
  const texts = modes.map(ariaFor)
  assert(texts.every(text => text.length > 0))
  assert.equal(new Set(texts).size, modes.length)
})
