import assert from 'node:assert/strict'
import test from 'node:test'
import { avatarSrc, centerSquare, googlePhoto, initialsOf, parseAvatar } from '../src/lib/avatar.ts'
import { parseDeletion } from '../src/lib/productAccountClient.ts'

test('the photo is the centre square of any picture', () => {
  assert.deepEqual(centerSquare(4000, 3000), { sx: 500, sy: 0, size: 3000 })
  assert.deepEqual(centerSquare(1080, 1920), { sx: 0, sy: 420, size: 1080 })
  assert.deepEqual(centerSquare(256, 256), { sx: 0, sy: 0, size: 256 })
})

test('initials take the first letter of up to two words', () => {
  assert.equal(initialsOf('Maliq Athaya Rinaldi'), 'MA')
  assert.equal(initialsOf('kebun.bandung'), 'KB')
  assert.equal(initialsOf('Ñandú'), 'Ñ')
})

test('only a Google-hosted photo is used, and only a well-formed stored photo is shown', () => {
  assert.equal(googlePhoto({ user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/abc=s96-c' } }), 'https://lh3.googleusercontent.com/a/abc=s96-c')
  assert.equal(googlePhoto({ user_metadata: { avatar_url: 'https://evil.example/a.png' } }), null)
  assert.equal(googlePhoto({ user_metadata: { picture: 'javascript:alert(1)' } }), null)
  assert.equal(googlePhoto({}), null)
  assert.deepEqual(parseAvatar({ mime: 'image/webp', data: 'UklGRg==' }), { mime: 'image/webp', data: 'UklGRg==' })
  assert.equal(parseAvatar({ mime: 'image/svg+xml', data: 'PHN2Zz4=' }), null, 'no SVG: it can carry script')
  assert.equal(parseAvatar({ mime: 'image/png', data: 'not base64!' }), null)
  assert.equal(avatarSrc({ mime: 'image/png', data: 'iVBO' }), 'data:image/png;base64,iVBO')
  assert.equal(avatarSrc(null), null)
})

test('a pending deletion is read strictly; anything else means none is pending', () => {
  const value = { pending: true, requested_at: '2026-11-22T04:00:00+00:00', purge_after: '2026-12-06T04:00:00+00:00', released: ['SA-POT-0001'], restorable: [] }
  assert.deepEqual(parseDeletion(value), { pending: true, requestedAt: value.requested_at, purgeAfter: value.purge_after, released: ['SA-POT-0001'], restorable: [] })
  assert.equal(parseDeletion({ pending: false }), null)
  assert.equal(parseDeletion(null), null)
  assert.throws(() => parseDeletion({ ...value, released: ['<script>'] }), /tidak valid/)
  assert.throws(() => parseDeletion({ ...value, purge_after: 'besok' }), /tidak valid/)
})
