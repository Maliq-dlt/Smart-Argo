import assert from 'node:assert/strict'
import test from 'node:test'
import { THRESHOLDS, dryingRate, evidenceLevel, healthyMoistureRange, measuredWaterings, observe, remaining, waterResponse, wateringTimes, type Inspection, type ReadingPoint } from '../src/lib/observation.ts'

// Every series here is SYNTHETIC: built for the test, not measured from any plant.
const point = (t_h: number, moisture: number, valid = true): ReadingPoint => ({ t_h, moisture, valid })
/** A steady synthetic drying: `perHour` points lost each hour from 6 in the morning (session hour 0 is 06:00). */
const drying = (hours: number, start = 70, perHour = 1.5, step = 0.5) => Array.from({ length: Math.round(hours / step) + 1 }, (_, i) => point(i * step, start - perHour * i * step))
const check = (t_h: number, state: Inspection['state'] = 'sehat'): Inspection => ({ t_h, state })

test('below any one threshold the evidence is level 0, and meeting all three is level 1', () => {
  const full = { days: 7, readings: 300, waterings: 2, inspections: [check(1), check(30), check(60)] }
  assert.equal(evidenceLevel(full), 1)
  assert.equal(evidenceLevel({ ...full, days: 6 }), 0)
  assert.equal(evidenceLevel({ ...full, waterings: 1 }), 0)
  assert.equal(evidenceLevel({ ...full, inspections: full.inspections.slice(0, 2) }), 0)
  assert.equal(evidenceLevel({ days: 0, readings: 0, waterings: 0, inspections: [] }), 0)
  assert.equal(evidenceLevel({ ...full, days: 3, waterings: 1 }, { days: 3, inspections: 3, waterings: 1 }), 1, 'the thresholds can be passed in')
  assert.deepEqual(THRESHOLDS, { days: 7, inspections: 3, waterings: 2 })
})

test('what is still missing counts down to zero and never below it', () => {
  assert.deepEqual(remaining({ days: 2, readings: 90, waterings: 0, inspections: [check(1)] }), { days: 5, inspections: 2, waterings: 2 })
  assert.deepEqual(remaining({ days: 30, readings: 900, waterings: 9, inspections: [check(1), check(2), check(3), check(4)] }), { days: 0, inspections: 0, waterings: 0 })
})

test('the healthy range comes only from readings in the six hours after a "sehat" check', () => {
  const samples = [...drying(48, 80, 1)]
  const range = healthyMoistureRange(samples, [check(10)])
  assert.ok(range, 'a range exists')
  // readings at hours 10..16 are 70..64 (rounded outward to whole points)
  assert.deepEqual(range, [64, 70])
  assert.equal(healthyMoistureRange(samples, [check(10, 'biasa')]), null, 'only "sehat" counts')
  assert.equal(healthyMoistureRange(samples, [check(10, 'bermasalah')]), null)
  assert.equal(healthyMoistureRange(samples, []), null)
  assert.equal(healthyMoistureRange(samples, [check(500)]), null, 'a check with no readings after it gives nothing')
  const wider = healthyMoistureRange(samples, [check(10), check(30)])
  assert.ok(wider && wider[0] < 64 && wider[1] === 70, `two checks widen the range: ${wider}`)
})

test('too few readings after a check give no range, and invalid readings are ignored', () => {
  assert.equal(healthyMoistureRange([point(10, 60), point(11, 61)], [check(10)]), null, 'two readings are not enough')
  const withFaults = [point(10, 60), point(10.5, 999, false), point(11, 62), point(11.5, 0, false), point(12, 64), point(12.5, Number.NaN)]
  assert.deepEqual(healthyMoistureRange(withFaults, [check(10)]), [60, 64])
})

