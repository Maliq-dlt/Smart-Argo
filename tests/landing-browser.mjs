import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const output = '.tmp/landing-agritech'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = [], report = []
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
const scrollTrack = async (page, fraction) => {
  await page.evaluate(f => { const t = document.querySelector('.sa-story-track'); scrollTo(0, t.getBoundingClientRect().top + scrollY + (t.offsetHeight - innerHeight) * f) }, fraction)
  await page.waitForTimeout(900)
}
try {
  for (const [width, height, reducedMotion] of [[1440, 900, 'no-preference'], [1024, 768, 'no-preference'], [390, 844, 'no-preference'], [320, 740, 'no-preference'], [1440, 900, 'reduce'], [390, 844, 'reduce']]) {
    console.log(`Checking ${width}x${height}, ${reducedMotion}`)
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion })
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(url)
    await page.getByRole('heading', { level: 1, name: 'Tahu kapan pot perlu air.' }).waitFor()
    assert(await fits(page), `First screen overflow at ${width}`)
    await page.locator('.sa-hero .ag-simulator-link').waitFor({ state: 'visible', timeout: 4000 })

    // Hero: simulated telemetry moves, and the plant picker swaps profile.
    const moisture = page.locator('.sa-c-moist strong .sa-roll')
    if (reducedMotion === 'no-preference') {
      const first = await moisture.innerText()
      await page.waitForTimeout(2200)
      assert.notEqual(await moisture.innerText(), first, 'Hero readings advance')
    } else assert.equal(await moisture.innerText(), '55', 'Reduced motion shows the final reading')
    const plantSwitch = page.locator('.sa-switch')
    await plantSwitch.getByRole('radio', { name: 'Bawang merah' }).click()
    assert.equal(await plantSwitch.getByRole('radio', { name: 'Bawang merah' }).getAttribute('aria-checked'), 'true')
    assert.match(await page.locator('.sa-stage').getAttribute('aria-label'), /^Bawang merah/, 'Stage describes the chosen plant')
    await plantSwitch.getByRole('radio', { name: 'Cabai' }).click()
    await plantSwitch.getByRole('radio', { name: 'Cabai' }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await plantSwitch.getByRole('radio', { name: 'Bawang merah' }).getAttribute('aria-checked'), 'true', 'Arrow keys move the switch')
    assert.equal(await page.locator('.sa-word, .sa-hero-side, .sa-specs').count(), 0, 'Hero stays uncluttered')

    // Theme: the landing follows the same toggle and storage key as the simulator.
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
    const before = await theme()
    await page.locator('.sa-nav .theme-toggle').click()
    await page.waitForFunction(previous => document.documentElement.dataset.theme !== previous, before)
    assert.equal(await page.evaluate(() => localStorage.getItem('smart-agro.theme')), await theme())
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.sa')).backgroundColor)
    assert.equal(bg, (await theme()) === 'dark' ? 'rgb(22, 29, 25)' : 'rgb(236, 239, 231)', 'Landing palette follows the theme')
    await page.locator('.sa-nav .theme-toggle').click()
    await page.waitForFunction(previous => document.documentElement.dataset.theme === previous, before)
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/hero-${width}-${reducedMotion}.png` })

    // Pinned story: phases and readings follow the scroll, forwards and back.
    for (const [fraction, title, value] of [[.05, 'Pasang probe di zona akar.', '85'], [.45, 'Baca setiap 30 menit.', null], [.7, 'Hitung ke depan.', '55'], [.97, 'Saran, dengan alasan.', '55'], [.05, 'Pasang probe di zona akar.', '85']]) {
      await scrollTrack(page, fraction)
      assert.equal(await page.locator('.sa-phases li.is-active h3').innerText(), title, `Phase at ${fraction}`)
      if (value) assert.equal((await page.locator('.sa-card-reading strong').textContent()).replace(/\D.*$/s, ''), value, `Reading at ${fraction}`)
    }
    await scrollTrack(page, .97)
    assert.match(await page.locator('.sa-card-decision strong').textContent(), /Jadwalkan pemeriksaan/)
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/story-${width}-${reducedMotion}.png` })

    // Lab: the real engine's verdict for each scenario.
    await page.locator('#lab').scrollIntoViewIfNeeded()
    const verdict = page.locator('.sa-lab-verdict strong')
    await verdict.waitFor({ timeout: 8000 })
    assert.match(await verdict.innerText(), /Jadwalkan pemeriksaan/)
    await page.getByRole('radio', { name: /Bawang merah\s*Cepat mengering/ }).click()
    await page.waitForFunction(() => /Lanjutkan pengamatan/.test(document.querySelector('.sa-lab-verdict strong')?.textContent ?? ''), null, { timeout: 8000 })
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => /Periksa media/.test(document.querySelector('.sa-lab-verdict strong')?.textContent ?? ''), null, { timeout: 8000 })
    assert(await fits(page), `Lab overflow at ${width}`)

    // Bento chart responds to the pointer; FAQ opens.
    if (width >= 760) {
      const chart = page.locator('.sa-tile-svg')
      await chart.scrollIntoViewIfNeeded()
      const box = await chart.boundingBox()
      await page.mouse.move(box.x + box.width * .06, box.y + box.height / 2)
      assert.equal(await page.locator('.sa-tile-chart .sa-tile-big span').innerText(), '85', 'Chart scrub reads the first sample')
    }
    const question = page.locator('.sa-faq summary', { hasText: 'Apakah Smart Agro menyiram sendiri?' })
    await question.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200)
    await question.click()
    await page.getByText('Belum ada kendali pompa atau katup', { exact: false }).waitFor({ state: 'visible', timeout: 3000 })
    assert(await fits(page), `Page overflow at ${width}`)

    assert.equal(await page.evaluate(() => localStorage.getItem('smart-agro.sessions.v1')), null, 'Landing does not write simulator sessions')
    await page.evaluate(() => scrollTo(0, 0))
    await page.locator('.sa-hero .ag-simulator-link').click()
    await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor()
    assert.equal(await page.locator('.sa-hero').count(), 0, 'Landing is removed on the simulator route')
    await page.goBack()
    await page.getByRole('heading', { level: 1, name: 'Tahu kapan pot perlu air.' }).waitFor()
    assert(await fits(page), 'Return route has no overflow')
    report.push({ width, height, reducedMotion, hero: 'pass', story: 'pass', lab: 'pass', bento: width >= 760 ? 'pass' : 'skipped (no pointer)', faq: 'pass', simulatorRoute: 'pass', overflow: 'pass' })
    await page.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/browser-results.json`, JSON.stringify({ report, errors }, null, 2))
  console.log(JSON.stringify({ cases: report.length, errors, checks: 'title and action, live hero readings, plant switch (click and keys), uncluttered hero, theme toggle and palette, pinned story phases forwards and back, lab verdicts per scenario, chart scrub, FAQ, no session writes, simulator route and return, reduced motion, overflow' }, null, 2))
} finally { await browser.close() }
