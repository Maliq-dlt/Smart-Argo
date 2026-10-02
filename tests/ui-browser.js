import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// PLAYWRIGHT_MODULE may point to an existing Playwright installation; no browser download.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.TEST_URL || 'http://127.0.0.1:4173/#simulasi'
await mkdir('.tmp/ui-check', { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
const errors = []
const monitor = page => {
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
}
const active = page => page.evaluate(() => {
  const book = JSON.parse(localStorage.getItem('smart-agro.sessions.v1'))
  return book.sessions.find(session => session.id === book.activeId)
})
const waitTheme = async (page, theme) => {
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && document.querySelector('.theme-toggle').getAttribute('aria-busy') === 'false', theme)
  assert.equal(await page.locator('[data-theme-icon]').getAttribute('data-theme-icon'), theme)
  assert.equal(await page.locator(`.theme-toggle .lucide-${theme === 'dark' ? 'moon' : 'sun'}`).count(), 1)
  assert.equal(await page.evaluate(() => localStorage.getItem('smart-agro.theme')), theme)
}
const choose = async (page, label, name) => {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await page.locator('.ui-select-content').waitFor({ state: 'detached' })
}
const checkSpotlight = async (page, card, reduced = false) => {
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'))
  await card.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'))
  await card.hover()
  await page.waitForTimeout(250)
  const state = await card.evaluate(element => ({
    x: element.style.getPropertyValue('--spotlight-x'),
    y: element.style.getPropertyValue('--spotlight-y'),
    transform: getComputedStyle(element).transform,
    touchAction: getComputedStyle(element).touchAction,
    effect: getComputedStyle(element, '::after').content,
    opacity: Number(getComputedStyle(element, '::after').opacity),
    pointerEvents: getComputedStyle(element, '::after').pointerEvents,
  }))
  assert(state.x.endsWith('px') && state.y.endsWith('px'), 'Spotlight must follow local pointer coordinates')
  assert.equal(state.transform, 'none', 'Hover must not move cards')
  assert.notEqual(state.touchAction, 'none', 'Card must preserve native touch scrolling')
  if (reduced) assert.equal(state.effect, 'none', 'Reduced motion must disable decorative spotlight')
  else { assert(state.opacity > .5); assert.equal(state.pointerEvents, 'none') }
}
const checkFlowerSeam = async (page, direction) => {
  const source = await page.locator(`.flower-tile[data-distance="${direction > 0 ? -2 : 2}"] img`).getAttribute('src')
  await page.evaluate(({ source, direction }) => {
    window.flowerSeamFrames = []
    const until = performance.now() + 900
    const sample = () => {
      const tile = Array.from(document.querySelectorAll('.flower-tile')).find(tile => tile.querySelector('img').getAttribute('src') === source && Number(tile.dataset.distance) === direction * 2)
      if (tile && Number(getComputedStyle(tile).opacity) > .03) {
        const bounds = tile.getBoundingClientRect(), stage = document.querySelector('.flower-stage').getBoundingClientRect()
        window.flowerSeamFrames.push((bounds.x + bounds.width / 2 - stage.x - stage.width / 2) * direction / stage.width)
      }
      if (performance.now() < until) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { source, direction })
  await page.getByRole('button', { name: direction > 0 ? 'Bunga berikutnya' : 'Bunga sebelumnya', exact: true }).click()
  await page.waitForTimeout(950)
  const frames = await page.evaluate(() => window.flowerSeamFrames)
  assert(frames.length > 4, 'Sample visible wrap animation frames')
  assert(frames.every(position => position > .35), 'Wrapping tile must stay beyond the edge, never cross the center')
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
  monitor(page)
  await page.addInitScript(() => {
    window.themeAnimations = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      if (options?.pseudoElement === '::view-transition-new(root)') window.themeAnimations.push({ frames, options })
      return animate.call(this, frames, options)
    }
  })
  await page.goto(url)
  await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor()
  assert.equal(await page.getByText('Lanjutkan sesi', { exact: false }).count(), 0)
  assert.equal(await page.locator('.plant-mood').count(), 1)
  assert.equal(await page.locator('.plant-mood').getAttribute('data-mood'), 'ready')
  assert.equal(await page.locator('.app-sidebar').evaluate(e => getComputedStyle(e).backdropFilter), 'none')
  const plantButton = page.getByRole('button', { name: 'Tanam & mulai', exact: true })
  await plantButton.focus(); await page.keyboard.down('Space')
  await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.plant-seed')).transform).a - .97) < .001)
  await page.keyboard.up('Space')
  await page.locator('.planting-animation').waitFor()
  assert.equal(await page.locator('.plant-growth').evaluate(e => getComputedStyle(e).animationName), 'sprout-in')
  assert.equal((await active(page)).simulation.planted, true)
  await choose(page, 'Laju waktu sensor', 'Cepat')
  const before = (await active(page)).data.now_h
  for (const theme of ['dark', 'light']) {
    const rect = await page.locator('.theme-toggle').boundingBox()
    await page.locator('.theme-toggle').focus()
    await page.evaluate(() => { const button = document.querySelector('.theme-toggle'); button.click(); button.click() })
    await waitTheme(page, theme)
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('theme-toggle')), true, await page.evaluate(() => document.activeElement?.outerHTML))
    const animation = await page.evaluate(() => window.themeAnimations.at(-1))
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    assert.equal(animation.frames.clipPath[0], `circle(0px at ${x}px ${y}px)`)
    const radius = Number(animation.frames.clipPath[1].match(/circle\(([\d.]+)px/)[1])
    assert(radius >= Math.hypot(Math.max(x, 1440 - x), Math.max(y, 1000 - y)))
    assert.equal(animation.options.duration, 480)
  }
  assert.equal(await page.evaluate(() => window.themeAnimations.length), 2, 'Rapid clicks must produce only one transition per change')
  await page.waitForFunction(before => {
    const book = JSON.parse(localStorage.getItem('smart-agro.sessions.v1'))
    return book.sessions.find(s => s.id === book.activeId).data.now_h > before
  }, before)
  const beforeNavigation = (await active(page)).data.now_h
  for (const [label, heading] of [['Terminal', 'Terminal'], ['Status perangkat', 'Status perangkat'], ['Bandingkan sesi', 'Bandingkan sesi'], ['Dashboard', 'Dashboard'], ['Simulasi', 'Ruang tanam']]) {
    await page.getByRole('link', { name: label, exact: true }).click()
    await page.getByRole('heading', { name: heading, exact: true, level: 1 }).waitFor()
  }
  await page.getByRole('button', { name: 'Jeda', exact: true }).click()
  assert((await active(page)).data.now_h > before, 'Theme animation must not starve simulation time')
  assert((await active(page)).data.now_h > beforeNavigation, 'Page navigation must keep simulation time running')
  const beforeWater = await active(page)
  await page.getByRole('button', { name: 'Siram 150 mL', exact: true }).click()
  await page.locator('.watering-animation').waitFor()
  const afterWater = await active(page)
  assert.deepEqual(afterWater.data.samples, beforeWater.data.samples)
  assert.equal(afterWater.simulation.growthHours, beforeWater.simulation.growthHours)
  assert.equal(afterWater.data.now_h, beforeWater.data.now_h)
  assert(afterWater.simulation.pendingWater > beforeWater.simulation.pendingWater)
  assert.equal(afterWater.logs.length, beforeWater.logs.length + 1)
  await page.screenshot({ path: '.tmp/ui-check/watering.png' })
  await page.getByText('Jurnal terbaru', { exact: true }).click()
  await page.getByRole('link', { name: 'Lihat seluruh log', exact: true }).click()
  await page.locator('.terminal-panel').waitFor()
  assert.equal(new URL(page.url()).hash, '#terminal')
  assert.equal(await page.locator('.analysis-toolbar, .device-panel, .session-comparison').count(), 0)
  await page.goBack()
  await page.locator('.plant-canvas').waitFor()
  assert.equal(await page.locator('.care-animation').count(), 0, 'Navigation must not replay an old care effect')


  await page.getByRole('button', { name: 'Pengaturan waktu & sampel', exact: true }).click()
  await page.getByRole('dialog', { name: 'Waktu & sampel', exact: true }).waitFor()
  await page.waitForFunction(() => document.documentElement.classList.contains('lenis-stopped'))
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.mouse.move(300, 400); await page.mouse.wheel(0, 600)
  // Wait for any pending Lenis frame; no arbitrary delay needed.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'Sheet must lock background scroll')
  await page.getByLabel('Interval pengingat pupuk').fill('9')
  await page.getByRole('button', { name: 'Selesai', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.textContent === 'Pengaturan waktu & sampel')
  assert.equal((await active(page)).simulation.feedEveryDays, 9)
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-stopped'))

  await page.getByRole('button', { name: 'Atur tanaman & skenario', exact: true }).click()
  await choose(page, 'Profil tanaman', 'Bawang merah')
  await page.getByRole('button', { name: 'Acuan lokal', exact: true }).click()
  await page.getByRole('dialog', { name: 'Acuan lokal pot P1', exact: true }).waitFor()
  await page.getByLabel('Nama media', { exact: true }).fill('Media uji antarmuka')
  await page.getByRole('button', { name: 'Terapkan acuan', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'plant-settings')
  assert.equal((await active(page)).data.profile.media, 'Media uji antarmuka')

  await page.getByRole('radio', { name: 'Perjalanan tanam', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio', { name: 'Eksperimen', exact: true }).isChecked(), true)
  assert.equal(await page.locator('.mode-bar .segment-selection').count(), 1)
  await page.getByRole('button', { name: 'Atur tanaman & skenario', exact: true }).click()
  await page.getByRole('combobox', { name: 'Skenario simulasi', exact: true }).click()
  const options = page.getByRole('option')
  await options.last().waitFor()
  assert.equal(await options.count(), 10)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Tanaman & skenario', exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1, 'Escape should close Select before Sheet')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.id === 'plant-settings')
  await page.getByRole('button', { name: 'Pengaturan waktu & sampel', exact: true }).click()
  await page.getByLabel('Manual', { exact: true }).check()
  await page.getByRole('button', { name: 'Selesai', exact: true }).click()
  await page.getByRole('button', { name: /Tambah sampel/ }).waitFor()
  const manualBefore = (await active(page)).data.now_h
  await page.getByRole('button', { name: /Tambah sampel/ }).click()
  assert.equal((await active(page)).data.now_h, manualBefore + .5)

  const saved = await active(page)
  await page.getByRole('button', { name: 'Berkas', exact: true }).click()
  assert.equal(await page.getByText('Lanjutkan sesi', { exact: false }).count(), 0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Ekspor sesi', exact: true }).click()
  await (await downloadPromise).saveAs('.tmp/ui-check/session.json')
  await page.getByLabel('Impor kasus JSON', { exact: true }).setInputFiles('.tmp/ui-check/session.json')
  assert.deepEqual((await active(page)).data, saved.data)
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('smart-agro.sessions.v1')).activeId !== id, saved.id)
  const imported = await active(page)
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  const dashboardSession = (await active(page)).data
  assert.equal(await page.locator('.dashboard-details').getAttribute('open'), null)
  assert.equal(await page.locator('.distribution-card').isVisible(), false, 'Secondary analysis starts collapsed')
  assert.equal(await page.locator('.dashboard-summary > .panel').count(), 3)
  assert.equal(await page.locator('.history-panel').count(), 1)
  await page.screenshot({ path: '.tmp/landing-dashboard-polish/dashboard-light.png', fullPage: true })
  await page.locator('.dashboard-details > summary').focus(); await page.keyboard.press('Space')
  await page.locator('.distribution-card').waitFor({ state: 'visible' })
  assert.deepEqual((await active(page)).data, dashboardSession, 'Opening statistics must not change samples')
  assert.equal(await page.locator('.analytics-metrics > .spotlight-card').count(), 4)
  await checkSpotlight(page, page.locator('.analytics-metrics > .spotlight-card').first())
  await choose(page, 'Parameter statistik', 'Suhu')
  const beforeFilter = await active(page)
  const ranges = page.getByRole('group', { name: 'Rentang statistik', exact: true })
  await ranges.getByRole('radio', { name: 'Semua', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await ranges.getByRole('radio', { name: '24 jam', exact: true }).isChecked(), true)
  // Native radio arrows select immediately; filtering never modifies the session.
  assert.deepEqual((await active(page)).data, beforeFilter.data)
  assert.equal(await page.locator('.device-panel, .session-comparison, .terminal-panel').count(), 0)
  await page.getByRole('link', { name: 'Bandingkan sesi', exact: true }).click()
  assert.equal(new URL(page.url()).hash, '#bandingkan')
  await page.getByRole('button', { name: 'Simpan salinan sesi aktif', exact: true }).click()
  await page.getByRole('combobox', { name: 'Sesi B', exact: true }).click()
  await page.getByRole('option').last().click()
  await page.getByRole('article', { name: 'Ringkasan sesi B' }).waitFor()
  assert.equal(await page.locator('.analysis-toolbar, .device-panel, .terminal-panel').count(), 0)
  await page.getByRole('link', { name: 'Status perangkat', exact: true }).click()
  await page.getByLabel('Impor paket perangkat', { exact: true }).setInputFiles({ name: 'packet.json', mimeType: 'application/json', buffer: await readFile('public/telemetry-example.json') })
  await page.locator('.device-statuses').waitFor()
  assert.deepEqual((await active(page)).data, imported.data, 'Device preview must remain separate from simulation')
  await page.reload()
  assert.equal(new URL(page.url()).hash, '#perangkat')
  await page.locator('.device-statuses').waitFor()
  await page.getByRole('link', { name: 'Terminal', exact: true }).click()
  await page.locator('.terminal-panel').waitFor()
  await page.reload()
  await page.locator('.terminal-panel').waitFor()
  await page.getByRole('tab', { name: 'Log sesi', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('[role=tab][data-state=active]')?.textContent === 'JSON')
  assert.equal(await page.locator('.tab-list .segment-selection').count(), 1)
  await page.locator('.terminal-panel pre').waitFor()
  await page.screenshot({ path: '.tmp/ui-check/terminal.png' })
  await page.goBack()
  await page.locator('.device-statuses').waitFor()
  await page.goForward()
  await page.locator('.terminal-panel').waitFor()
  await page.locator('.theme-toggle').click()
  await waitTheme(page, 'dark')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.screenshot({ path: '.tmp/landing-dashboard-polish/dashboard-dark.png', fullPage: true })
  await page.locator('.dashboard-details > summary').focus(); await page.keyboard.press('Enter')
  await checkSpotlight(page, page.locator('.analytics-metrics > .spotlight-card').first())
  await page.screenshot({ path: '.tmp/ui-check/dashboard-dark.png', fullPage: true })
  await page.reload()
  await waitTheme(page, 'dark')
  assert.equal((await active(page)).id, imported.id)
  assert.deepEqual((await active(page)).data, imported.data)

  // Missing API and interrupted snapshot both keep theme and controls usable.
  await page.evaluate(() => { document.startViewTransition = undefined })
  await page.locator('.theme-toggle').click()
  await waitTheme(page, 'light')
  await page.evaluate(() => { document.startViewTransition = update => { update(); return { ready: Promise.reject(new Error('snapshot interrupted')), finished: Promise.resolve() } } })
  await page.locator('.theme-toggle').click()
  await waitTheme(page, 'dark')
  assert.equal(await page.locator('html').getAttribute('data-theme-transition'), null)
  await page.close()

  for (const width of [320, 375, 414, 768]) {
    const mobile = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' })
    monitor(mobile)
    await mobile.addInitScript(() => { document.startViewTransition = () => { throw new Error('Reduced motion must bypass snapshots') } })
    await mobile.goto(url)
    await mobile.locator('.theme-toggle').click()
    await waitTheme(mobile, 'dark')
    await mobile.locator('.theme-toggle').click()
    await waitTheme(mobile, 'light')
    await mobile.getByRole('button', { name: 'Atur tanaman & skenario', exact: true }).click()
    await choose(mobile, 'Profil tanaman', 'Bawang merah')
    await mobile.getByRole('button', { name: 'Selesai', exact: true }).click()
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`)
    const mobilePlant = mobile.getByRole('button', { name: 'Tanam & mulai', exact: true })
    await mobilePlant.focus(); await mobile.keyboard.down('Space')
    assert.equal(await mobilePlant.evaluate(e => new DOMMatrixReadOnly(getComputedStyle(e).transform).a), 1)
    await mobile.keyboard.up('Space')
    await mobile.getByRole('button', { name: 'Jeda', exact: true }).click()
    assert.equal(await mobile.locator('.care-animation').evaluate(e => getComputedStyle(e).display), 'none')
    for (const [label, hash] of [['Dashboard', '#statistik'], ['Status perangkat', '#perangkat'], ['Terminal', '#terminal'], ['Bandingkan sesi', '#bandingkan']]) {
      if (!(await mobile.getByRole('navigation', { name: 'Navigasi utama' }).isVisible())) await mobile.getByRole('button', { name: 'Buka navigasi', exact: true }).click()
      await mobile.getByRole('link', { name: label, exact: true }).click()
      await mobile.getByRole('heading', { name: label, exact: true, level: 1 }).waitFor()
      assert.equal(new URL(mobile.url()).hash, hash)
      if (hash === '#statistik') {
        assert.equal(await mobile.locator('.dashboard-details').getAttribute('open'), null)
        await mobile.locator('.dashboard-details > summary').focus(); await mobile.keyboard.press('Enter')
        await mobile.locator('.histogram').waitFor({ state: 'visible' })
        await mobile.locator('.dashboard-details > summary').focus(); await mobile.keyboard.press('Enter')
        assert.equal(await mobile.locator('.dashboard-details').getAttribute('open'), null)
      }
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow on ${hash} at ${width}px`)
    }
    await mobile.screenshot({ path: `.tmp/ui-check/mobile-${width}.png`, fullPage: true })
    await mobile.close()
  }
  const enlarged = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  monitor(enlarged)
  await enlarged.goto(new URL('#statistik', url).href)
  await enlarged.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor()
  await enlarged.evaluate(() => document.fonts.ready)
  await enlarged.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  assert(await enlarged.locator('.sidebar-nav > a, .sidebar-nav > button').evaluateAll(links => links.every(link => {
    const bounds = link.getBoundingClientRect(), sidebar = document.querySelector('.app-sidebar').getBoundingClientRect()
    return bounds.left >= sidebar.left && bounds.right <= sidebar.right && link.scrollWidth <= link.clientWidth
  })), 'Enlarged navigation must remain inside sidebar')
  assert(await enlarged.locator('.dashboard-clock .button').evaluate(button => {
    const bounds = button.getBoundingClientRect(), card = button.closest('.dashboard-clock').getBoundingClientRect()
    return button.scrollWidth <= button.clientWidth && bounds.left >= card.left && bounds.right <= card.right
  }), 'Enlarged clock action must remain inside card')
  assert(await enlarged.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text must fit dashboard')
  await enlarged.close()
  await mkdir('.tmp/landing-story-upgrade', { recursive: true })
  const landingReport = []
  for (const width of [320, 375, 768, 820, 900, 1024, 1440]) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const landing = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
      monitor(landing)
      const landingUrl = new URL(url)
      landingUrl.hash = ''
      await landing.goto(landingUrl.href)
      await landing.locator(`.landing-story[data-reduced=${reducedMotion === 'reduce'}]`).waitFor()
      await landing.evaluate(() => document.fonts.ready)
      assert(await landing.evaluate(() => document.fonts.check('400 16px "Nunito Sans"')), 'Local product font must load')
      assert.match(await landing.locator('body').evaluate(e => getComputedStyle(e).fontFamily), /Nunito Sans/)
      assert.equal(await landing.locator('.landing-brand .agro-mark').count(), 1)
      assert.equal(await landing.getByRole('heading', { level: 1 }).count(), 1)
      const smooth = reducedMotion !== 'reduce'
      assert.equal(await landing.locator('html').evaluate(e => e.classList.contains('lenis')), smooth)
      const readingWords = (await landing.locator('.reading-reveal > .sr-only').innerText()).split(/\s+/).length
      assert.equal(Number(await landing.locator('.reading-reveal').getAttribute('data-revealed')), smooth ? 0 : readingWords)
      if (width === 1440 && smooth) {
        await landing.mouse.move(width - 10, 450)
        await landing.mouse.wheel(0, 360)
        const positions = await landing.evaluate(() => new Promise(resolve => {
          const values = []
          const sample = () => { values.push(scrollY); if (values.length < 18) requestAnimationFrame(sample); else resolve(values) }
          requestAnimationFrame(sample)
        }))
        assert(new Set(positions.map(Math.round)).size > 3, 'Lenis must interpolate wheel scrolling')
        assert(positions.at(-1) > positions[0] && positions.at(-1) <= 370, 'Wheel scroll must advance without duplicate distance')
        await landing.getByRole('link', { name: 'Smart Agro · Beranda', exact: true }).click()
        await landing.waitForFunction(() => scrollY < 1)
      }
      const flowerStage = landing.getByRole('region', { name: 'Pilihan bunga', exact: true })
      await flowerStage.focus(); await landing.keyboard.press('Shift')
      await landing.waitForFunction(() => document.querySelector('.flower-stage').dataset.playing === 'false')
      const savedBeforeFlowers = await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1'))
      if (reducedMotion === 'reduce') {
        assert.equal(await landing.locator('.flower-canvas canvas').count(), 0)
        assert.equal(await flowerStage.getAttribute('data-playing'), 'false')
      } else await landing.locator('.flower-canvas[data-state=ready]').waitFor()
      if (width > 800) {
        const positions = await landing.locator('.flower-tile').evaluateAll(tiles => tiles.map(tile => Math.round(tile.getBoundingClientRect().x)))
        assert.equal(new Set(positions).size, 5, `Flower tiles must remain distinct at ${width}px`)
      }
      if (width > 800) {
        const selectedTile = landing.locator('.flower-tile[aria-pressed=true]')
        await selectedTile.evaluate(tile => tile.focus())
        const bounds = await flowerStage.boundingBox()
        await landing.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * .4)
        assert.equal(await selectedTile.evaluate(tile => getComputedStyle(tile).visibility), 'hidden')
        assert.equal(await selectedTile.getAttribute('tabindex'), '-1')
      }
      if (width === 1440 && reducedMotion !== 'reduce') {
        await checkFlowerSeam(landing, 1)
        await checkFlowerSeam(landing, -1)
        const bounds = await flowerStage.boundingBox()
        await landing.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + 100)
        await landing.mouse.down()
        await landing.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100, { steps: 5 })
        await landing.mouse.up()
        await landing.locator('.flower-frame[data-flower=flower_ursinia]').waitFor()
        await landing.getByRole('button', { name: 'Pilih bunga Empodium', exact: true }).focus()
        await landing.keyboard.press('Space')
        await landing.locator('.flower-frame[data-flower=flower_empodium]').waitFor({ timeout: 3000 })
        await flowerStage.focus(); await landing.keyboard.press('Shift')
        await landing.keyboard.press('ArrowRight'); await landing.keyboard.press('ArrowRight')
        await landing.locator('.flower-frame[data-flower=flower_gazania]').waitFor()
        await flowerStage.focus(); await landing.keyboard.press('Shift')
      }
      assert(await landing.evaluate(() => {
        const range = document.createRange()
        range.selectNodeContents(document.querySelector('.flower-heading h1'))
        const title = range.getBoundingClientRect()
        return Array.from(document.querySelectorAll('.flower-carousel-controls button')).every(button => {
          const bounds = button.getBoundingClientRect()
          return bounds.right <= title.left || bounds.left >= title.right || bounds.bottom <= title.top || bounds.top >= title.bottom
        })
      }), 'Flower heading and arrow controls must not overlap')
      assert.equal(await landing.locator('.flower-header, .flower-autoplay, .flower-turn, .flower-story-cta, .flower-caption, .flower-beyond').count(), 0)
      const initialTone = await landing.locator('.flower-frame').evaluate(e => getComputedStyle(e).backgroundColor)
      await landing.keyboard.press('ArrowRight')
      await landing.locator('.flower-frame[data-flower=flower_ursinia]').waitFor()
      assert.equal(await landing.locator('.flower-frame').evaluate(e => getComputedStyle(e).backgroundColor), initialTone, 'Palette must stay consistent across flowers')
      await landing.keyboard.press('ArrowLeft')
      await landing.locator('.flower-frame[data-flower=flower_gazania]').waitFor()
      for (const [asset, name] of [['periwinkle_plant', 'Periwinkle'], ['flower_empodium', 'Empodium'], ['flower_heliophila', 'Heliophila'], ['flower_ursinia', 'Ursinia'], ['flower_gazania', 'Gazania']]) {
        const button = landing.getByRole('button', { name: `Pilih bunga ${name}`, exact: true, includeHidden: true })
        await button.evaluate(e => e.focus({ preventScroll: true }))
        await landing.keyboard.press('Space')
        await landing.locator(`.flower-frame[data-flower=${asset}]`).waitFor()
        assert.equal(await button.getAttribute('aria-pressed'), 'true')
        await landing.getByRole('img', { name: `Bunga ${name} dalam pot tanah liat`, exact: true }).waitFor()
        await landing.waitForFunction(assetName => Array.from(document.querySelectorAll('.flower-poster')).some(img => img.src.endsWith(`/${assetName}.webp`) && img.complete && img.naturalWidth > 0), asset)
        if (reducedMotion !== 'reduce') await landing.locator('.flower-canvas[data-state=ready]').waitFor()
      }
      assert.equal(await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), savedBeforeFlowers)
      if (width === 1440 && reducedMotion !== 'reduce') {
        await landing.getByRole('button', { name: 'Bunga berikutnya', exact: true }).click()
        assert.equal(await flowerStage.getAttribute('data-playing'), 'true', 'Pointer selection must keep autoplay running')
        await landing.locator('.flower-frame[data-flower=flower_ursinia]').waitFor()
        await landing.locator('.flower-frame[data-flower=flower_heliophila]').waitFor({ timeout: 6500 })
        await flowerStage.focus(); await landing.keyboard.press('Shift')
        assert.equal(await flowerStage.getAttribute('data-playing'), 'false')
        const pausedFlower = await landing.locator('.flower-frame').getAttribute('data-flower')
        await landing.waitForTimeout(4300)
        assert.equal(await landing.locator('.flower-frame').getAttribute('data-flower'), pausedFlower, 'Keyboard focus must pause autoplay')
        await landing.locator('.landing-brand').focus()
        assert.equal(await flowerStage.getAttribute('data-playing'), 'true', 'Leaving keyboard focus must resume autoplay')
        await landing.locator('.flower-frame[data-flower=flower_empodium]').waitFor({ timeout: 6500 })
      }

      assert.equal(await landing.locator('.landing-story-stage').isVisible(), width > 800 && smooth)
      assert.equal(await landing.locator('.landing-chapter').count(), 3)
      assert.equal(await landing.locator('.landing-experiment > .container-scroll #landing-result').count(), 1, 'Decision and observation belong to the same experiment surface')
      const scrollSurface = landing.locator('.landing-experiment > .container-scroll .container-scroll-surface')
      if (width > 800 && smooth) {
        await landing.evaluate(() => {
          const frame = document.querySelector('.landing-experiment > .container-scroll')
          scrollTo(0, frame.getBoundingClientRect().top + scrollY - innerHeight + 80)
        })
        await landing.waitForTimeout(200)
        const tilted = await scrollSurface.evaluate(e => new DOMMatrixReadOnly(getComputedStyle(e).transform).m23)
        assert(tilted > .1, 'Experiment must visibly tilt on entry')
        await scrollSurface.scrollIntoViewIfNeeded()
        await landing.waitForTimeout(200)
        assert(await scrollSurface.evaluate(e => Math.abs(new DOMMatrixReadOnly(getComputedStyle(e).transform).m23)) < Math.abs(tilted), 'Scroll must flatten the experiment surface')
      } else {
        assert.equal(await scrollSurface.evaluate(e => getComputedStyle(e).transform), 'none', 'Mobile and reduced motion keep readable static surfaces')
      }

      assert.equal(await landing.locator('.landing-trend').count(), 1, 'History chart must appear only in interactive experiment')
      await landing.locator('#story-step-1').scrollIntoViewIfNeeded()
      const moisture = landing.getByRole('button', { name: 'Kelembapan', exact: true })
      await moisture.focus(); await landing.keyboard.press('ArrowRight')
      assert.equal(await landing.getByRole('button', { name: 'Suhu', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.match(await landing.locator('#story-sensor-note').innerText(), /DS18B20/)
      await landing.keyboard.press('ArrowRight')
      assert.equal(await landing.getByRole('button', { name: 'pH', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.match(await landing.locator('#story-sensor-note').innerText(), /menahan aturan pH/)
      await landing.keyboard.press('ArrowRight')
      assert.equal(await moisture.getAttribute('aria-pressed'), 'true')
      await landing.waitForFunction(count => Number(document.querySelector('.reading-reveal').dataset.revealed) === count, readingWords)
      if (width > 800 && smooth) {
        await landing.waitForFunction(() => document.querySelector('.landing-story').dataset.active === '1')
        await landing.locator('.landing-story-stage .story-root-camera .plant-shell').waitFor({ state: 'attached' })
        await landing.waitForFunction(() => Number(getComputedStyle(document.querySelector('.landing-story-stage .story-root-camera .plant-shell')).opacity) < .01)
        assert.equal(await landing.locator('.story-steps a[aria-current=step] .story-step-active').count(), 1, 'Progress indicator must follow the actual visible chapter')
        assert.match(await landing.locator('.landing-story-stage .story-probe-label').innerText(), /Kapasitif V1.2/)
        const frameBeforePola = await landing.locator('.story-media').evaluate(e => ({ height: e.offsetHeight, background: getComputedStyle(e).backgroundImage }))
        await landing.getByRole('link', { name: /03.*Pola/ }).click()
        await landing.waitForFunction(() => document.activeElement?.id === 'story-step-2' && document.querySelector('.landing-story').dataset.active === '2')
        await landing.locator('.landing-story-stage .story-reasoning').waitFor()
        assert.deepEqual(await landing.locator('.story-media').evaluate(e => ({ height: e.offsetHeight, background: getComputedStyle(e).backgroundImage })), frameBeforePola, 'Pola must keep the same frame height and gradient as the root scene')
        const reasoningFits = await landing.locator('.story-media').evaluate(e => {
          const frame = e.getBoundingClientRect(), content = e.querySelector('.story-reasoning').getBoundingClientRect()
          return frame.left >= 0 && frame.right <= innerWidth && content.top >= frame.top && content.bottom <= frame.bottom &&
            content.left >= frame.left && content.right <= frame.right
        })
        assert(reasoningFits, `Pola content must remain inside its frame at ${width}px`)
        await landing.locator('.story-next').click()
        await landing.waitForFunction(() => document.activeElement?.id === 'eksperimen')
      }
      assert(await landing.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Landing overflow at ${width}px`)
      const saved = await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1'))
      const wet = landing.getByRole('button', { name: 'Basah menetap', exact: true })
      await wet.focus(); await landing.keyboard.press('Space')
      assert.equal(await wet.getAttribute('aria-pressed'), 'true')
      assert.match(await landing.locator('#landing-result').innerText(), /Periksa media, lubang pot dan genangan tatakan/)
      assert.match(await landing.locator('#landing-experiment-data .landing-trend svg').getAttribute('aria-label'), /95 ke 95 selama 3 jam/)
      const dry = landing.getByRole('button', { name: 'Cepat mengering', exact: true })
      await dry.focus(); await landing.keyboard.press('Enter')
      assert.equal(await dry.getAttribute('aria-pressed'), 'true')
      assert.equal(await wet.getAttribute('aria-pressed'), 'false')
      assert.match(await landing.locator('#landing-result').innerText(), /Jadwalkan pemeriksaan sebelum kunjungan berikutnya/)
      assert.match(await landing.locator('#landing-experiment-data .landing-trend svg').getAttribute('aria-label'), /85 ke 55 selama 2,5 jam/)
      assert.equal(await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), saved)
      await checkSpotlight(landing, landing.locator('#landing-experiment-data'), !smooth)
      for (const button of [wet, dry]) assert((await button.boundingBox()).height >= 44)
      const tabBounds = await landing.locator('.landing-tabs').evaluateAll(groups => groups.map(group => {
        const bounds = group.getBoundingClientRect()
        return { label: group.getAttribute('aria-label'), left: bounds.left, right: bounds.right, viewport: innerWidth, clientWidth: group.clientWidth,
          buttons: Array.from(group.querySelectorAll('button')).map(button => ({ label: button.textContent, left: button.offsetLeft, width: button.offsetWidth })) }
      }))
      assert(tabBounds.every(group => group.left >= 0 && group.right <= group.viewport && group.buttons.every(button => button.left + button.width <= group.clientWidth)),
        `Animated tabs must fit viewport and contain every button at ${width}px/${reducedMotion}: ${JSON.stringify(tabBounds)}`)
      const beforeFaq = await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1'))
      const faq = landing.getByRole('group', { name: 'Sebelum mencoba simulator', exact: true })
      assert.equal(await faq.locator('details').count(), 3)
      assert.equal(await faq.locator('details[open]').count(), 0)
      await faq.locator('summary').nth(0).focus(); await landing.keyboard.press('Enter')
      assert.equal(await faq.locator('details[open]').count(), 1)
      await landing.waitForFunction(() => document.querySelector('.landing-faq details[open] p')?.innerText.length > 0)
      assert.match(await faq.locator('details[open] p').innerText(), /tanpa pembacaan perangkat nyata/)
      await faq.locator('summary').nth(1).focus(); await landing.keyboard.press('Space')
      assert.equal(await faq.locator('details[open]').count(), 1, 'FAQ opens one answer at a time')
      await landing.waitForFunction(() => document.querySelector('.landing-faq details[open] p')?.innerText.length > 0)
      assert.match(await faq.locator('details[open] p').innerText(), /Cabai dan bawang/)
      await faq.locator('summary').nth(2).focus(); await landing.keyboard.press('Enter')
      await landing.waitForFunction(() => document.querySelector('.landing-faq details[open] p')?.innerText.length > 0)
      assert.match(await faq.locator('details[open] p').innerText(), /belum divalidasi secara agronomi/)
      await landing.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'))
      assert(await faq.evaluate(e => {
        const bounds = e.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && e.scrollWidth <= e.clientWidth
      }), `FAQ must fit at ${width}px`)
      assert.equal(await landing.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), beforeFaq)
      await landing.locator('.landing-cta').click()
      await landing.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor()
      assert.equal(new URL(landing.url()).hash, '#simulasi')
      await landing.getByRole('link', { name: 'Smart Agro · Beranda', exact: true }).click()
      await landing.getByRole('heading', { name: /Kenali potmu/ }).waitFor()
      await landing.locator('.flower-frame[data-flower=flower_gazania]').waitFor()
      assert.equal(await landing.locator('html').evaluate(e => e.classList.contains('lenis')), smooth, 'Landing must reinitialize scroll after simulator return')
      assert.equal(await landing.locator('html').evaluate(e => e.classList.contains('lenis-stopped')), false)
      await landing.getByRole('region', { name: 'Pilihan bunga', exact: true }).focus(); await landing.keyboard.press('Shift')
      if (reducedMotion !== 'reduce') await landing.locator('.flower-canvas[data-state=ready]').waitFor()
      if ([320, 768, 1440].includes(width)) {
        await landing.waitForFunction(() => getComputedStyle(document.querySelector('.flower-model')).opacity === '1')
        await landing.screenshot({ path: `.tmp/landing-story-upgrade/chrome-${width}-${reducedMotion}.png` })
      }
      await landing.goto(new URL('#story-step-1', landingUrl).href)
      await landing.waitForFunction(() => document.activeElement?.id === 'story-step-1' && Math.abs(document.querySelector('#story-step-1').getBoundingClientRect().top) < 2)
      landingReport.push({ width, reducedMotion, flowers: 'pass', webgl: reducedMotion === 'reduce' ? 'static' : 'ready', scenarios: 'pass', lenis: smooth ? 'smooth' : 'native', story: 'three scenes', directStoryLink: 'pass', containerScroll: width > 800 && smooth ? 'tilt flattens' : 'static', sensorTabs: 'pass', readingReveal: 'pass', spotlight: smooth ? 'native hover' : 'disabled', keyboard: 'pass', overflow: 'pass', simulatorRoute: 'pass' })
      await landing.close()
    }
  }
  await writeFile('.tmp/landing-story-upgrade/browser-report.json', JSON.stringify(landingReport, null, 2))
  assert.deepEqual(errors, [])
  console.log('Landing OK: 14 viewport/motion combinations, five flowers, distinct arc positions, keyboard after swipe, WebGL/static posters, continuous autoplay after manual selection, keyboard pause/resume, edge wrap, real decisions, keyboard, no session writes, Lenis wheel interpolation/reinitialization, three scroll scenes, sensor tabs, reading reveal, smooth anchors, popular Spotlight Card without hover movement/touch lock, simulator route. UI OK: theme origin/radius, both directions, icons, persistence, fallback, clock, focus, nested Select, scroll lock, dedicated routes/back/refresh, care effects, mascot, import/export, charts, solid surfaces, segmented keyboard controls, tactile buttons, 320/375/414/768px, reduced motion.')
} finally {
  await browser.close()
}
