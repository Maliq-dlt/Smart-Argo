import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createJourney, plantSeed, advanceSimulation, waterSimulation, recordFertilizer } from '../src/lib/simulation.ts'
import { createSession, STORAGE_KEY } from '../src/lib/sessionStore.ts'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = new URL('#statistik', process.env.TEST_URL || 'http://127.0.0.1:4174/').href
const output = '.tmp/dashboard-assistance'
await mkdir(output, { recursive: true })
const scenarios = JSON.parse(await readFile('src/lib/scenarios.json', 'utf8'))
let session = plantSeed(createJourney(scenarios[0]))
session = advanceSimulation(session, 12)
session = recordFertilizer(waterSimulation(session, 150))
session = advanceSimulation(session, 16)
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = [], report = []
const active = page => page.evaluate(key => {
  const book = JSON.parse(localStorage.getItem(key))
  return book.sessions.find(session => session.id === book.activeId)
}, STORAGE_KEY)
const setup = async (width, theme, reducedMotion, seed = session) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ key, seed, theme }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, activeId: seed.id, sessions: [seed] }))
    localStorage.setItem('smart-agro.theme', theme)
  }, { key: STORAGE_KEY, seed, theme })
  await page.goto(url)
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
    await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'))
    assert(await page.locator('.simulation-controls').evaluate(card => card.getBoundingClientRect().top < innerHeight))
    assert.deepEqual((await active(page)).data, before.data)
    report.push({ width, theme, careGrouping: 'pass', keyboard: 'pass', dataPreserved: 'pass', directCareFocus: 'pass', overflow: false })
    await page.close()
  }
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
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
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