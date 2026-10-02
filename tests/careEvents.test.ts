import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { careEvents } from '../src/lib/chartData.ts'
import { createJourney, plantSeed, advanceSimulation, waterSimulation, recordFertilizer } from '../src/lib/simulation.ts'
import type { LogEntry } from '../src/lib/sessionStore.ts'

const scenario = JSON.parse(readFileSync(new URL('../src/lib/scenarios.json', import.meta.url), 'utf8'))[0]

test('Catatan perawatan mengikuti tindakan nyata tanpa menggandakan siraman atau mengubah data', () => {
  let session = plantSeed(createJourney(scenario))
  session = waterSimulation(advanceSimulation(session, 2), 150)
  session = recordFertilizer(advanceSimulation(session, 1))
  const before = structuredClone(session)
  const events = careEvents(session.logs, session.data)
  assert.deepEqual(events.map(event => [event.kind, event.t_h]), [['plant', 0], ['water', 1], ['feed', 1.5]])
  assert.equal(events[1].label, 'Siram 150 mL')
  assert.deepEqual(session, before)
})

test('Siraman data lama tetap tampil; waktu impor yang rusak atau di masa depan diabaikan', () => {
  const session = waterSimulation(advanceSimulation(plantSeed(createJourney(scenario)), 2), 150)
  const log = session.logs.find(log => log.message.startsWith('Siram'))!
  const logs: LogEntry[] = ['bukan-waktu', '-1:00:00', '00:60:00', '00:00:60', '02:00:00'].map((time, id) => ({ ...log, id, time }))
  const events = careEvents(logs, session.data)
  assert.equal(events.length, 1)
  assert.equal(events[0].t_h, 1)
  assert.match(events[0].message, /data sesi/)
  assert.equal(careEvents([{ ...log, kind: 'fault' }], { ...session.data, watering: null }).length, 0)
})

test('Log manual dan jam panjang dapat dibaca; pengaturan biasa tidak dianggap perawatan', () => {
  const session = createJourney(scenario)
  const logs: LogEntry[] = [
    { id: 0, kind: 'action', time: '120:30:00', message: 'Penyiraman 150 mL dicatat. Menunggu sampel respons.' },
    { id: 1, kind: 'system', time: '120:30:00', message: 'Zona waktu diubah.' },
  ]
  const events = careEvents(logs, { ...session.data, now_h: 121 })
  assert.equal(events.length, 1)
  assert.equal(events[0].t_h, 120.5)
})