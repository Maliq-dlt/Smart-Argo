// Navigation v2 (plan 2026-11-22-web-ui-dashboard-v2, U1 + U4): the floating capsule, its lens, the phone layout at
// the bottom, and page changes where the new page eases in over the old one (2026-11-24: a swap in one frame read as a
// blink). The old page is never faded, so the screen never dims between two pages. Guest mode, no backend. Serve the
// build with `npx vite preview --port 4174 --host 127.0.0.1` (default TEST_URL).
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

async function open(width, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321/.test(message.text())) errors.push(message.text()) })
  await page.goto(new URL('#statistik', base).href); await curtainOpen(page)
  await page.locator('.overview').waitFor()
  return page
}
const nav = page => page.getByRole('navigation', { name: 'Navigasi utama' })
const current = page => nav(page).locator('[aria-current=page]').innerText()
/** Watches every frame while `act` runs and the page settles: the lowest opacity of <main>, the View Transition
 *  animations seen, which of them touched the old page (it must stay opaque, or the screen dims) and the longest one
 *  on the new page. */
async function watchFrames(page, act) {
  await page.evaluate(() => {
    const w = window.__frames = { min: 1, viewTransitions: 0, oldAnimated: 0, newAnimated: 0, longest: 0, loading: 0, frames: 0, stop: false }
    const tick = () => {
      const main = document.getElementById('main')
      if (main) w.min = Math.min(w.min, Number(getComputedStyle(main).opacity))
      if (document.querySelector('.page-loading')) w.loading++
      for (const a of document.getAnimations()) {
        const pseudo = a.effect?.pseudoElement ?? ''
        if (!/::view-transition/.test(pseudo)) continue
        w.viewTransitions++
        if (pseudo.startsWith('::view-transition-old')) w.oldAnimated++
        if (pseudo === '::view-transition-new(root)') { w.newAnimated++; w.longest = Math.max(w.longest, Number(a.effect.getTiming().duration) || 0) }
      }
      w.frames++
      if (!w.stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await act()
  await page.waitForTimeout(600)
  return page.evaluate(() => { window.__frames.stop = true; return window.__frames })
}

try {
  // Wide: the capsule floats at the top with Ringkasan, Tanaman, Ruang tanam (guest) and Akun.
  const page = await open(1440)
  const box = await nav(page).boundingBox()
  ok(box.y < 40, `The capsule floats at the top (${box.y})`)
  ok(JSON.stringify(await nav(page).locator('.nav-tab').allInnerTexts()) === JSON.stringify(['Ringkasan', 'Tanaman', 'Ruang tanam', 'Akun']), 'Four sections for a guest')
  ok(await current(page) === 'Ringkasan', 'Ringkasan is the landing page')
  ok(await nav(page).locator('[aria-current=page] .nav-lens').count() === 1, 'The lens sits under the current tab')

  // A tab click eases the new page in over the old one: no swap in one frame, the old page never fades (no dim), and
  // it is quick enough not to slow a second click down.
  for (const label of ['Tanaman', 'Ruang tanam', 'Ringkasan', 'Tanaman']) {
    const frames = await watchFrames(page, () => nav(page).getByRole('link', { name: label }).click())
    ok(await current(page) === label, `${label} becomes current`)
    ok(frames.min === 1, `Opening ${label} never dims the page (lowest opacity ${frames.min})`)
    ok(frames.newAnimated > 0, `Opening ${label} eases the new page in (${frames.newAnimated} frames)`)
    ok(frames.oldAnimated === 0, `Opening ${label} never fades the old page (${frames.oldAnimated})`)
    ok(frames.longest > 0 && frames.longest <= 300, `Opening ${label} takes at most 300 ms (${frames.longest})`)
  }
  // Ringkasan straight to Akun (a separate chunk): the page eases in like the others and "Memuat…" never shows for a
  // frame (2026-11-24: React.lazy suspended once and the page blinked).
  await nav(page).getByRole('link', { name: 'Ringkasan' }).click(); await page.locator('.overview').waitFor()
  const account = await watchFrames(page, () => nav(page).getByRole('link', { name: 'Akun' }).click())
  ok(await current(page) === 'Akun', 'Akun becomes current')
  ok(account.loading === 0, `Opening Akun never shows "Memuat…" (${account.loading} frames)`)
  ok(account.newAnimated > 0 && account.oldAnimated === 0, 'Opening Akun eases the page in without dimming')
  // The tools of a plant live under Tanaman; the account's pages under Akun.
  await page.goto(new URL('#terminal', base).href)
  ok(await current(page) === 'Tanaman', 'Terminal belongs to Tanaman')
  await page.goto(new URL('#profil', base).href)
  ok(await current(page) === 'Akun', 'Profil belongs to Akun')

  // Quick back-and-forth: the latest page wins and nothing is left half-way.
  await page.goto(new URL('#statistik', base).href)
  const quick = await watchFrames(page, async () => { for (const label of ['Tanaman', 'Ringkasan', 'Tanaman', 'Ringkasan']) await nav(page).getByRole('link', { name: label }).click() })
  ok(await current(page) === 'Ringkasan' && await page.locator('.overview').count() === 1, 'After quick clicks the last page is shown')
  ok(quick.min === 1 && quick.oldAnimated === 0, `Quick clicks never dim the page (${quick.min}, old faded ${quick.oldAnimated})`)
  ok(await page.evaluate(() => document.documentElement.dataset.pageTransition === undefined), 'No transition is left half-way after quick clicks')
  await page.close()

  // Keyboard: the tabs are links in reading order, after the skip link.
  const keys = await open(1440)
  // Loading a page focuses <main> (so a screen reader starts at the content); start from the skip link instead.
  await keys.locator('.skip-link').focus()
  const order = []
  for (let i = 0; i < 6; i++) { await keys.keyboard.press('Tab'); order.push(await keys.evaluate(() => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label'))) }
  ok(order.slice(1, 5).join('|') === 'Ringkasan|Tanaman|Ruang tanam|Akun', `Tabs in order: ${order.join(' | ')}`)
  await keys.keyboard.press('Shift+Tab'); await keys.keyboard.press('Shift+Tab'); await keys.keyboard.press('Shift+Tab')
  await keys.keyboard.press('Enter'); await keys.waitForFunction(() => location.hash === '#tanaman')
  ok(await current(keys) === 'Tanaman', 'Enter on a tab opens it')
  await keys.close()

  // Phone: the capsule sits at the bottom, inside the screen, and the content clears it.
  for (const width of [390, 320]) {
    const phone = await open(width)
    const capsule = await nav(phone).boundingBox()
    ok(capsule.y + capsule.height <= 900 && capsule.y > 900 - capsule.height - 40, `At ${width}px the capsule is at the bottom (${Math.round(capsule.y)})`)
    ok(capsule.x >= 0 && capsule.x + capsule.width <= width, `At ${width}px the capsule fits`)
    ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No sideways scroll at ${width}px`)
    await phone.close()
  }

  // Reduced motion: still at once, no transitions at all (a card opens its plant without the morph).
  const calm = await open(1440, 'reduce')
  const frames = await watchFrames(calm, () => calm.locator('.ov-card, .ov-tile').first().click())
  ok(await current(calm) === 'Tanaman', 'A card opens its plant')
  ok(frames.viewTransitions === 0 && frames.min === 1, 'With reduced motion the card does not morph')
  const tab = await watchFrames(calm, () => nav(calm).getByRole('link', { name: 'Ringkasan' }).click())
  ok(await current(calm) === 'Ringkasan' && tab.viewTransitions === 0, 'With reduced motion a tab swaps the page at once')
  await calm.close()

  ok(errors.length === 0, `No page errors: ${errors.join(' | ')}`)
  console.log(`nav-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
