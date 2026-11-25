// Scripted RPC responses verify web behavior; these do not claim a physical device was tested.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { mockAuth, mockSession } from './mock-auth.mjs'
import { gate } from './entry-helpers.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/'
const output = path.resolve('.tmp/web-care')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome', env: { ...process.env, TEMP: output, TMP: output } })
let checks = 0
const check = (value, text) => { assert(value, text); checks++ }
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  page.on('pageerror', e => errors.push(e.message))
  const to = new Date(Date.now() - 3600000).toISOString()
  let appendFailed = false
  let preferences = { ok: true, email_enabled: false, kinds: ['soil_dry'] }, rises = [{ from: new Date(Date.now() - 7200000).toISOString(), to, delta: 8 }]
  const rpc = name => `POST /rest/v1/rpc/${name}`
  const scripted = await mockAuth(page, {
    'POST /auth/v1/token?grant_type=password': () => mockSession({ pot: { name: 'Pot uji', crop: 'cabai', device: true } }),
    'POST /auth/v1/token?grant_type=refresh_token': () => mockSession({ pot: { name: 'Pot uji', crop: 'cabai', device: true } }),
    [rpc('my_units')]: () => ({ ok: true, units: [], devices: [] }),
    [rpc('my_overview')]: () => ({ ok: true, plants: [{ slot_id: 's1', unit_id: 'u1', name: 'Cabai server', tag: 'CB-1', place: 'Teras', species_id: 1, moisture: 35, band_source: 'own_pattern', state: 'below', outlook: { state: 'below', band_source: 'own_pattern', from: null, to: null } }], devices: { total: 1, issues: [] } }),
    [rpc('my_watering_outlook')]: () => ({ ok: true, outlook: { state: 'waiting', band_source: 'own_pattern', from: null, to: null } }),
    [rpc('my_unit_health')]: () => ({ ok: true, checked_at: to, device_id: 'd1', battery: [{ at: to, volts: 3.7 }], battery_days_left: null, packets: [to], upload_gaps: [], energy_days: [], calibration: { moisture_at: to, ph_at: null } }),
    [rpc('my_unlogged_rises')]: () => ({ ok: true, rises }),
    [rpc('dismiss_my_rise')]: () => { rises = []; return { ok: true } },
    [rpc('append_my_care_journal')]: () => { if (!appendFailed) { appendFailed = true; return { status: 503, body: { ok: false, code: 'unavailable' } } } rises = []; return { ok: true } },
    [rpc('my_alert_preferences')]: () => preferences,
    [rpc('set_my_alert_preferences')]: request => { const p = request.postDataJSON(); preferences = { ok: true, email_enabled: p.p_email_enabled, kinds: p.p_kinds }; return preferences },
  })
  await page.goto(new URL('#pengaturan-peringatan', base).href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await gate(page).waitFor()
  await gate(page).getByLabel('Email', { exact: true }).fill('care@example.test')
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill('local-scripted-password')
  await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
  const form = page.getByRole('form', { name: 'Pengaturan peringatan' })
  await form.waitFor()
  check(new URL(page.url()).hash === '#pengaturan-peringatan', 'Direct email link survives sign-in')
  await page.getByLabel('Kirim email peringatan').check()
  await page.getByLabel('Baterai rendah', { exact: true }).check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Pengaturan peringatan disimpan.' }).waitFor()
  assert.deepEqual(scripted.bodies(rpc('set_my_alert_preferences')).at(-1), { p_email_enabled: true, p_kinds: ['soil_dry', 'battery_low'] }); checks++
  await page.getByLabel('Kirim email peringatan').uncheck()
  await form.getByText('Ada perubahan yang belum disimpan.').waitFor()
  check(await form.getByText('Pengaturan peringatan disimpan.').count() === 0, 'Editing clears the saved confirmation')
  await page.evaluate(() => { location.hash = '#statistik' })
  await page.locator('.ov-card').waitFor()
  check((await page.locator('.overview').innerText()).includes('Berdasarkan pola pot Anda'), 'Overview uses the server provenance')
  check((await page.locator('.ov-title').innerText()).includes('Cabai server'), 'Overview uses server plant name')
  await page.locator('.ov-card').click()
  await page.locator('.device-health').getByText('3,7 V', { exact: true }).waitFor()
  check((await page.locator('.device-health').innerText()).includes('3,7 V'), 'Device card shows server voltage')
  check((await page.locator('.device-health').innerText()).includes('Kalibrasi kelembapan'), 'Device card includes calibration')
  check(await page.locator('.simulation-controls').count() === 0, 'Real plant has no simulated watering controls')
  const trace = page.locator('.care-rise p').first()
  const measured = await trace.innerText()
  check(measured.includes(`naik ${rises[0].delta} poin`) && measured.includes('WIB'), 'Water trace uses the measured rise and local time')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }))
  await page.getByRole('button', { name: 'Bagikan jejak air' }).click()
  await page.getByText('Jejak air disalin.').waitFor()
  check(await page.evaluate(() => navigator.clipboard.readText()) === measured, 'Sharing copies only the visible reading')
  await page.getByLabel('Volume aktual (mL)').fill('150')
  await page.getByRole('button', { name: 'Catat', exact: true }).click()
  await page.getByRole('button', { name: 'Urungkan', exact: true }).click()
  await page.waitForTimeout(5200)
  check(scripted.count(rpc('append_my_care_journal')) === 0, 'Undo prevents the server write')
  await page.getByRole('button', { name: 'Catat', exact: true }).click()
  await page.getByRole('button', { name: 'Kirim ulang catatan' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Siram dicatat.' }).waitFor()
  assert.deepEqual(scripted.bodies(rpc('append_my_care_journal'))[0], scripted.bodies(rpc('append_my_care_journal'))[1]); checks++
  const body = scripted.bodies(rpc('append_my_care_journal')).at(-1)
  check(body.p_observed_at === to && body.p_amount_ml === 150 && body.p_kind === 'watering', 'Confirmation uses rise time and actual volume')
  rises = [{ from: new Date(Date.now() - 7200000).toISOString(), to, delta: 8 }]
  await page.getByRole('button', { name: 'Muat ulang', exact: true }).click()
  await page.getByRole('button', { name: 'Bukan', exact: true }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Usulan diabaikan' }).waitFor()
  check(scripted.count(rpc('dismiss_my_rise')) === 1, 'Dismiss sends exactly one request')
  for (const width of [1440, 768, 390, 320]) for (const theme of ['light', 'dark']) for (const text of [false, true]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(({ theme, text }) => { document.documentElement.dataset.theme = theme; document.documentElement.style.fontSize = text ? '200%' : '' }, { theme, text })
    for (const [hash, selector] of [['#tanaman', '.device-health'], ['#statistik', '.overview'], ['#pengaturan-peringatan', '.care-fields']]) {
      await page.evaluate(hash => { location.hash = hash }, hash)
      await page.locator(selector).waitFor()
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      check(await page.evaluate(() => {
        const icons = [...document.querySelectorAll('.nav-tab > svg, .nav-tools > button')].map(e => e.getBoundingClientRect())
        return icons.every((a, i) => icons.slice(i + 1).every(b => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top))
      }), `Navigation targets do not overlap at ${width} ${theme} ${text ? '200%' : '100%'}`)
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(e => `${e.tagName}.${e.className}`))
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${hash} fits ${width} ${theme} ${text ? '200%' : '100%'} ${overflow.join(',')}`)
      // overflow-wrap:anywhere keeps the page inside the screen, but a heading split inside a word ("peringata|n") is a defect.
      const split = await page.evaluate(() => [...document.querySelectorAll('h1.page-heading, .care-panel h2')].flatMap(h => {
        const node = h.firstChild
        if (!node || node.nodeType !== Node.TEXT_NODE) return []
        let at = 0
        return node.data.split(' ').filter(word => {
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + word.length); at += word.length + 1
          return new Set([...range.getClientRects()].map(r => Math.round(r.top))).size > 1
        })
      }))
      check(split.length === 0, `${hash} headings keep whole words at ${width} ${theme} ${text ? '200%' : '100%'}: ${split.join(', ')}`)
      await page.screenshot({ path: path.join(output, `${hash.slice(1)}-${width}-${theme}-${text ? '200' : '100'}.png`), fullPage: true })
    }
  }
  assert.deepEqual(errors, [])
  console.log(`care-browser: ${checks} checks passed; screenshots in ${output}`)
} finally { await browser.close() }
