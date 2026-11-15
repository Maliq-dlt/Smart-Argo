import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { conditionFromWmo, fromOpenMeteo, isSimWeather, simKind, simulatedWeather, weatherNote, type SimWeather } from '../src/lib/weather.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/open-meteo-forecast.json', import.meta.url), 'utf8'))
const KINDS: SimWeather[] = ['cerah', 'berawan', 'mendung', 'hujan', 'terik']

test('the Open-Meteo adapter reads the current conditions and the six hours after the current hour', () => {
  const w = fromOpenMeteo(fixture)
  assert.equal(w.at, '2026-11-15T14:15')
  assert.equal(w.condition, 'mendung')
  assert.deepEqual([w.tempC, w.humidity, w.cloud, w.windMs, w.rainMm], [29.4, 74, 88, 2.4, 0])
  assert.deepEqual(w.forecast.map(f => f.inHours), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(w.forecast.map(f => f.condition), ['mendung', 'hujan', 'hujan', 'hujan', 'hujan', 'berawan'])
  assert.deepEqual(w.forecast.map(f => f.rainMm), [0, 1.2, 3.4, 2.1, 0.3, 0])
  assert.equal(w.forecast[0].tempC, 28.2)
})

test('WMO codes map to the five conditions and unknown values fall back to cloudy instead of throwing', () => {
  const table: [number, string][] = [[0, 'cerah'], [1, 'cerah'], [2, 'berawan'], [3, 'mendung'], [45, 'mendung'], [48, 'mendung'], [51, 'hujan'], [57, 'hujan'], [61, 'hujan'], [67, 'hujan'], [80, 'hujan'], [82, 'hujan'], [95, 'badai'], [99, 'badai']]
  for (const [code, condition] of table) assert.equal(conditionFromWmo(code), condition, `code ${code}`)
  for (const odd of [999, -1, 71, 85, null, undefined, 'abc', NaN, {}, []]) assert.equal(conditionFromWmo(odd), 'berawan', `value ${String(odd)}`)
})

test('an unreadable response is an error, but missing optional parts only shorten the snapshot', () => {
  for (const bad of [null, 'x', 42, {}, { current: null }, { current: { temperature_2m: 'warm' } }]) assert.throws(() => fromOpenMeteo(bad), /cuaca/i, JSON.stringify(bad))
  const bare = fromOpenMeteo({ current: { time: '2026-11-15T10:00', temperature_2m: 30, weather_code: 0 } })
  assert.deepEqual([bare.condition, bare.tempC, bare.humidity, bare.cloud, bare.windMs, bare.rainMm, bare.forecast.length], ['cerah', 30, 0, 0, 0, 0, 0])
})

test('a forecast that runs out of hours is shorter, and one that does not contain the current hour is empty', () => {
  const late = fromOpenMeteo({ current: { time: '2026-11-15T22:30', temperature_2m: 25, weather_code: 1 }, hourly: fixture.hourly })
  assert.deepEqual(late.forecast.map(f => f.inHours), [1])
  const elsewhere = fromOpenMeteo({ current: { time: '2026-12-01T10:00', temperature_2m: 25, weather_code: 1 }, hourly: fixture.hourly })
  assert.deepEqual(elsewhere.forecast, [])
})

test('every simulated weather is a full, self-consistent snapshot', () => {
  for (const kind of KINDS) {
    const w = simulatedWeather(kind)
    assert.equal(w.forecast.length, 6, kind)
    assert.ok(w.cloud >= 0 && w.cloud <= 100 && w.humidity >= 0 && w.humidity <= 100, kind)
    assert.equal(simKind(w), kind, `a simulated ${kind} reads back as ${kind}`)
  }
  assert.equal(simulatedWeather('hujan').condition, 'hujan')
  assert.ok(simulatedWeather('terik').tempC >= 33)
})

test('a thunderstorm is shown as rain, and a hot clear sky as terik', () => {
  assert.equal(simKind({ ...simulatedWeather('cerah'), condition: 'badai' }), 'hujan')
  assert.equal(simKind({ ...simulatedWeather('cerah'), tempC: 35 }), 'terik')
  assert.equal(simKind({ ...simulatedWeather('mendung'), tempC: 35 }), 'mendung')
})

test('indoors there is never a weather note; outdoors it speaks only about rain and heat', () => {
  for (const kind of KINDS) assert.equal(weatherNote(simulatedWeather(kind), 'indoor'), null, kind)
  assert.equal(weatherNote(simulatedWeather('cerah'), 'outdoor'), null)
  assert.equal(weatherNote(simulatedWeather('berawan'), 'rooftop'), null)
  assert.match(weatherNote(simulatedWeather('terik'), 'outdoor') ?? '', /suhu tinggi.*media/i)
  assert.match(weatherNote(simulatedWeather('hujan'), 'outdoor') ?? '', /sedang hujan/i)
  const coming = weatherNote(fromOpenMeteo(fixture), 'rooftop') ?? ''
  assert.match(coming, /hujan sekitar 2 jam lagi/i)
})

test('a note quotes only numbers that are in the snapshot and never a dose', () => {
  const snapshots = [...KINDS.map(simulatedWeather), fromOpenMeteo(fixture)]
  for (const w of snapshots) for (const placement of ['outdoor', 'rooftop'] as const) {
    const note = weatherNote(w, placement)
    if (note === null) continue
    assert.ok(!/\bml\b|liter|dosis|gram/i.test(note), `no dose in: ${note}`)
    for (const digits of note.match(/\d+/g) ?? []) assert.ok(w.forecast.some(f => String(f.inHours) === digits), `"${digits}" is not an hour from the forecast: ${note}`)
  }
})

test('only the five demo skies are accepted from storage, and prototype keys are not', () => {
  for (const kind of KINDS) assert.ok(isSimWeather(kind), kind)
  for (const odd of ['badai', 'constructor', '__proto__', 'toString', '', ' cerah', null, undefined, 3, {}]) assert.ok(!isSimWeather(odd), String(odd))
})
