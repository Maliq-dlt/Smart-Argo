// Fase 8, step 2: a signed-in person's pots live on the server, so a second device sees the same garden. Against the local
// backend (`npm run backend:local`, Docker) and the build served on an origin its gateway allows:
// `node node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host 127.0.0.1` (default TEST_URL).
// One device signs up, sets up its first pot, adds a garden and replaces a plant; a second one, with nothing in its storage, signs
// in to the same account and finds all of it. The database is checked too, so the picker is not just showing a local copy.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { signIn } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8' }).trim()
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }
const email = `kebun-${randomBytes(4).toString('hex')}@contoh.test`, password = 'kebun-sinkron-12'
const q = text => `'${text.replaceAll("'", "''")}'`
const onServer = what => sql(`SELECT ${what} FROM public.garden_site s JOIN public.account a ON a.id = s.account_id JOIN auth.users u ON u.id = a.auth_user_id WHERE u.email = ${q(email)}`)

async function device() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('#masuk', base).href); await curtainOpen(page)
  return { context, page }
}
const pill = page => page.locator('.session-pill .pill-trigger')
const picker = page => page.locator('.slot-picker')
/** What the pot picker lists, once it lists `expected` (the server answer may still be on its way). */
async function listed(page, expected) {
  for (let tries = 0; ; tries++) {
    await pill(page).click(); await picker(page).waitFor()
    const text = await picker(page).innerText()
    await page.keyboard.press('Escape'); await picker(page).waitFor({ state: 'detached' })
    if (text.includes(expected) || tries === 30) return text
    await page.waitForTimeout(1000)
  }
}

