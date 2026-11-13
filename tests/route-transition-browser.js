import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = new URL('/', process.env.TEST_URL || 'http://127.0.0.1:4174/').href
const appChunk = /\/(?:assets\/App-[^/]+\.js|src\/App\.tsx)(?:\?.*)?$/
const output = '.tmp/route-transition'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
asGuest(browser) // account entry is covered by the account checks
const report = [], errors = []
// Settled: the curtain is open (or absent with reduced motion) and no pending notice is shown.
const settled = page => page.waitForFunction(() => {
  const curtain = document.querySelector('.curtain')
  return (!curtain || curtain.dataset.state === 'open') && !document.querySelector('.site-pending')
})
const landingReady = async page => {
  await page.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).waitFor(); await settled(page)
  await page.locator('.sa-hero .ag-simulator-link').waitFor({ state: 'visible' })
}
try {
  for (const width of [1440, 375]) for (const reducedMotion of ['no-preference', 'reduce']) {
    const animated = reducedMotion === 'no-preference'
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
    page.on('pageerror', error => errors.push(error.message))
    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route(appChunk, async route => { await gate; await route.continue() })
    await page.goto(url)
    await landingReady(page)
    await page.evaluate(() => {
      window.transitionFrames = []; window.sampleTransition = true
      const sample = () => {
        const curtain = document.querySelector('.curtain'), main = document.getElementById('main')
        window.transitionFrames.push({ landing: !!document.querySelector('.ag-landing'), app: !!document.querySelector('.app-shell'), fullLoading: !!document.querySelector('.site-loading, .site-initial-loading'), curtain: curtain?.dataset.state ?? null, mainOpacity: main ? Number(getComputedStyle(main).opacity) : null })
        if (window.sampleTransition) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.locator('.sa-hero .ag-simulator-link').focus(); await page.keyboard.press('Enter')
    if (animated) {
      // The curtain closes over the landing while the simulator chunk loads.
      await page.waitForSelector('.curtain[data-state=covered]')
      await page.waitForFunction(() => /Menyiapkan ruang tanam/.test(document.querySelector('.curtain-label')?.textContent ?? ''))
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.curtain-body')).visibility === 'visible')
    } else {
      await page.locator('.site-pending').waitFor()
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.site-pending')).opacity) === 1)
      assert.match(await page.getByRole('status').innerText(), /Menyiapkan ruang tanam/)
      assert(await page.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).isVisible(), 'Reduced motion keeps the landing visible while loading')
    }
    assert.equal(await page.locator('.site-loading, .site-initial-loading, .app-shell').count(), 0, 'No intermediate full-screen loader or premature app')
    if (width === 1440 && animated) await page.screenshot({ path: `${output}/curtain.png` })
    release()
    await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor(); await settled(page)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main')
    assert.equal(await page.evaluate(() => scrollY), 0)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const frames = await page.evaluate(() => { window.sampleTransition = false; return window.transitionFrames })
    await writeFile(`${output}/frames-${width}-${reducedMotion}.json`, JSON.stringify(frames, null, 2))
    assert(frames.every(frame => frame.landing || frame.app), 'Every frame retains real content')
    assert(frames.every(frame => !frame.fullLoading), 'No loader flash')
    if (animated) {
      // The swap from landing to app only ever happens behind a closed curtain.
      const swap = frames.findIndex(frame => frame.app)
      assert(swap > 0 && frames[swap].curtain === 'covered', 'The page swaps behind the closed curtain')
      assert(frames.slice(swap).some(frame => frame.curtain === 'open'), 'The curtain lifts afterwards')
    } else assert(frames.every(frame => frame.curtain === null), 'Reduced motion has no curtain')
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor()
    await page.waitForFunction(() => getComputedStyle(document.getElementById('main')).opacity === '1')
    if (width === 1440 && animated) await page.screenshot({ path: `${output}/dashboard.png` })
    await page.getByRole('link', { name: 'Smart Agro · Beranda', exact: true }).click()
    await landingReady(page)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'landing-main')
    for (let i = 0; i < 3; i++) {
      await page.locator('.sa-hero .ag-simulator-link').click(); await page.goBack()
      await page.waitForFunction(() => location.hash !== '#simulasi' && !!document.getElementById('landing-main')); await settled(page)
      assert.equal(await page.locator('.app-shell').count(), 0, 'Rapid Back keeps latest destination')
    }
    await page.goto(`${url}#statistik`)
    await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor(); await settled(page)
    report.push({ width, reducedMotion, coldLoad: animated ? 'curtain' : 'landing retained', swap: animated ? 'behind curtain' : 'instant', focus: 'pass', rapidBack: 'pass', directDashboard: 'pass' })
    await page.close()
  }
  // Cancel while the chunk is still loading: the curtain offers a way back and lifts onto the landing.
  const cancelled = await browser.newPage({ viewport: { width: 375, height: 900 } })
  let releaseCancelled
  const cancellationGate = new Promise(resolve => { releaseCancelled = resolve })
  await cancelled.route(appChunk, async route => { await cancellationGate; await route.continue() })
  await cancelled.goto(url); await landingReady(cancelled)
  await cancelled.locator('.sa-hero .ag-simulator-link').click()
  await cancelled.getByRole('button', { name: 'Batal', exact: true }).click()
  releaseCancelled(); await settled(cancelled); await cancelled.waitForTimeout(500)
  assert.equal(await cancelled.locator('.app-shell').count(), 0)
  assert(await cancelled.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).isVisible())
  assert.equal(await cancelled.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), null, 'Cancelled load creates no session')
  await cancelled.close()
  // A failed chunk shows the error page, behind the curtain as well as without it.
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const failed = await browser.newPage({ reducedMotion })
    await failed.route(appChunk, route => route.abort())
    await failed.goto(url); await landingReady(failed)
    await failed.locator('.sa-hero .ag-simulator-link').click(); await failed.getByRole('alert').waitFor(); await settled(failed)
    assert.match(await failed.getByRole('alert').innerText(), /Simulator belum dapat dibuka/)
    await failed.getByRole('link', { name: 'Kembali ke beranda', exact: true }).click()
    await landingReady(failed); await failed.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(output + '/browser-report.json', JSON.stringify({ report, cancellation: 'pass', failedChunk: 'handled', errors }, null, 2))
  console.log('Route transitions passed: curtain swap, reduced-motion swap, focus, cancellation, rapid Back, direct routes and failed chunk.')
} finally { await browser.close() }
