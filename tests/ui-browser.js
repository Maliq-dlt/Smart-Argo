import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

// PLAYWRIGHT_MODULE may point to an existing Playwright installation; no browser download.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.TEST_URL || 'http://127.0.0.1:4173/'
await mkdir('.tmp/ui-check', { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
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
  await page.getByRole('button', { name: 'Tanam & mulai', exact: true }).click()
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
  await page.getByRole('button', { name: 'Jeda', exact: true }).click()
  assert((await active(page)).data.now_h > before, 'Theme animation must not starve simulation time')

  await page.getByRole('button', { name: 'Pengaturan waktu & sampel', exact: true }).click()
  await page.getByRole('dialog', { name: 'Waktu & sampel', exact: true }).waitFor()
  const scrollBefore = await page.evaluate(() => scrollY)
  await page.mouse.move(300, 400); await page.mouse.wheel(0, 600)
  // Wait for any pending Lenis frame; no arbitrary delay needed.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => scrollY), scrollBefore, 'Sheet must lock background scroll')
  await page.getByLabel('Interval pengingat pupuk').fill('9')
  await page.getByRole('button', { name: 'Selesai', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.textContent === 'Pengaturan waktu & sampel')
  assert.equal((await active(page)).simulation.feedEveryDays, 9)

  await page.getByRole('button', { name: 'Atur tanaman & skenario', exact: true }).click()
  await choose(page, 'Profil tanaman', 'Bawang merah')
  await page.getByRole('button', { name: 'Acuan lokal', exact: true }).click()
  await page.getByRole('dialog', { name: 'Acuan lokal pot P1', exact: true }).waitFor()
  await page.getByLabel('Nama media', { exact: true }).fill('Media uji antarmuka')
  await page.getByRole('button', { name: 'Terapkan acuan', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'plant-settings')
  assert.equal((await active(page)).data.profile.media, 'Media uji antarmuka')

  await page.getByRole('button', { name: 'Eksperimen', exact: true }).click()
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

  await page.getByRole('button', { name: 'Sesi', exact: true }).click()
  await page.getByRole('button', { name: /Lanjutkan sesi \(/ }).click()
  await page.getByRole('dialog', { name: 'Lanjutkan sesi', exact: true }).waitFor()
  assert(await page.locator('.session-card').count() >= 3)
  await page.locator('.rename-session').first().click()
  await page.locator('.session-rename input').fill('Percobaan tersimpan')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.screenshot({ path: '.tmp/ui-check/sessions.png' })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.classList.contains('session-switcher'))
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await choose(page, 'Parameter statistik', 'Suhu')
  await choose(page, 'Rentang statistik', '24 jam terakhir')
  await page.getByRole('button', { name: 'Bandingkan sesi', exact: true }).click()
  await page.getByRole('button', { name: 'Simpan salinan sesi aktif', exact: true }).click()
  await page.getByRole('combobox', { name: 'Sesi B', exact: true }).click()
  await page.getByRole('option').last().click()
  await page.getByRole('article', { name: 'Ringkasan sesi B' }).waitFor()
  await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await page.locator('.terminal-panel').waitFor()
  await page.locator('.theme-toggle').click()
  await waitTheme(page, 'dark')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.screenshot({ path: '.tmp/ui-check/dashboard-dark.png', fullPage: true })
  await page.reload()
  await waitTheme(page, 'dark')
  assert.equal((await active(page)).name, 'Percobaan tersimpan')

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
    await mobile.screenshot({ path: `.tmp/ui-check/mobile-${width}.png`, fullPage: true })
    await mobile.close()
  }
  assert.deepEqual(errors, [])
  console.log('UI OK: theme origin/radius, both directions, icons, persistence, fallback, clock, focus, nested Select, scroll lock, sessions, charts, 320/375/414/768px, reduced motion.')
} finally {
  await browser.close()
}
