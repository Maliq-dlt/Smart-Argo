// A plant with no curated profile (the demo orchid) is watched and learned from: the card shows what has been seen and the one
// thing to do, recording checks moves it from level 0 to level 1, and nothing it says is advice or a standard. Guest mode, no
// backend. Serve the build with `npx vite preview --port 4174 --host 127.0.0.1` (default TEST_URL).
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/'
const output = '.tmp/learning'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser)
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }

const open = async ({ width = 1440, text = false, reducedMotion = 'no-preference' } = {}) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321/.test(message.text())) errors.push(message.text()) })
  await page.goto(new URL('#tanaman', base).href); await curtainOpen(page)
  await page.locator('.plant-scene svg').waitFor()
  if (text) {
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
    await page.evaluate(() => { document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '' })
  }
  return page
}
const pillName = page => page.locator('.session-pill .pill-trigger strong').textContent()
const openPicker = async page => { await page.locator('.session-pill .pill-trigger').click(); await page.locator('.slot-picker').waitFor() }
const loadDemo = async page => {
  await openPicker(page)
  await page.locator('.slot-picker').getByRole('button', { name: 'Muat contoh kebun' }).click()
  await page.getByRole('status').filter({ hasText: 'Contoh dimuat' }).waitFor()
}
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
const card = page => page.locator('.learning-card')
const record = (page, state) => page.getByRole('group', { name: 'Catat pengecekan' }).getByRole('button', { name: state, exact: true }).click()
const checkCount = async page => Number((await card(page).locator('.learning-progress li').nth(1).innerText()).match(/(\d+) dari 3/)[1])

try {
  const page = await open()
  ok(await card(page).count() === 0, 'A curated pot (the default session) shows the answer card, not the learning card')
  ok(await page.locator('.dashboard-care').count() === 1, 'The answer card is there')

  // The demo orchid: a plant with no profile, so a learning card in place of advice.
  await loadDemo(page)
  ok(await pillName(page) === 'Anggrek ruang tamu', 'The orchid opens first')
  await card(page).waitFor()
  ok(await page.locator('.dashboard-care:not(.learning-card)').count() === 0, 'No answer card for a plant with no profile')
  ok(await page.getByRole('heading', { name: /Mengamati dulu/ }).count() === 1, 'Level 0 says it is only watching')
  let said = await card(page).innerText()
  ok(/belum punya acuan untuk Anggrek bulan/.test(said), `It says it has no reference: ${said.slice(0, 120)}`)
  ok(said.includes('Berdasarkan pola pot Anda, bukan standar tanaman.'), 'It says where its facts come from')
  ok(!/optimal|ideal|dosis|\d+\s?ml/i.test(said), 'It gives no advice and no dose')
  ok(/Yang bisa dilakukan sekarang: nilai tanaman Anda hari ini/.test(said), 'It names the one thing to do')
  ok(/0 dari 3/.test(await card(page).locator('.learning-progress').innerText()), 'No checks yet')
  const days = Number((await card(page).locator('.learning-progress li').first().innerText()).match(/(\d+) dari 7/)[1])
  ok(days >= 7, `Forty simulated days of readings count as days watched (${days})`)
  ok(await page.locator('.condition-band').count() === 0, 'No moisture zones are drawn without a reference or a learned range')
  await page.waitForFunction(() => [...document.querySelectorAll('.plant-scene .rv')].filter(e => e.getBoundingClientRect().width > 0 && e.textContent.trim()).length === 3, null, { timeout: 5000 })
  checks++ // the three readings are still on the stage (the orchid fades in over a few frames)
  await page.screenshot({ path: `${output}/level0-1440.png`, fullPage: false })

  // Three checks move it to level 1 (the demo already has enough days and waterings).
  await record(page, 'Sehat')
  await page.getByRole('status').filter({ hasText: 'Pengecekan dicatat: sehat' }).waitFor()
  ok(await checkCount(page) === 1, 'A recorded check raises the count')
  ok(/Pengecekan terakhir: sehat/.test(await card(page).innerText()), 'The last check is shown')
  await record(page, 'Biasa')
  ok(await checkCount(page) === 2, 'The second check counts')
  ok(await page.getByRole('heading', { name: /Mengamati dulu/ }).count() === 1, 'Two checks are not enough')
  await record(page, 'Sehat')
  await page.getByRole('heading', { name: /Pola pot Anda/ }).waitFor()
  said = await card(page).innerText()
  ok(await checkCount(page) === 3, 'Three checks')
  ok(/Ini pola pot Anda, bukan standar tanaman/.test(said), `Level 1 states the pot's own pattern: ${said.slice(0, 160)}`)
  ok(/Media mengering sekitar|Satu siraman menaikkannya/.test(said), 'It reports what was measured in this pot')
  ok(!/optimal|ideal|dosis|membutuhkan|\d+\s?ml/i.test(said), 'Still no advice and no dose at level 1')
  await page.screenshot({ path: `${output}/level1-1440.png`, fullPage: false })

  // It is saved with the session and survives a reload.
  await page.locator('.save-status', { hasText: 'Tersimpan' }).waitFor()
  await page.reload(); await curtainOpen(page); await page.locator('.plant-scene svg').waitFor()
  await card(page).waitFor()
  ok(await checkCount(page) === 3 && await page.getByRole('heading', { name: /Pola pot Anda/ }).count() === 1, 'The checks and the level survive a reload')

  // A curated zone of the same garden is advised as before.
  await openPicker(page)
  await page.locator('.slot-picker').getByRole('button', { name: /Bedeng A/ }).click()
  await page.locator('.dashboard-care:not(.learning-card)').waitFor()
  ok(await card(page).count() === 0, 'A curated zone shows the answer card again')
  ok(await page.locator('.condition-band').count() === 1, 'A curated pot has its moisture zones')
  await page.close()

  // Phone: the card, the progress rows and the three buttons fit at 390 and at 320 with text at 200%.
  for (const [width, text] of [[390, false], [320, true]]) {
    const phone = await open({ width, text, reducedMotion: 'reduce' })
    await loadDemo(phone)
    await card(phone).waitFor()
    ok(await noOverflow(phone), `The learning card does not widen the page at ${width}px${text ? ' with text at 200%' : ''}`)
    const buttons = await card(phone).getByRole('group', { name: 'Catat pengecekan' }).getByRole('button').all()
    ok(buttons.length === 3, 'Three check buttons')
    for (const button of buttons) { const box = await button.boundingBox(); ok(box && box.x >= -1 && box.x + box.width <= width + 1, `A check button stays on screen at ${width}px`) }
    await card(phone).screenshot({ path: `${output}/card-${width}${text ? '-text200' : ''}.png` })
    await phone.close()
  }

  assert.deepEqual(errors, [], `Console errors: ${errors.join(' | ')}`)
  console.log(`learning-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
