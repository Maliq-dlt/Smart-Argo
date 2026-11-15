import assert from 'node:assert/strict'
import test from 'node:test'
import { checkSignup, normalizeDisplayName, normalizeEmailCode } from '../src/lib/signupForm.ts'

test('display name is trimmed and collapsed', () => assert.equal(normalizeDisplayName('  Maliq   Athaya '), 'Maliq Athaya'))

test('display name rejects blank, non-strings, and 41 characters; accepts 40', () => {
  for (const bad of ['', '   ', 42, null, 'x'.repeat(41)]) assert.equal(normalizeDisplayName(bad), null)
  assert.equal(normalizeDisplayName('x'.repeat(40)), 'x'.repeat(40))
})

test('display name counts code points, so 40 emoji pass and 41 do not', () => {
  assert.equal(normalizeDisplayName('🌱'.repeat(40)), '🌱'.repeat(40))
  assert.equal(normalizeDisplayName('🌱'.repeat(41)), null)
})

test('display name rejects control and bidi-override characters', () => {
  assert.equal(normalizeDisplayName('Tani\u0000'), null)
  assert.equal(normalizeDisplayName('Tani‮gnos'), null)
})

test('email code keeps six ASCII digits however it was pasted', () => {
  for (const [raw, want] of [['482 915', '482915'], ['482-915', '482915'], ['482915\n', '482915'], ['4829151234', '482915'], ['abc', ''], ['12', '12']]) assert.equal(normalizeEmailCode(raw), want)
})

test('checkSignup checks the name first, then the exact password match', () => {
  assert.deepEqual(checkSignup({ name: ' ', password: 'a', confirm: 'b' }), { ok: false, field: 'name', message: 'Isi nama Anda, 1–40 karakter.' })
  assert.deepEqual(checkSignup({ name: 'Maliq', password: 'cukup-panjang-12', confirm: 'cukup-panjang-12 ' }), { ok: false, field: 'confirm', message: 'Konfirmasi kata sandi belum sama.' })
  assert.deepEqual(checkSignup({ name: ' Maliq ', password: 'cukup-panjang-12', confirm: 'cukup-panjang-12' }), { ok: true, name: 'Maliq' })
})
