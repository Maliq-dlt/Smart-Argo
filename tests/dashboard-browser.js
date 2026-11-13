import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'
import { createJourney, plantSeed, advanceSimulation, waterSimulation, recordFertilizer } from '../src/lib/simulation.ts'
import { createSession, STORAGE_KEY } from '../src/lib/sessionStore.ts'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
// The site curtain (loading screen) covers the first paint; interact only once it has lifted, like a visitor would.
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const url = new URL('#statistik', process.env.TEST_URL || 'http://127.0.0.1:4174/').href
const output = '.tmp/dashboard-assistance'
await mkdir(output, { recursive: true })
const scenarios = JSON.parse(await readFile('src/lib/scenarios.json', 'utf8'))
let session = plantSeed(createJourney(scenarios[0]))
session = advanceSimulation(session, 12)
session = recordFertilizer(waterSimulation(session, 150))
session = advanceSimulation(session, 16)
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser) // account entry is covered by the account checks
const errors = [], report = []
const active = page => page.evaluate(key => {
  const book = JSON.parse(localStorage.getItem(key))
  return book.sessions.find(session => session.id === book.activeId)
}, STORAGE_KEY)
// Chrome can leave parts of the tree on the old rem after an injected root font-size; force one full restyle, as a browser setting change does.
const enlargeText = async page => {
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  await page.evaluate(() => { document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '' })
}
const setup = async (width, theme, reducedMotion, seed = session) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ key, seed, theme }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, activeId: seed.id, sessions: [seed] }))
    localStorage.setItem('smart-agro.theme', theme)
  }, { key: STORAGE_KEY, seed, theme })
  await page.goto(url); await curtainOpen(page)
  await page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }).waitFor()
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-site-transition'))
  return page
}
try {
  for (const width of [1440, 1024, 768, 375, 320]) for (const theme of ['light', 'dark']) {
    const page = await setup(width, theme, width === 320 ? 'reduce' : 'no-preference')
    const before = await active(page)
    assert.equal(await page.locator('.history-panel').count(), 1)
    assert.equal(await page.locator('.chart-details[open], .dashboard-details[open]').count(), 0)
    assert.equal(await page.locator('.chart-care-marker').count(), 2, 'Same-time water/feed share one marker')
    const marker = page.locator('.chart-care-marker').last()
    await marker.focus(); await page.keyboard.press('Enter')
    assert.notEqual(await page.locator('.care-details').getAttribute('open'), null)
    await page.waitForFunction(() => document.querySelector('.care-timeline li[data-selected=true]')?.innerText.includes('Siram'))
    assert.match(await page.locator('.care-timeline li[data-selected=true]').innerText(), /Siram 150 mL.*Pupuk dicatat/s)
    assert.match(await page.locator('.care-timeline li[data-selected=true]').innerText(), /tidak ada deteksi unsur hara/)
    assert(await marker.locator('svg').evaluate(icon => getComputedStyle(icon).width === '16px'))
    await page.locator('.chart-point').nth(3).focus(); await page.keyboard.press('Space')
    assert.notEqual(await page.locator('.chart-details').first().getAttribute('open'), null)
    await page.getByRole('combobox', { name: 'Parameter statistik', exact: true }).click()
    await page.getByRole('option', { name: 'Suhu', exact: true }).click()
    assert.match(await page.locator('.point-detail strong').innerText(), /Suhu/)
    await page.locator('.care-details > summary').focus(); await page.keyboard.press('Space')
    await page.locator('.chart-details').first().locator('summary').focus(); await page.keyboard.press('Enter')
    assert.equal(await page.locator('.chart-details[open]').count(), 0)
    assert.deepEqual((await active(page)).data, before.data, 'Reading chart does not change readings')
    assert.deepEqual((await active(page)).logs, before.logs, 'Reading chart does not add care records')
    await page.locator('.point-detail').waitFor({ state: 'hidden' })
    await page.locator('.care-timeline').waitFor({ state: 'hidden' })
    await page.locator('.toast.visible').waitFor({ state: 'hidden' })
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${output}/dashboard-${width}-${theme}.png`, fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow ${width}/${theme}`)
    assert(await page.locator('.dashboard-clock').evaluate(card => card.offsetHeight < 260), 'Clock remains secondary and compact')
    await page.getByRole('link', { name: 'Buka perawatan', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor()
    await page.waitForFunction(() => document.activeElement?.classList.contains('simulation-controls'))
    await page.waitForFunction(() => document.querySelector('.simulation-controls').getBoundingClientRect().top < innerHeight)
    assert(await page.locator('.simulation-controls').evaluate(card => card.getBoundingClientRect().top < innerHeight))
    assert.deepEqual((await active(page)).data, before.data)
    report.push({ width, theme, careGrouping: 'pass', keyboard: 'pass', dataPreserved: 'pass', directCareFocus: 'pass', overflow: false })
    await page.close()
  }
  const metricSeed = [48, 48, 4].reduce((current, steps) => advanceSimulation(current, steps), session)
  metricSeed.data.samples.at(-4).valid = false
  const metricsPage = await setup(1024, 'light', 'reduce', metricSeed)
  const metricBefore = await active(metricsPage)
  await metricsPage.locator('.dashboard-details > summary').click()
  await metricsPage.locator('.metric-sparkline').waitFor({ state: 'visible' })
  for (const hours of [0, 24]) {
    await metricsPage.getByRole('group', { name: 'Rentang statistik', exact: true }).getByRole('radio', { name: hours ? '24 jam' : 'Semua', exact: true }).check()
    for (const [key, label] of [['moisture', 'Kelembapan'], ['temp_c', 'Suhu'], ['ph', 'pH']]) {
      await metricsPage.getByRole('combobox', { name: 'Parameter statistik', exact: true }).click()
      await metricsPage.getByRole('option', { name: label, exact: true }).click()
      const rows = metricBefore.data.samples.filter(row => !hours || row.t_h >= metricBefore.data.now_h - hours)
      const measured = rows.filter(row => row.valid && row[key] !== null)
      const card = metricsPage.locator('.metric-featured')
      const chartValues = rows.slice(-120).filter(row => row.valid && row[key] !== null)
      const plotted = await card.locator('.metric-sparkline polyline').evaluateAll(lines => lines.reduce((count, line) => count + line.getAttribute('points').trim().split(/\s+/).length, 0))
      assert.equal(plotted, chartValues.length, 'Mini chart excludes failed/unmeasured readings and stays bounded')
      const mean = measured.reduce((total, row) => total + row[key], 0) / measured.length
      assert.match(await card.locator(':scope > strong').innerText(), new RegExp(mean.toLocaleString('id-ID', { maximumFractionDigits: 1 }).replace('.', '\\.')))
      assert.match(await card.locator('.metric-sparkline svg').getAttribute('aria-label'), new RegExp(label))
      assert.match(await card.locator('figcaption').innerText(), hours ? /24 jam terakhir/ : /120 sampel terakhir/)
      assert.deepEqual((await active(metricsPage)).data, metricBefore.data, 'Statistics filters never change the session')
    }
  }
  await metricsPage.locator('.analytics-metrics').screenshot({ path: '.tmp/21st-map-integration/metric-cards-light.png' })
  await metricsPage.close()
  const noPhSeed = structuredClone(metricSeed)
  noPhSeed.data.samples.forEach(row => { row.ph = null })
  const noPhPage = await setup(390, 'dark', 'reduce', noPhSeed)
  await noPhPage.locator('.dashboard-details > summary').click()
  await noPhPage.getByRole('combobox', { name: 'Parameter statistik', exact: true }).click()
  await noPhPage.getByRole('option', { name: 'pH', exact: true }).click()
  await noPhPage.locator('.metric-empty').waitFor({ state: 'visible' })
  assert.equal(await noPhPage.locator('.metric-sparkline').count(), 0, 'Unmeasured pH never becomes a zero-valued chart')
  assert.match(await noPhPage.locator('.metric-featured > strong').innerText(), /—/)
  await noPhPage.close()
  for (const seed of [createJourney(scenarios[0]), createSession(scenarios[0], 'Eksperimen manual')]) {
    const page = await setup(375, 'light', 'reduce', seed)
    const before = await active(page)
    await page.locator('.dashboard-care > a').click()
    const expected = seed.simulation ? 'simulation-controls' : 'controls-panel'
    await page.waitForFunction(expected => document.activeElement?.classList.contains(expected), expected)
    assert.deepEqual((await active(page)).data, before.data, 'Shortcut never plants, waters or advances automatically')
    await page.close()
  }
  for (const width of [1440, 375, 320]) {
    const page = await setup(width, 'light', 'reduce')
    await enlargeText(page)
    const overflowing = await page.evaluate(() => [...document.querySelectorAll('#main button, #main a.button')].filter(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.left < -1 || bounds.right > innerWidth + 1
    }).map(element => element.textContent))
    assert.deepEqual(overflowing, [], `Every action fits at 200% text/${width}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `200% text fits at ${width}`)
    await page.screenshot({ path: `${output}/text-200-${width}.png`, fullPage: true })
    await page.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/browser-report.json`, JSON.stringify({ report, unplantedAndManual: 'pass', text200: 'pass', errors }, null, 2))
  console.log('Dashboard OK: 10 viewport/theme combinations, grouped real care markers, keyboard disclosure, data preserved, care focus for journey/unplanted/manual, compact clock, reduced motion, 200% text, no page errors.')
} finally { await browser.close() }