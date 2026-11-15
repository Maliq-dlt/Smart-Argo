import assert from 'node:assert/strict'
import test from 'node:test'
import { Spring, motion, ribbon, SH } from '../src/components/plantScene/kit.ts'
import { LOOKS, dropCount, nightFactor, orbit, paletteAt, unwrapHour } from '../src/components/plantScene/sky.ts'

test('the session clock passing midnight moves the scene forward through dawn, never backwards through noon', () => {
  assert.ok(Math.abs(unwrapHour(23.9, 0.1) - 24.1) < 1e-9)
  assert.ok(Math.abs(unwrapHour(0.1, 23.9) - -0.1) < 1e-9)
  assert.equal(unwrapHour(10, 10.5), 10.5)
  // a long run of small steps never jumps by more than the step, however many days it crosses
  let current = 22
  for (let i = 0; i < 400; i++) { const next = unwrapHour(current, ((current + 0.25) % 24 + 24) % 24); assert.ok(Math.abs(next - current - 0.25) < 1e-9, `step ${i}`); current = next }
})

test('night is off at noon, full in the small hours, and falls monotonically through the morning', () => {
  assert.equal(nightFactor(10), 0)
  assert.equal(nightFactor(22), 1)
  assert.equal(nightFactor(2), 1)
  for (let h = 5; h < 8; h += 0.25) assert.ok(nightFactor(h + 0.25) <= nightFactor(h) + 1e-12, `hour ${h}`)
  for (const h of [-5, 24, 30, 1e6]) assert.ok(nightFactor(h) >= 0 && nightFactor(h) <= 1, `hour ${h}`)
})

test('the sky palette is continuous across the day and closes the loop at midnight', () => {
  const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  for (let h = 0; h < 24; h += 0.25) {
    const a = paletteAt(h), b = paletteAt(h + 0.25)
    assert.equal(a.length, 5)
    a.forEach((c, i) => assert.ok(Math.max(...channels(c).map((v, k) => Math.abs(v - channels(b[i])[k]))) <= 40, `hour ${h} colour ${i}`))
  }
  assert.deepEqual(paletteAt(0), paletteAt(24))
  assert.deepEqual(paletteAt(-1), paletteAt(23))
})

test('the sun and the moon each show for twelve hours and never together at full strength', () => {
  const sun = (h: number) => orbit(h - 6).a, moon = (h: number) => orbit(((h + 6) % 24 + 24) % 24).a
  assert.equal(sun(12), 1); assert.equal(moon(0), 1)
  assert.equal(sun(3), 0); assert.equal(moon(12), 0)
  for (let h = 0; h < 24; h += 0.25) assert.ok(!(sun(h) > 0.99 && moon(h) > 0.99), `hour ${h}`)
})

test('a band along an arc is a closed path with finite numbers, also with no length', () => {
  for (const len of [0, 1, 100]) for (const shape of Object.values(SH)) {
    const r = ribbon(10, 20, -60, len, 40, 12, shape, 12)
    assert.ok(r.d.startsWith('M') && r.d.endsWith('Z'), `len ${len}`)
    assert.ok(!/NaN|Infinity/.test(r.d + r.spine), `len ${len}`)
    assert.equal(r.pts.length, 13)
  }
})

test('a spring lands on its target at once with reduced motion, and without it settles without a big overshoot', () => {
  motion.reduced = true
  const instant = new Spring(0); instant.t = 10; instant.step(0.016)
  assert.equal(instant.x, 10)
  motion.reduced = false
  const s = new Spring(0, 0.6, 1); s.t = 10
  let peak = 0
  for (let i = 0; i < 180; i++) { s.step(1 / 60); peak = Math.max(peak, s.x) }
  assert.ok(Math.abs(s.x - 10) < 0.01, `settled at ${s.x}`)
  assert.ok(peak <= 11.2, `overshoot to ${peak}`)
  const bouncy = new Spring(0, 0.6, 0.6); bouncy.t = 10
  let top = 0
  for (let i = 0; i < 180; i++) { bouncy.step(1 / 60); top = Math.max(top, bouncy.x) }
  assert.ok(top > 10.2, 'a low damping ratio does overshoot, so the parameter is real')
})

test('each weather has a look: rain only when it rains, the sky dims as it clouds over, and a hot day has no clouds to speak of', () => {
  assert.deepEqual(Object.keys(LOOKS).sort(), ['berawan', 'cerah', 'hujan', 'mendung', 'terik'])
  assert.equal(dropCount(LOOKS.cerah.rain), 0)
  assert.equal(dropCount(LOOKS.mendung.rain), 0)
  assert.ok(dropCount(LOOKS.hujan.rain) > 0)
  assert.ok(dropCount(.5) > 0 && dropCount(.5) < dropCount(1), 'the number of streaks follows the rain')
  assert.ok(LOOKS.cerah.dim < LOOKS.berawan.dim && LOOKS.berawan.dim < LOOKS.mendung.dim && LOOKS.mendung.dim < LOOKS.hujan.dim)
  assert.ok(LOOKS.terik.cloud < LOOKS.cerah.cloud && LOOKS.terik.heat > 0 && LOOKS.cerah.heat === 0)
  for (const look of Object.values(LOOKS)) for (const v of Object.values(look)) assert.ok(Number.isFinite(v) && v >= 0)
})
