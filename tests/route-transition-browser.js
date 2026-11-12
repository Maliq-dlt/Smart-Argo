import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = new URL('/', process.env.TEST_URL || 'http://127.0.0.1:4174/').href
const appChunk = /\/(?:assets\/App-[^/]+\.js|src\/App\.tsx)(?:\?.*)?$/
const output = '.tmp/route-transition'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
const report = [], errors = []
const settled = page => page.waitForFunction(() => !document.documentElement.hasAttribute('data-site-transition') && !document.querySelector('.site-pending') && getComputedStyle(document.querySelector('.site-page')).opacity === '1')
try {
  for (const width of [1440, 375]) for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
    page.on('pageerror', error => errors.push(error.message))
    let release
    const gate = new Promise(resolve => { release = resolve })
    await page.route(appChunk, async route => { await gate; await route.continue() })
    await page.goto(url)
    await page.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).waitFor()
    await page.evaluate(() => {
      window.transitionFrames = []; window.sampleTransition = true
      const sample = () => {
        const view = document.querySelector('.site-page'), main = document.getElementById('main')
        window.transitionFrames.push({ landing: !!document.querySelector('.ag-landing'), app: !!document.querySelector('.app-shell'), fullLoading: !!document.querySelector('.site-loading, .site-initial-loading'), transform: getComputedStyle(view).transform, mainOpacity: main ? Number(getComputedStyle(main).opacity) : null, animations: document.getAnimations().map(animation => animation.animationName).filter(name => name?.startsWith('site-swap')) })
        if (window.sampleTransition) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.locator('.sa-hero .ag-simulator-link').waitFor({ state: 'visible' }); await page.waitForTimeout(1200)
    await page.locator('.sa-hero .ag-simulator-link').focus(); await page.keyboard.press('Enter')
    await page.locator('.site-pending').waitFor()
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.site-pending')).opacity) === 1)
    assert.match(await page.getByRole('status').innerText(), /Menyiapkan ruang tanam/)
    assert(await page.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).isVisible(), 'Cold navigation keeps landing visible')
    assert.equal(await page.locator('.site-loading, .site-initial-loading, .app-shell').count(), 0, 'No intermediate full-screen loader or premature app')
    if (width === 1440 && reducedMotion === 'no-preference') await page.screenshot({ path: `${output}/pending.png` })
    release()
    await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor(); await settled(page)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main')
    assert.equal(await page.evaluate(() => scrollY), 0)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const frames = await page.evaluate(() => { window.sampleTransition = false; return window.transitionFrames })
    await writeFile(`${output}/frames-${width}-${reducedMotion}.json`, JSON.stringify(frames, null, 2))
    assert(frames.every(frame => frame.landing || frame.app), 'Every frame retains real content')
    assert(frames.every(frame => !frame.fullLoading && frame.transform === 'none'), 'No loader flash or transformed sticky ancestor')
    assert(frames.filter(frame => frame.app).every(frame => frame.mainOpacity === 1), 'First app content must be fully drawn before snapshot capture')
    if (reducedMotion === 'reduce') assert(frames.every(frame => !frame.animations.length), 'Reduced motion skips native crossfade')
    else assert(frames.some(frame => frame.animations.includes('site-swap-in')), 'Actual page snapshots must crossfade')
    if (width === 375) await page.getByRole('button', { name: 'Buka navigasi', exact: true }).click()
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor()
    await page.waitForFunction(() => getComputedStyle(document.getElementById('main')).opacity === '1')
    if (width === 1440 && reducedMotion === 'no-preference') await page.screenshot({ path: `${output}/dashboard.png` })
    await page.getByRole('link', { name: 'Smart Agro · Beranda', exact: true }).click()
    await page.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).waitFor(); await settled(page)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'landing-main')
    for (let i = 0; i < 3; i++) {
      await page.locator('.sa-hero .ag-simulator-link').click(); await page.goBack()
      await page.waitForFunction(() => location.hash !== '#simulasi' && !!document.getElementById('landing-main')); await settled(page)
      assert.equal(await page.locator('.app-shell').count(), 0, 'Rapid Back keeps latest destination')
    }
    await page.goto(`${url}#statistik`)
    await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor(); await settled(page)
    report.push({ width, reducedMotion, coldLoad: 'landing retained', nativeFade: reducedMotion === 'reduce' ? 'skipped' : 'pass', blankFrames: 0, focus: 'pass', rapidBack: 'pass', directDashboard: 'pass' })
    await page.close()
  }
  const cancelled = await browser.newPage({ viewport: { width: 375, height: 900 } })
  let releaseCancelled
  const cancellationGate = new Promise(resolve => { releaseCancelled = resolve })
  await cancelled.route(appChunk, async route => { await cancellationGate; await route.continue() })
  await cancelled.goto(url); await cancelled.locator('.sa-hero .ag-simulator-link').click()
  await cancelled.locator('.site-pending').waitFor(); await cancelled.getByRole('button', { name: 'Batal', exact: true }).click()
  releaseCancelled(); await settled(cancelled); await cancelled.waitForTimeout(500)
  assert.equal(await cancelled.locator('.app-shell').count(), 0)
  assert.equal(await cancelled.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), null, 'Cancelled load creates no session')
  await cancelled.close()
  const failed = await browser.newPage({ reducedMotion: 'reduce' })
  await failed.route(appChunk, route => route.abort())
  await failed.goto(url); await failed.locator('.sa-hero .ag-simulator-link').click(); await failed.getByRole('alert').waitFor()
  assert.match(await failed.getByRole('alert').innerText(), /Simulator belum dapat dibuka/)
  await failed.getByRole('link', { name: 'Kembali ke beranda', exact: true }).click()
  await failed.getByRole('heading', { name: /Tahu kapan pot perlu air/ }).waitFor(); await failed.close()
  const fallback = await browser.newPage()
  await fallback.addInitScript(() => { document.startViewTransition = undefined })
  await fallback.goto(url); await fallback.locator('.sa-hero .ag-simulator-link').click()
  await fallback.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor(); await settled(fallback)
  assert.equal(await fallback.locator('.site-page-fallback').count(), 1)
  assert.equal(await fallback.locator('.site-loading, .site-initial-loading').count(), 0)
  await fallback.close()
  assert.deepEqual(errors, [])
  await writeFile(output + '/browser-report.json', JSON.stringify({ report, cancellation: 'pass', failedChunk: 'handled', fallback: 'pass', errors }, null, 2))
  console.log('Route transitions passed: cold load, focus, cancellation, rapid Back, direct routes, failed chunk and native fallback.')
} finally { await browser.close() }
