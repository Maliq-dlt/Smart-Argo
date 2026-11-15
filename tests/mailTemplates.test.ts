import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// The Auth email templates (supabase/templates, applied with scripts/apply-auth-email.mjs). Mail clients strip
// scripts and external CSS, clip Gmail messages near 102 KB, and Auth only fills a handful of variables.
// They are also written to stay out of the Spam folder: Gmail does not load images for a message it filed as spam,
// and hidden text, remote images from a free hosting domain and a "verify" link to another domain are what its filters
// weigh against a new sender. So: live text only, nothing hidden, and a link only where the email cannot work without one.
const read = (name: string) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), 'utf8')
const templates = { confirmation: read('confirmation'), recovery: read('recovery') }
const ALLOWED = new Set(['.Token', '.ConfirmationURL', '.Email', '.SiteURL'])
for (const [name, html] of Object.entries(templates)) {
  test(`${name}: nothing a mail client would strip, clip or block`, () => {
    assert.doesNotMatch(html, /<script/i)
    assert.doesNotMatch(html, /<link\b/i)
    assert.doesNotMatch(html, /@import/i)
    assert.ok(Buffer.byteLength(html) < 100000, 'under the Gmail clipping size')
    assert.match(html, /<meta name="color-scheme"/)
    assert.match(html, /<html lang="id"/)
  })
  test(`${name}: no hidden text and no remote content`, () => {
    assert.doesNotMatch(html, /display:\s*none/i, 'no hidden preview line: text invisible to the reader is what spam filters look for')
    assert.doesNotMatch(html, /font-size:\s*[01]px/i)
    assert.doesNotMatch(html, /opacity:\s*0\b/i)
    assert.doesNotMatch(html, /<img\b/i, 'no images: they are blocked in Spam and by default in many clients, and cost a request to a hosting domain')
    assert.doesNotMatch(html, /url\(/i)
  })
  test(`${name}: the brand is live text on a solid colour, readable with images off`, () => {
    assert.match(html, /bgcolor="#2f5a3c"[^>]*>[\s\S]*?Smart Agro/)
    assert.match(html, /Amati\. Pahami\. Rawat\./)
  })
  test(`${name}: only the variables Auth fills`, () => {
    const used = [...html.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map(match => match[1])
    assert.ok(used.length > 0)
    for (const action of used) assert.ok(ALLOWED.has(action), `unexpected template action {{ ${action} }}`)
  })
}
test('confirmation is the code and nothing to click: large, with its lifetime, no link at all', () => {
  const html = templates.confirmation
  assert.match(html, /\{\{ \.Token \}\}/)
  assert.match(html, /Berlaku 10 menit/)
  assert.match(html, /font-size:\s*(3\d|4\d)px/, 'the code is set large')
  assert.doesNotMatch(html, /href=/i, 'a verification link to another domain is the strongest phishing signal; the code works on any device')
  assert.doesNotMatch(html, /\{\{ \.ConfirmationURL \}\}/)
})
test('reset email is a link only: no code to type', () => {
  assert.match(templates.recovery, /href="\{\{ \.ConfirmationURL \}\}"/)
  assert.doesNotMatch(templates.recovery, /\{\{ \.Token \}\}/)
})