try {
  // First device: sign up, and "Siapkan pot" makes the first pot on the account.
  const first = await device()
  await signIn(first.page, email, password, { signup: true })
  ok((await listed(first.page, 'Pot cabai')).includes('CB-'), 'The first pot is listed with its plant code')
  ok(onServer('count(*)') === '1', 'The first pot is on the server')

  // A garden of two zones, made from the wizard.
  await pill(first.page).click()
  await picker(first.page).getByRole('button', { name: 'Tambah pot atau kebun' }).click()
  const wizard = first.page.getByRole('dialog', { name: 'Tambah pot atau kebun' })
  ok(/Disimpan di akun Anda/.test(await wizard.innerText()), 'The wizard says where the pot is saved')
  await wizard.getByRole('radio', { name: 'Kebun', exact: true }).check()
  await wizard.getByLabel('Nama', { exact: true }).fill('Kebun sinkron')
  await wizard.getByRole('radio', { name: 'Luar ruangan', exact: true }).check()
  await wizard.getByLabel('Nama zona').nth(1).fill('Bedeng timur')
  await wizard.getByLabel('Tanaman').nth(1).selectOption({ label: 'Bawang merah' })
  await wizard.getByRole('button', { name: 'Buat kebun' }).click()
  await first.page.getByRole('status').filter({ hasText: 'ditambahkan ke akun Anda dengan 2 zona' }).waitFor({ timeout: 30000 })
  ok(onServer(`string_agg(s.name, ',' ORDER BY s.created_at)`) === 'Pot cabai,Kebun sinkron', 'The garden is on the server after the pot')
  ok(sql(`SELECT string_agg(z.name || ':' || c.species_id, ',' ORDER BY z.created_at) FROM public.garden_slot z JOIN public.plant_cycle c ON c.slot_id = z.id AND c.ended_on IS NULL
    JOIN public.garden_site s ON s.id = z.site_id WHERE s.name = 'Kebun sinkron' AND s.account_id = (SELECT a.id FROM public.account a JOIN auth.users u ON u.id = a.auth_user_id WHERE u.email = ${q(email)})`) === 'Zona 1:1,Bedeng timur:2',
    'Each zone grows the plant chosen for it')

  // Replace the plant in the open zone (the first of the new garden opens).
  await pill(first.page).click()
  await picker(first.page).getByRole('button', { name: 'Ganti tanaman' }).click()
  const swap = first.page.getByRole('dialog', { name: /Ganti tanaman di Zona 1/ })
  await swap.getByRole('radio', { name: 'Berhasil', exact: true }).check()
  await swap.getByRole('searchbox').fill('anggrek')
  await swap.getByRole('radio', { name: /^Anggrek bulan/ }).check()
  await swap.getByRole('button', { name: 'Ganti tanaman' }).click()
  await first.page.getByRole('status').filter({ hasText: 'riwayatnya disimpan di akun Anda' }).waitFor({ timeout: 30000 })
  ok(sql(`SELECT string_agg(c.species_id || ':' || coalesce(c.outcome, 'aktif'), ',' ORDER BY c.created_at) FROM public.plant_cycle c JOIN public.garden_slot z ON z.id = c.slot_id
    WHERE z.name = 'Zona 1' AND c.account_id = (SELECT a.id FROM public.account a JOIN auth.users u ON u.id = a.auth_user_id WHERE u.email = ${q(email)})`) === '1:berhasil,3:aktif',
    'The old cycle is closed with its outcome and the new one is open, on the server')

  // Second device: nothing stored, signs in, and finds the same pots and plants.
  const second = await device()
  ok(await second.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('smart-agro.garden')).length) === 0, 'The second device starts with no garden of its own')
  await signIn(second.page, email, password)
  const seen = await listed(second.page, 'Kebun sinkron')
  for (const text of ['Pot cabai', 'Kebun sinkron', 'Zona 1', 'Bedeng timur', 'Anggrek bulan 1', 'AB-', 'Bawang merah 1']) ok(seen.includes(text), `The second device lists ${text}`)
  ok(!(await listed(second.page, 'Kebun sinkron')).includes('Muat contoh kebun'), 'A signed-in person is not offered the demo garden')

  // A reload on the first device still shows what the server has (the copy on the device is only a copy).
  await first.page.reload(); await curtainOpen(first.page)
  ok((await listed(first.page, 'Bedeng timur')).includes('Anggrek bulan 1'), 'After a reload the first device shows the server garden')

  // Real weather (Fase 8): an outdoor pot with coordinates asks the weather function, here answered with a fixed snapshot so
  // the test never reaches Open-Meteo, and the stage shows it with its credit instead of the simulated-weather control.
  const asked = []
  await first.context.route('**/functions/v1/weather-forecast', async route => {
    asked.push({ body: route.request().postDataJSON(), bearer: route.request().headers().authorization ?? '' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, weather: { at: '2026-11-16T15:00', condition: 'hujan', tempC: 24.5, humidity: 93, cloud: 100, windMs: 4, rainMm: 3.2, forecast: [] } }) })
  })
  const simControl = first.page.getByRole('group', { name: 'Cuaca simulasi' })
  ok(await simControl.count() === 1 && asked.length === 0, 'An outdoor zone without coordinates keeps the simulated weather and asks nothing')
  await pill(first.page).click()
  await picker(first.page).getByRole('button', { name: 'Tambah pot atau kebun' }).click()
  await wizard.getByLabel('Nama', { exact: true }).fill('Pot teras')
  await wizard.getByRole('radio', { name: 'Luar ruangan', exact: true }).check()
  await wizard.getByLabel('Lintang').fill('-6.914744')
  await wizard.getByLabel('Bujur').fill('107.609810')
  await wizard.getByRole('button', { name: 'Buat pot' }).click()
  await first.page.getByRole('status').filter({ hasText: 'ditambahkan ke akun Anda' }).last().waitFor({ timeout: 30000 })
  ok(onServer(`s.latitude || ',' || s.longitude`).split('\n').includes('-6.91,107.61'), 'The place is stored rounded to about a kilometre')
  const live = first.page.locator('.stage-weather-live')
  await live.waitFor({ timeout: 30000 })
  ok(/Cuaca sekarang: Hujan, 24,5 °C/.test(await live.innerText()), `The stage shows the real weather: ${await live.innerText()}`)
  ok(await live.getByRole('link', { name: 'Open-Meteo' }).getAttribute('href') === 'https://open-meteo.com/', 'The data is credited to Open-Meteo')
  ok(await simControl.count() === 0, 'No simulated-weather control while real weather is shown')
  ok(/hujan/i.test(await first.page.locator('.stage-weather-note').innerText()), 'The advice note follows the real weather')
  ok(asked.length >= 1 && Math.abs(asked[0].body.lat + 6.91) < 0.006 && Math.abs(asked[0].body.lon - 107.61) < 0.006 && asked[0].bearer.startsWith('Bearer '), 'The function was asked for this place with the session')

  ok(errors.length === 0, `No page or console errors: ${errors.join(' | ')}`)
  console.log(`garden-sync-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
