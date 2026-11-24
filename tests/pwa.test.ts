// The web app can be added to a phone's home screen (2026-11-24): a manifest with the icons Chrome and iOS need.
// Deliberately no service worker: readings and care must come fresh from the server, and a cached build could outlive
// a deploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
// Width and height from a PNG's IHDR chunk.
const size = (path: string) => { const b = readFileSync(path); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}` }

test('the manifest makes the app installable and opens it on Ringkasan', () => {
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.name && manifest.short_name.length <= 12, 'a name and a short name that fits under an icon')
  assert.equal(manifest.start_url, './#statistik')
  assert.ok(new URL(manifest.start_url, 'https://x/app/').href.startsWith(new URL(manifest.scope, 'https://x/app/').href), 'start inside the scope')
  for (const sizes of ['192x192', '512x512']) assert.ok(manifest.icons.some((i: { sizes: string; purpose: string }) => i.sizes === sizes && i.purpose === 'any'), `an icon of ${sizes}`)
  assert.ok(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable'), 'a maskable icon for Android launchers')
})

test('every icon exists at the size it claims, and the page links them', () => {
  for (const icon of manifest.icons) {
    const path = `public/${icon.src}`
    assert.ok(existsSync(path), path)
    assert.equal(size(path), icon.sizes, path)
  }
  assert.equal(size('public/icons/apple-touch-icon.png'), '180x180')
  const html = readFileSync('index.html', 'utf8')
  assert.match(html, /<link rel="manifest" href="%BASE_URL%manifest\.webmanifest" \/>/)
  assert.match(html, /<link rel="apple-touch-icon" href="%BASE_URL%icons\/apple-touch-icon\.png" \/>/)
  assert.match(readFileSync('public/_headers', 'utf8'), /\/manifest\.webmanifest\r?\n {2}Content-Type: application\/manifest\+json/) // CRLF in a Windows checkout
})
