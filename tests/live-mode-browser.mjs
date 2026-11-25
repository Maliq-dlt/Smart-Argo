// The live build (VITE_APP_MODE=live): no guest visit, no Ruang tanam, no simulated weather, no demo garden. Auth is scripted
// (no Docker). Build it apart from the demo and serve that folder:
//   npx vite build --mode live --outDir .tmp/dist-live && npx vite preview --outDir .tmp/dist-live --port 4175 --host 127.0.0.1
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gate } from './entry-helpers.mjs'
import { mockAuth, mockSession } from './mock-auth.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:4175/'
const POT = { name: 'Pot teras', crop: 'cabai', device: false }
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', error => { if (!/Transition was skipped/.test(error.message)) errors.push(error.message) })
  // "Transition was skipped" is the browser saying a page transition was replaced by the next one (here, the old Ruang tanam address
  // sent to the dashboard that is already open); it is not an error of the app.
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321|Transition was skipped/.test(message.text())) errors.push(message.text()) })
  // A visitor who once chose "guest" in a demo has that flag; the live app must not honour it.
  await page.addInitScript(() => { try { localStorage.setItem('smart-agro.guest', '1') } catch { /* blocked */ } })
  await mockAuth(page, {
    'POST /auth/v1/token?grant_type=password': () => mockSession({ pot: POT }),
    'POST /auth/v1/token?grant_type=refresh_token': () => mockSession({ pot: POT }),
    'POST /rest/v1/rpc/my_units': () => ({ ok: true, units: [], devices: [] }),
    'POST /rest/v1/rpc/my_overview': () => ({ ok: true, plants: [{ slot_id: 'slot', unit_id: null, name: 'Pot teras', species_id: 1, moisture: null, band_source: null, state: 'no_device', outlook: null }], devices: { total: 0, issues: [] } }),
  })
  await page.goto(new URL('#masuk', base).href); await curtainOpen(page)
  await gate(page).waitFor()
  ok(await page.getByRole('button', { name: /Coba tanpa akun/ }).count() === 0, 'The gate offers no guest visit')
  ok(await page.locator('.app-shell').count() === 0, 'A stored guest flag does not open the app')

  await gate(page).getByLabel('Email', { exact: true }).fill('pot@contoh.test')
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill('cukup-panjang-12')
  await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.locator('.app-shell').waitFor({ timeout: 20000 })
  await page.locator('.ov-title').waitFor()

  const tabs = await page.locator('.nav-tab').evaluateAll(links => links.map(a => a.textContent.trim()))
  ok(tabs.includes('Ringkasan') && tabs.includes('Tanaman') && tabs.includes('Akun'), `The rest of the app is there: ${tabs}`)
  ok(!tabs.some(name => /Ruang tanam|Simulasi/i.test(name)), `There is no Ruang tanam in the capsule: ${tabs}`)
  ok(await page.locator('.ov-title').count() === 1, 'The app opens on Ringkasan')

  // Its old address and the care link lead to the dashboard, not to a room that does not exist.
  const settled = () => page.waitForFunction(() => !document.documentElement.hasAttribute('data-site-transition'))
  await settled()
  await page.evaluate(() => { location.hash = '#simulasi' })
  await page.waitForTimeout(500); await settled()
  ok(await page.locator('.ov-title').count() === 1, '#simulasi shows Ringkasan')
  ok(await page.getByRole('heading', { level: 1, name: 'Ruang tanam', exact: true }).count() === 0 && await page.locator('.studio').count() === 0, 'Ruang tanam is not rendered')

  // The weather lives on the plant page's stage.
  await page.evaluate(() => { location.hash = '#tanaman' }); await page.locator('.care-picker').first().waitFor()
  ok(await page.locator('.stage-weather').count() === 0, 'No simulated weather control')
  ok(await page.locator('.stage-weather-note').count() === 0, 'No weather note')
  ok(await page.locator('.stage-scene .plant-scene svg').count() === 0, 'A real plant does not display a synthetic stage')
  ok(await page.locator('.session-pill').count() === 0, 'A real plant has no simulator session controls')
  ok((await page.locator('.live-care').innerText()).includes('Belum ada perangkat'), 'Unassigned pot reports missing hardware')
  ok(await page.getByRole('button', { name: 'Catat', exact: true }).count() === 0, 'No simulated watering is offered as real care')
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')

  await page.goto(new URL('?serial=QR-REGRESSION#ekosistem', base).href)
  const serial = page.getByLabel('Nomor seri produk / QR')
  await serial.waitFor()
  assert.equal(await serial.inputValue(), 'QR-REGRESSION')
  ok(await page.getByText(/Peran dan akun demo|Reset demo|Saldo demo/).count() === 0, 'Product onboarding uses the live registry')
  await page.getByRole('button', { name: 'Energi & penukaran' }).click()
  await page.locator('.online-panel').getByRole('heading').first().waitFor()
  const firstVisit = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  const requests = await mockAuth(firstVisit, {
    'POST /auth/v1/token?grant_type=password': () => mockSession(),
  })
  await firstVisit.goto(new URL('?serial=NEW-KIT#ekosistem', base).href)
  await gate(firstVisit).getByLabel('Email', { exact: true }).fill('pot@contoh.test')
  await gate(firstVisit).getByLabel('Kata sandi', { exact: true }).fill('cukup-panjang-12')
  await gate(firstVisit).getByRole('button', { name: 'Masuk', exact: true }).click()
  const newSerial = firstVisit.getByLabel('Nomor seri produk / QR')
  await newSerial.waitFor()
  ok(await newSerial.inputValue() === 'NEW-KIT', 'A first sign-in keeps the package serial before pot setup')
  await Promise.all([
    firstVisit.waitForResponse(r => r.url().includes('/rpc/product_public_status')),
    firstVisit.getByRole('button', { name: 'Periksa status' }).click(),
  ])
  ok(requests.bodies('POST /rest/v1/rpc/product_public_status')[0]?.p_serial === 'NEW-KIT', 'Registry receives the scanned serial')
  assert.deepEqual(errors, [], `Console errors: ${errors.join(' | ')}`)
  console.log(`live-mode-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
