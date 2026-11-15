import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The Auth email templates (supabase/templates, applied with scripts/apply-auth-email.mjs). Mail clients strip
// scripts and external CSS, clip Gmail messages near 102 KB, and Auth only fills a handful of variables.
const read = (name: string) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), 'utf8')
const templates = { confirmation: read('confirmation'), recovery: read('recovery') }
const ALLOWED = new Set(['.Token', '.ConfirmationURL', '.Email', '.SiteURL'])
const IMAGE_BASE = 'https://smart-agro-demo.pages.dev/mail/'

for (const [name, html] of Object.entries(templates)) {
  test(`${name}: nothing a mail client would strip, clip or block`, () => {
    assert.doesNotMatch(html, /<script/i)
    assert.doesNotMatch(html, /<link\b/i)
    assert.doesNotMatch(html, /@import/i)
    assert.ok(Buffer.byteLength(html) < 100000, 'under the Gmail clipping size')
    assert.match(html, /<meta name="color-scheme"/)
    assert.match(html, /display:\s*none/i, 'has a hidden preview line')
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0])
    assert.ok(images.length >= 1, 'has the header image')
    for (const image of images) {
      assert.match(image, /\balt="[^"]+"/, 'every image has alt text for blocked images')
      assert.match(image, /\bwidth="\d+"/)
      assert.ok(image.match(/\bsrc="([^"]+)"/)![1].startsWith(IMAGE_BASE), 'images come from the app origin')
    }
  })

  test(`${name}: only the variables Auth fills`, () => {
    const used = [...html.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(match => match[1])
    assert.ok(used.length > 0)
    for (const action of used) assert.ok(ALLOWED.has(action), `unexpected template action {{ ${action} }}`)
  })
}

test('confirmation shows the code large, says how long it lasts, and keeps the link as a fallback', () => {
  const html = templates.confirmation
  assert.match(html, /\{\{ \.Token \}\}/)
  assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/)
  assert.match(html, /Berlaku 10 menit/)
  assert.match(html, /font-size:\s*(3\d|4\d)px/, 'the code is set large')
})

test('reset email is a link only: no code to type', () => {
  assert.match(templates.recovery, /href="\{\{ \.ConfirmationURL \}\}"/)
  assert.doesNotMatch(templates.recovery, /\{\{ \.Token \}\}/)
})
