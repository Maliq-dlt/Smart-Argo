// The Content-Security-Policy in public/_headers (served by Cloudflare Pages) against the real app: landing, sign-up,
// every ecosystem tab, the profile sections, the dashboard and the QR scanner (WASM) must run without a single
// violation. vite preview ignores _headers, so this test serves dist/ itself with every header from dist/_headers, as
// Cloudflare does (a Playwright-fulfilled document would count as a public address and lose the local backend). The
// local build talks to the local gateway, so that origin joins connect-src in place of *.supabase.co (no https upgrade).
// Needs `npm run build`, the local backend (gateway on 54321, which allows origin 4178) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { signIn, ecosystemTab, profileSection } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const port = 4178, base = `http://127.0.0.1:${port}/`
const headers = Object.fromEntries((await readFile('dist/_headers', 'utf8')).split(/\r?\n/).filter(l => /^\s+\S+:/.test(l)).map(l => l.trim().split(/:\s(.*)/s).slice(0, 2)))
headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace('connect-src ', 'connect-src http://127.0.0.1:54321 ').replace(/; upgrade-insecure-requests/, '')
assert.match(headers['Content-Security-Policy'], /script-src 'self' 'wasm-unsafe-eval';/)
const TYPES = { '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.avif': 'image/avif', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' }
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, base).pathname)).replace(/^([/\\])+/, '')
  const file = path.startsWith('..') || !path ? 'index.html' : path
  const body = await readFile(join('dist', file)).catch(() => null)
  res.writeHead(body ? 200 : 404, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body ?? '')
}).listen(port, '127.0.0.1')
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] })
const violations = []
await context.exposeBinding('reportCsp', (_source, v) => violations.push(v))
await context.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.reportCsp(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`)))
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const steps = []
try {
  const first = await page.goto(base); await curtainOpen(page)
  assert.match(first.headers()['content-security-policy'] ?? '', /frame-ancestors 'none'/, 'the policy reaches the browser')
  for (let y = 0; y < 6; y++) { await page.mouse.wheel(0, 1200); await page.waitForTimeout(250) }
  steps.push('landing (frames, video, Lottie)')
  // A hash-only goto stays in the landing document; load the app afresh as a visitor opening #masuk would.
  await page.goto(new URL('#masuk', base).href); await page.reload(); await curtainOpen(page)
  await signIn(page, `csp-${randomUUID().slice(0, 8)}@example.test`, randomBytes(18).toString('base64url'), { signup: true })
  steps.push('sign-up and pot setup')
  for (const tab of ['QR & kepemilikan', 'Unit & sensor', 'Maskot & AI', 'Energi & reward', 'Kurasi & blockchain']) { await ecosystemTab(page, tab); await page.waitForTimeout(800) }
  steps.push('every ecosystem tab')
  await ecosystemTab(page, 'QR & kepemilikan')
  const qr = page.locator('#qr-verify-heading').locator('xpath=ancestor::section')
  await qr.getByRole('button', { name: 'Pindai QR' }).click()
  await page.getByRole('dialog', { name: 'Pindai QR produk' }).waitFor()
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.endsWith('.wasm')), null, { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape')
  steps.push('QR scanner with its WASM reader')
  for (const section of ['Akun', 'Keamanan', 'Produk']) { await profileSection(page, section); await page.waitForTimeout(600) }
  steps.push('profile sections')
  await page.evaluate(() => { location.hash = '#simulasi' }); await page.waitForTimeout(1500)
  steps.push('dashboard')
  assert.deepEqual(violations, [], `CSP violations:\n${violations.join('\n')}`)
  assert.deepEqual(errors, [])
  console.log(`csp-browser: no violations across ${steps.length} steps\n- ${steps.join('\n- ')}`)
} catch (error) {
  console.log(`steps: ${steps.join(' | ')}\nviolations:\n${violations.join('\n')}\nerrors:\n${errors.join('\n')}\nurl: ${page.url()}`)
  throw error
} finally {
  await browser.close()
  server.close()
}