test('the drying rate is the daytime fall in points per hour, and null without two usable pairs', () => {
  // from 06:00 (hour 0) every half hour at 1.5 points per hour; daytime pairs are those inside 08:00-16:00
  assert.equal(dryingRate(drying(12)), 1.5)
  assert.equal(dryingRate([point(2, 60), point(2.5, 59)]), null, 'one pair is not a rate')
  assert.equal(dryingRate([]), null)
  assert.equal(dryingRate([point(1, 60, false), point(1.5, 59, false), point(2, 58, false)]), null, 'invalid readings do not count')
  const night = drying(4, 60, 1, 0.5).map(p => point(p.t_h + 15, p.moisture)) // 21:00 to 01:00
  assert.equal(dryingRate(night), null, 'the night is not measured')
  const withWatering = [...drying(3), point(3.5, 80), point(4, 79.25), point(4.5, 78.5), point(5, 77.75), point(5.5, 77)]
  assert.equal(dryingRate(withWatering), 1.5, 'a rise (a watering) is not part of the drying')
  assert.equal(dryingRate([point(2, 60), point(6, 54), point(6.5, 53), point(7, 52)]), 2, 'a gap longer than an hour and a half is skipped')
})

test('the water response is the mean rise within three hours of each watering, from the reading just before it', () => {
  const samples = [point(8, 50), point(9, 50), point(9.5, 51), point(10, 52), point(11, 66), point(12, 64), point(30, 40), point(31, 40), point(32, 58), point(33, 56)]
  // watered at 9.9: the reading just before is 51 (hour 9.5) and the highest in the next three hours is 66 (hour 11)
  assert.equal(waterResponse(samples, [9.9]), 15)
})

test('a watering without readings around it is not measured', () => {
  const samples = [point(8, 50), point(9, 50), point(30, 40), point(32, 58)]
  assert.equal(waterResponse(samples, []), null)
  assert.equal(waterResponse([], [9]), null)
  assert.equal(waterResponse([point(9, 50)], [9.5]), null, 'nothing after it')
  assert.equal(waterResponse([point(20, 50)], [9.5]), null, 'nothing before it')
  assert.deepEqual(measuredWaterings(samples, [9.5, 31]).map(m => m.at), [31], 'only the second has a reading before and after')
  assert.equal(waterResponse([point(30, 40), point(32, 58), point(33, 60)], [31]), 20, 'the best reading in the three hours after counts')
  assert.equal(waterResponse([point(30, 40, true), point(31.5, 99, false), point(32, 58)], [31]), 18, 'an invalid reading does not')
})

test('watering times are read from the log lines that record a watering and not from a cancelled one', () => {
  const logs = [
    { kind: 'action', time: '09:30:00', message: 'Siram 150 mL dicatat. Model latihan menerapkan respons pada sampel berikutnya.' },
    { kind: 'action', time: '33:00:00', message: 'Siram 150 mL dicatat. Pembacaan sensor tetap; tambahkan sampel untuk mengamati respons.' },
    { kind: 'action', time: '34:15:00', message: 'Siraman 150 mL dibatalkan sebelum sampel berikutnya.' },
    { kind: 'system', time: '35:00:00', message: 'Siram 150 mL dicatat.' },
    { kind: 'action', time: '36:00:00', message: 'Pengecekan: sehat.' },
    { kind: 'action', time: 'rusak', message: 'Siram 150 mL dicatat.' },
  ]
  assert.deepEqual(wateringTimes(logs), [9.5, 33])
})

test('observing a session counts valid readings, whole days between the first and last, and measured waterings', () => {
  const samples = [...drying(60, 80, 0.5, 1), point(61, 10, false)]
  const o = observe(samples, [check(3)], [5.5, 40.2, 9999])
  assert.equal(o.readings, 61)
  assert.equal(o.days, 2)
  assert.equal(o.waterings, 2, 'the watering with no readings around it is not counted')
  assert.equal(o.inspections.length, 1)
  assert.deepEqual(observe([], [], []), { days: 0, readings: 0, waterings: 0, inspections: [] })
})

test('the same input always gives the same output, and no function changes what it is given', () => {
  const samples = drying(30), checks = [check(10), check(20)], waters = [12, 24]
  const before = JSON.stringify([samples, checks, waters])
  const run = () => JSON.stringify([observe(samples, checks, waters), healthyMoistureRange(samples, checks), dryingRate(samples), waterResponse(samples, waters), remaining(observe(samples, checks, waters))])
  assert.equal(run(), run())
  assert.equal(JSON.stringify([samples, checks, waters]), before)
})
