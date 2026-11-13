import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const output = '.tmp/landing-v5'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser) // account entry is covered by the account checks
const errors = [], report = []
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
/** Scroll so that `fraction` of a sticky wrapper's travel has passed, then let the scrub settle. */
const scrollPin = async (page, selector, fraction) => {
  await page.evaluate(([s, f]) => { const el = document.querySelector(s); scrollTo(0, el.getBoundingClientRect().top + scrollY + (el.offsetHeight - innerHeight) * f) }, [selector, fraction])
  await page.waitForTimeout(1300)
}
/** True when the canvas has drawn something other than a flat colour. */
const painted = (page, selector) => page.evaluate(s => {
  const c = document.querySelector(s), ctx = c.getContext('2d'), { width: w, height: h } = c
  if (!w || !h) return false
  const d = ctx.getImageData(0, 0, w, h).data, seen = new Set()
  for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`)
  return seen.size > 6
}, selector)

try {
  for (const [width, height, reducedMotion] of [[1440, 900, 'no-preference'], [1024, 768, 'no-preference'], [390, 844, 'no-preference'], [320, 740, 'no-preference'], [1440, 900, 'reduce'], [390, 844, 'reduce']]) {
    console.log(`Checking ${width}x${height}, ${reducedMotion}`)
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion })
    page.on('pageerror', error => errors.push(`${width} ${reducedMotion}: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`${width} ${reducedMotion}: ${message.text()}`) })
    await page.goto(url)

    // Loading curtain: covers the first paint, then lifts; reduced motion skips it.
    if (reducedMotion === 'no-preference') {
      assert.equal(await page.locator('#boot').count(), 0, 'Static loader hands over to the React curtain')
      await page.waitForSelector('.curtain[data-state=open]', { timeout: 8000 })
    } else assert.equal(await page.locator('.curtain').count(), 0, 'Reduced motion has no curtain')
    await page.getByRole('heading', { level: 1, name: 'Tahu kapan pot perlu air.' }).waitFor()
    await page.locator('.sa-hero .ag-simulator-link').waitFor({ state: 'visible', timeout: 4000 })
    assert(await fits(page), `First screen overflow at ${width}`)
    const video = await page.evaluate(() => { const v = document.querySelector('.v5-hero video'); return { src: v.currentSrc, paused: v.paused } })
    assert.match(video.src, /spin-loop\.mp4$/, 'Hero plays the turning device')
    assert.equal(video.paused, reducedMotion === 'reduce', 'Hero video plays only with motion allowed')

    // Theme: the landing follows the same toggle and storage key as the simulator.
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
    const before = await theme()
    await page.locator('.sa-nav .theme-toggle').click()
    await page.waitForFunction(previous => document.documentElement.dataset.theme !== previous, before)
    assert.equal(await page.evaluate(() => localStorage.getItem('smart-agro.theme')), await theme())
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sa')).backgroundColor), (await theme()) === 'dark' ? 'rgb(22, 29, 25)' : 'rgb(236, 239, 231)', 'Landing palette follows the theme')
    await page.locator('.sa-nav .theme-toggle').click()
    await page.waitForFunction(previous => document.documentElement.dataset.theme === previous, before)
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/hero-${width}-${reducedMotion}.png` })

    // Cursor trail: squares light up over the video's centre on desktop, then stop once the blocks close over the hero.
    const trailPixels = () => page.evaluate(() => {
      const c = document.querySelector('.v5-trail')
      if (!c.width) return 0
      const d = c.getContext('2d').getImageData(c.width * .3, c.height * .3, c.width * .4, c.height * .4).data
      let n = 0
      for (let i = 3; i < d.length; i += 16) if (d[i]) n++
      return n
    })
    const sweep = async () => { for (let i = 0; i <= 12; i++) await page.mouse.move(width * (.35 + i * .025), height * .5) }
    // The theme reveal's overlay takes the pointer until it ends.
    await page.waitForFunction(() => document.documentElement.dataset.themeTransition === undefined)
    await sweep()
    const trail = width >= 1024 && reducedMotion === 'no-preference'
    if (trail) {
      assert(await trailPixels() > 0, 'Trail squares appear over the centre of the video')
      if (width === 1440) await page.screenshot({ path: `${output}/hero-trail-${width}.png` })
      await page.waitForTimeout(600)
      assert(await trailPixels() > 0, 'Trail squares hold as a mosaic before fading')
      await page.waitForTimeout(1200)
      assert.equal(await trailPixels(), 0, 'Trail squares fade out')
      await scrollPin(page, '.v5-hero-wrap', .6)
      await sweep()
      assert.equal(await trailPixels(), 0, 'No trail once the blocks close over the hero')
    } else assert.equal(await trailPixels(), 0, 'No trail on touch-sized screens or with reduced motion')

    // Problem: the drawing is a real illustration, not a placeholder shape.
    assert(await page.locator('.v5-plant .v5-leaf-shape').count() >= 16, 'Plant has its leaves')
    assert(await page.locator('.v5-plant .v5-root-line').count() >= 60, 'Plant has a branching root system')
    await scrollPin(page, '.v5-pin-draw', .95)
    assert.equal(await page.locator('.v5-draw-b').isVisible(), true)

    // Device scene: phases follow the scroll, forwards and back.
    const phase = () => page.locator('.v5-pin-product .v5-stage').getAttribute('data-phase')
    if (reducedMotion === 'no-preference') {
      for (const [fraction, expected] of [[.1, '0'], [.5, '1'], [.9, '2'], [.1, '0']]) { await scrollPin(page, '.v5-pin-product', fraction); assert.equal(await phase(), expected, `Device phase at ${fraction}`) }
    } else assert.equal(await phase(), 'all', 'Reduced motion shows every phase')
    assert(await painted(page, '.v5-pin-product canvas'), 'Device frames are drawn')
    await scrollPin(page, '.v5-pin-root', .9)
    assert(await painted(page, '.v5-pin-root canvas'), 'Root-zone frames are drawn')

    // Grow: each click advances one stage, the last one swaps the title, and it can restart.
    await page.locator('#rawat').scrollIntoViewIfNeeded(); await page.waitForTimeout(900)
    const button = page.getByRole('button', { name: 'Siram sesuai saran' })
    for (const label of ['Minggu 1', 'Minggu 3', 'Minggu 5', 'Berbunga']) {
      await button.click()
      await page.waitForFunction(text => document.querySelector('.v5-grow-stage')?.textContent === text, label, { timeout: 8000 }).catch(async error => {
        throw new Error(`${label}: ${JSON.stringify(await page.evaluate(() => ({ stage: document.querySelector('.v5-grow-stage')?.textContent, buttons: [...document.querySelectorAll('.v5-grow button')].map(b => b.textContent + ':' + b.getAttribute('aria-disabled')), y: scrollY })))} ${error.message.slice(0, 80)}`)
      })
      await page.waitForFunction(() => document.querySelector('.v5-grow .sa-btn')?.getAttribute('aria-disabled') !== 'true')
    }
    await page.getByRole('button', { name: 'Ulangi' }).waitFor()
    await page.waitForFunction(() => /Begitulah hasilnya/.test(document.getElementById('v5-grow-title').textContent))
    assert(await painted(page, '.v5-grow canvas'), 'Growth frames are drawn')
    if (width === 1440 && reducedMotion === 'no-preference') await page.screenshot({ path: `${output}/grow.png` })
    await page.getByRole('button', { name: 'Ulangi' }).click()
    await page.getByRole('button', { name: 'Siram sesuai saran' }).waitFor()

    // Explore: four parts of the prototype, each with an honest status, and a working arrow.
    const cards = page.locator('.v5-card')
    assert.equal(await cards.count(), 4)
    assert.deepEqual(await cards.locator('a').evaluateAll(links => links.map(a => a.getAttribute('href'))), ['#simulasi', '#statistik', '#perangkat', '#ekosistem'])
    await page.locator('#jelajah').scrollIntoViewIfNeeded(); await page.waitForTimeout(700)
    const track = page.locator('.v5-explore-track')
    const start = await track.evaluate(el => el.scrollLeft)
    await page.getByRole('button', { name: 'Kartu berikutnya' }).click(); await page.waitForTimeout(700)
    if (await track.evaluate(el => el.scrollWidth > el.clientWidth + 2)) assert((await track.evaluate(el => el.scrollLeft)) > start, 'Arrow moves the card row')

    // Footer and overall fit.
    await page.locator('.mrf-root').scrollIntoViewIfNeeded()
    assert(await fits(page), `Page overflow at ${width}`)
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/footer-${width}-${reducedMotion}.png` })
    report.push({ width, reducedMotion, curtain: reducedMotion === 'reduce' ? 'skipped' : 'pass', hero: 'pass', theme: 'pass', plant: 'pass', phases: 'pass', sequences: 'pass', grow: 'pass', explore: 'pass', overflow: 'pass' })
    await page.close()
  }
  assert.deepEqual(errors, [], 'No page errors')
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
