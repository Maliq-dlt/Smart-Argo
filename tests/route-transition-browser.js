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
    await page.getByRole('heading', { name: /Kenali potmu/ }).waitFor()
    await page.evaluate(() => {
      window.transitionFrames = []; window.sampleTransition = true
      const sample = () => {
        const view = document.querySelector('.site-page'), main = document.getElementById('main')
        window.transitionFrames.push({ landing: !!document.querySelector('.landing-page'), app: !!document.querySelector('.app-shell'), fullLoading: !!document.querySelector('.site-loading, .site-initial-loading'), transform: getComputedStyle(view).transform, mainOpacity: main ? Number(getComputedStyle(main).opacity) : null, animations: document.getAnimations().map(animation => animation.animationName).filter(name => name?.startsWith('site-swap')) })
        if (window.sampleTransition) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.locator('.landing-nav-cta').focus(); await page.keyboard.press('Enter')
    await page.locator('.site-pending').waitFor()
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.site-pending')).opacity) === 1)
    assert.match(await page.getByRole('status').innerText(), /Menyiapkan ruang tanam/)
    assert(await page.getByRole('heading', { name: /Kenali potmu/ }).isVisible(), 'Cold navigation keeps landing visible')
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
    await page.getByRole('heading', { name: /Kenali potmu/ }).waitFor(); await settled(page)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'landing-main')
    for (let i = 0; i < 3; i++) {
      await page.locator('.landing-nav-cta').click(); await page.goBack()
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
  await cancelled.goto(url); await cancelled.locator('.landing-nav-cta').click()
  await cancelled.locator('.site-pending').waitFor(); await cancelled.getByRole('button', { name: 'Batal', exact: true }).click()
  releaseCancelled(); await settled(cancelled); await cancelled.waitForTimeout(500)
  assert.equal(await cancelled.locator('.app-shell').count(), 0)
  assert.equal(await cancelled.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), null, 'Cancelled load creates no session')
  await cancelled.close()
  const failed = await browser.newPage({ reducedMotion: 'reduce' })
  await failed.route(appChunk, route => route.abort())
  await failed.goto(url); await failed.locator('.landing-nav-cta').click(); await failed.getByRole('alert').waitFor()
  assert.match(await failed.getByRole('alert').innerText(), /Simulator belum dapat dibuka/)
  await failed.getByRole('link', { name: 'Kembali ke beranda', exact: true }).click()
  await failed.getByRole('heading', { name: /Kenali potmu/ }).waitFor(); await failed.close()
  const fallback = await browser.newPage()
  await fallback.addInitScript(() => { document.startViewTransition = undefined })
  await fallback.goto(url); await fallback.locator('.landing-nav-cta').click()
  await fallback.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor(); await settled(fallback)
  assert.equal(await fallback.locator('.site-page-fallback').count(), 1)
  assert.equal(await fallback.locator('.site-loading, .site-initial-loading').count(), 0)
  await fallback.close()
  const scroll = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  scroll.on('pageerror', error => errors.push(error.message))
  await scroll.goto(`${url}#story-step-0`)
  assert.equal(await scroll.locator('.story-media-content').count(), 3, 'All story scenes stay mounted')
  await scroll.waitForFunction(() => document.querySelector('.landing-story').dataset.active === '0')
  const bounds = await scroll.locator('.landing-story').evaluate(e => ({ top: e.getBoundingClientRect().top + scrollY, range: e.offsetHeight - innerHeight }))
  for (let i = 0; i < 12; i++) {
    await scroll.evaluate(({ top, range, i }) => scrollTo(0, top + range * (.25 + (i % 2 ? -.006 : .006))), { ...bounds, i })
    await scroll.waitForTimeout(30)
    assert.equal(await scroll.locator('.landing-story').getAttribute('data-active'), '0', 'Small boundary jitter must not flip scenes')
  }
  await scroll.evaluate(() => {
    window.storyFrames = []; window.sampleStory = true; window.storyPot = document.querySelector('.story-root-camera > svg')
    const sample = () => {
      const panels = Array.from(document.querySelectorAll('.story-media-content'))
      window.storyFrames.push({ opacity: panels.reduce((sum, panel) => sum + Number(getComputedStyle(panel).opacity), 0), count: panels.length, height: document.querySelector('.story-media').offsetHeight, samePot: document.querySelector('.story-root-camera > svg') === window.storyPot, potCount: document.querySelectorAll('.story-root-camera > svg').length, shell: Number(getComputedStyle(window.storyPot.querySelector('.plant-shell')).opacity), sensors: Number(getComputedStyle(window.storyPot.querySelector('.plant-sensors')).opacity) })
      if (window.sampleStory) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  for (const progress of [.85, .1, .6, .15, .9, .5, .1]) {
    await scroll.evaluate(({ top, range, progress }) => scrollTo(0, top + range * progress), { ...bounds, progress })
    await scroll.waitForTimeout(90)
  }
  await scroll.waitForTimeout(250)
  const storyFrames = await scroll.evaluate(() => { window.sampleStory = false; return window.storyFrames })
  assert(storyFrames.length > 10)
  assert(storyFrames.every(frame => frame.count === 3 && frame.opacity > .7), 'Fast reverse scrolling must not empty the sticky card')
  assert.equal(new Set(storyFrames.map(frame => frame.height)).size, 1, 'Sticky frame height remains stable')
  assert(storyFrames.every(frame => frame.samePot && frame.potCount === 1), 'Every rendered frame retains the same pot during reverse scroll')
  const checkpoints = []
  for (const progress of [0, .15, .3, .5, .8, 1, 0]) {
    await scroll.evaluate(({ top, range, progress }) => scrollTo(0, top + range * progress), { ...bounds, progress })
    await scroll.waitForTimeout(250)
    checkpoints.push(await scroll.locator('.story-root-camera').evaluate(e => ({ shell: Number(getComputedStyle(e.querySelector('.plant-shell')).opacity), sensors: Number(getComputedStyle(e.querySelector('.plant-sensors')).opacity), tag: Number(getComputedStyle(e.querySelector('.story-surface-line')).opacity), probe: Number(getComputedStyle(e.querySelector('.story-root-probe')).opacity), transform: getComputedStyle(e).transform })))
    await scroll.screenshot({ path: `${output}/narrative-${checkpoints.length}.png` })
  }
  assert(checkpoints[0].shell > .99 && checkpoints[0].sensors < .01, 'First scene keeps pot closed and probes hidden')
  assert(checkpoints[1].shell > .1 && checkpoints[1].shell < .99, 'Cutaway changes continuously between chapters')
  assert(checkpoints[2].sensors > 0 && checkpoints[2].sensors < 1, 'Probes appear gradually')
  assert(checkpoints[3].shell < .01 && checkpoints[3].sensors > .99, 'Root scene reveals cutaway and probes')
  assert(checkpoints[3].tag < .01 && checkpoints[3].probe > .99, 'HTML callouts follow the same timeline as SVG geometry')
  assert(checkpoints[5].probe < .01, 'Final scene hides the probe callout')
  assert.deepEqual(checkpoints[6], checkpoints[0], 'Reverse scroll restores the original camera and closed pot')
  await writeFile(`${output}/narrative-checkpoints.json`, JSON.stringify(checkpoints, null, 2))
  await scroll.screenshot({ path: `${output}/story.png` }); await scroll.close()
  assert.deepEqual(errors, [])
  await writeFile(`${output}/browser-report.json`, JSON.stringify({ report, cancellation: 'pass', failedChunk: 'handled', fallback: 'pass', scrollJitter: 'pass', storyFrames, errors }, null, 2))
  console.log('Transition/scroll OK: cold landing retained, no full loader or blank frames, native crossfade, immediate first app content, desktop/mobile, reduced motion, Back/cancel, direct dashboard, handled load failure, native fallback, stable story during boundary jitter and fast reverse scrolling.')
} finally { await browser.close() }
