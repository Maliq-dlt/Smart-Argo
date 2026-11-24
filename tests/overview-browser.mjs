// Ringkasan and the plant page (plan 2026-11-22-web-ui-dashboard-v2, U2 + U3): one sentence for every plant, cards
// that need you first, a card that carries its plant into the stage, the rail of other plants labelled without
// hovering, Riwayat as one card with three views, and no sideways scroll at any width, theme or text size.
// Guest mode, no backend. Serve the build with `npx vite preview --port 4174 --host 127.0.0.1` (default TEST_URL).
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/'
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser)
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

async function open({ width = 1440, theme = 'light', text = false, demo = true, hash = '#tanaman' } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(value => { try { localStorage.setItem('smart-agro.theme', value) } catch { /* blocked */ } }, theme)
  await page.goto(new URL('#tanaman', base).href, { waitUntil: 'domcontentloaded', timeout: 90000 }); await curtainOpen(page)
  await page.locator('.plant-scene svg').waitFor()
  if (demo) {
    await page.locator('.session-pill .pill-trigger').click()
    await page.locator('.slot-picker').getByRole('button', { name: 'Muat contoh kebun' }).click()
    await page.getByRole('status').filter({ hasText: 'Contoh dimuat' }).waitFor()
  }
  if (hash !== '#tanaman') { await page.evaluate(h => { location.hash = h }, hash); await page.locator('.overview').waitFor() }
  if (text) {
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
    await page.evaluate(() => { document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '' })
  }
  return page
}
const view = (page, name) => page.getByRole('group', { name: 'Tampilan riwayat' }).getByRole('radio', { name }).check({ force: true })

try {
  // One plant: one sentence about it and one wide card, no "Tanaman lain" anywhere.
  const single = await open({ demo: false, hash: '#statistik' })
  ok(await single.locator('.ov-title').count() === 1 && /\.$/.test(await single.locator('.ov-title').innerText()), 'Ringkasan opens with one sentence')
  ok(await single.locator('.ov-featured.single .ov-card').count() === 1 && await single.locator('.ov-tile').count() === 0, 'One plant is one wide card')
  ok(await single.getByRole('button', { name: 'Muat contoh kebun' }).isVisible(), 'A guest without a garden finds the example garden on Ringkasan')
  await single.locator('.ov-card').click()
  await single.waitForFunction(() => location.hash === '#tanaman')
  ok(await single.locator('.plant-rail').count() === 0, 'A single plant has no rail')
  await single.close()

  // Three plants (the demo): status words, cards open their plant with a morph into the stage.
  const page = await open({ hash: '#statistik' })
  ok(await page.locator('.ov-card, .ov-tile').count() === 3, 'Three plants on Ringkasan')
  ok(await page.getByRole('button', { name: 'Muat contoh kebun' }).count() === 0, 'Once the garden exists the example is not offered again')
  ok(/\d+ baik|sedang dipelajari/.test(await page.locator('.ov-sub').innerText()), 'The calm plants are counted under the sentence')
  const target = page.locator('.ov-card, .ov-tile').filter({ hasText: 'Cabai' }).first()
  const morph = page.evaluate(() => new Promise(resolve => {
    const seen = new Set(), until = performance.now() + 1500
    const tick = () => { for (const a of document.getAnimations()) if (a.effect?.pseudoElement) seen.add(a.effect.pseudoElement); if (performance.now() < until) requestAnimationFrame(tick); else resolve([...seen]) }
    requestAnimationFrame(tick)
  }))
  await target.click()
  await page.waitForFunction(() => location.hash === '#tanaman')
  ok((await morph).some(p => /plant-stage/.test(p)), 'The card travels into the stage (a View Transition named plant-stage)')
  ok(await page.getByRole('navigation', { name: 'Navigasi utama' }).locator('[aria-current=page]').innerText() === 'Tanaman', 'The Tanaman tab is current')
  ok(/^CB-\d+$/.test((await page.locator('.plant-rail [aria-current]').innerText()).trim()), 'The plant opened is the current tick')

  // The rail: every tick labelled with its code, a preview that fades in on hover, a click switches in place and no
  // tick moves (2026-11-24: a longer label on the current tick pushed the others sideways, which read as a jitter).
  const rail = page.getByRole('navigation', { name: 'Tanaman lain' })
  ok(await rail.getByRole('button').count() === 3, 'One tick per plant')
  const labels = await rail.getByRole('button').allInnerTexts()
  ok(labels.every(label => /^[A-Z]{2}-\d+$/.test(label.trim())), `Every tick carries its code: ${labels.join(', ')}`)
  const positions = () => rail.getByRole('button').evaluateAll(buttons => buttons.map(b => Math.round(b.getBoundingClientRect().left)).join(','))
  const placed = await positions()
  const next = rail.locator('button:not([aria-current])').first()
  await next.hover(); await page.locator('.plant-rail-peek[data-open]').waitFor()
  ok(true, 'Pointing at a tick previews that plant')
  const before = await page.locator('.plant-scene svg').getAttribute('aria-label')
  await next.click()
  await page.waitForFunction(label => document.querySelector('.plant-scene svg')?.getAttribute('aria-label') !== label, before)
  ok(new URL(page.url()).hash === '#tanaman', 'Switching from the rail stays on the plant page')
  ok(await positions() === placed, `Choosing another plant moves no tick (${placed} → ${await positions()})`)
  await page.mouse.move(5, 895)
  ok(await page.locator('.plant-rail-peek[data-open]').count() === 0, 'Leaving the rail closes the preview (it fades out)')

  // Riwayat: one card, three views in the same place.
  ok(await page.locator('.history-card').count() === 1 && await page.locator('.analysis-toolbar').count() === 1, 'Riwayat opens on the chart')
  await view(page, 'Kalender'); ok(await page.locator('.history-calendar').count() === 1 && await page.locator('.analysis-toolbar').count() === 0, 'Kalender replaces the chart')
  await view(page, 'Jurnal'); ok(await page.locator('.journal-day').count() <= 5, 'Jurnal shows at most five days')
  await page.close()

  // A seed not planted yet, at 200% text on small phones (the state that once overflowed by 71 px).
  for (const width of [390, 320]) {
    const phone = await open({ width, text: true, demo: false })
    ok(await overflow(phone) <= 0, `The unplanted plant page fits at ${width}px with text at 200% (${await overflow(phone)})`)
    await phone.close()
  }
  // Every width, theme and (on phones) text size: Ringkasan and each Riwayat view fit.
  for (const width of [1440, 768, 390, 320]) for (const theme of ['light', 'dark']) for (const text of width <= 390 ? [false, true] : [false]) {
    const at = `${width}px ${theme}${text ? ' 200%' : ''}`
    const plant = await open({ width, theme, text })
    for (const name of ['Grafik', 'Kalender', 'Jurnal']) { await view(plant, name); ok(await overflow(plant) <= 0, `${name} fits at ${at}`) }
    await plant.evaluate(() => { location.hash = '#statistik' }); await plant.locator('.overview').waitFor()
    ok(await overflow(plant) <= 0, `Ringkasan fits at ${at}`)
    await plant.close()
  }
  ok(errors.length === 0, `No page errors: ${errors.join(' | ')}`)
  console.log(`overview-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
