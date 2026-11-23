// The pot stage (Fase 2): readable at every width, driven only by the app's state, calm under reduced motion, and never moved
// by the pointer. Serve the build with `npx vite preview --port 4174 --host 127.0.0.1` (default TEST_URL).
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'
import { advanceSimulation, createJourney, plantSeed, waterSimulation } from '../src/lib/simulation.ts'
import { STORAGE_KEY } from '../src/lib/sessionStore.ts'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/'
const output = '.tmp/plant-scene'
await mkdir(output, { recursive: true })
const scenarios = JSON.parse(await readFile('src/lib/scenarios.json', 'utf8'))
// One step is one half-hour sample and a call takes at most 48.
const advance = (session, hours) => { for (let steps = hours * 2; steps > 0; steps -= 48) session = advanceSimulation(session, Math.min(48, steps)); return session }
// Water twice a day so the media stays moist and the plant keeps growing (an unwatered one stays a seedling).
const tend = (session, days) => { for (let half = 0; half < days * 2; half++) session = advance(waterSimulation(session, 150), 12); return session }
const cabai = advance(plantSeed(createJourney(scenarios[0])), 24 * 25)
const leafy = tend(plantSeed(createJourney(scenarios[0])), 40)
const bawang = advance(plantSeed(createJourney(scenarios[7])), 24 * 20)
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
asGuest(browser)
const errors = []
let checks = 0
const ok = (value, message) => { assert(value, message); checks++ }

const open = async (hash, { width = 1440, theme = 'light', reducedMotion = 'no-preference', seed, text = false } = {}) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion })
  page.on('pageerror', error => errors.push(error.message))
  // The sign-in settings request goes to the local backend, which may be off or answer without CORS headers; that is the network, not the stage.
  page.on('console', message => { if (message.type() === 'error' && !/ERR_CONNECTION_REFUSED|ERR_FAILED|127\.0\.0\.1:54321/.test(message.text())) errors.push(message.text()) })
  await page.addInitScript(({ key, seed, theme }) => {
    if (seed) localStorage.setItem(key, JSON.stringify({ version: 1, activeId: seed.id, sessions: [seed] }))
    localStorage.setItem('smart-agro.theme', theme)
    window.__svgListeners = []
    // Pending animation frames, to prove a stage that unmounts also stops its loop.
    window.__raf = new Set()
    const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => { const id = raf(time => { window.__raf.delete(id); callback(time) }); window.__raf.add(id); return id }
    window.cancelAnimationFrame = id => { window.__raf.delete(id); caf(id) }
    const add = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (this instanceof SVGElement && /^(pointer|mouse|touch|click|wheel)/.test(type)) window.__svgListeners.push([this, type])
      return add.call(this, type, ...rest)
    }
  }, { key: STORAGE_KEY, seed, theme })
  await page.goto(new URL(hash, base).href); await curtainOpen(page)
  await page.locator('.plant-scene svg').waitFor()
  if (text) {
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
    await page.evaluate(() => { document.body.style.display = 'none'; void document.body.offsetHeight; document.body.style.display = '' })
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page
}
const luminance = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return .2126 * r + .7152 * g + .0722 * b }

try {
  // Readable at every width and in both themes, with every reading inside the picture.
  for (const width of [1440, 768, 390, 320]) for (const theme of ['light', 'dark']) {
    const page = await open('#tanaman', { width, theme, seed: cabai })
    const frame = await page.locator('.plant-scene').boundingBox()
    ok(frame && frame.width > 0 && frame.height > frame.width * .5, `The stage has a size at ${width}px`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px ${theme}`)
    ok(await page.locator('.plant-scene svg *').count() > 120, 'The pot is drawn')
    const texts = await page.locator('.plant-scene .rv').allTextContents()
    ok(texts.length === 3 && texts.every(t => t.trim().length > 0), `Three readings are written: ${texts}`)
    ok(texts.some(t => /\/100/.test(t)), 'Moisture is on the 0-100 index')
    for (const handle of await page.locator('.plant-scene .rl, .plant-scene .rv').elementHandles()) {
      const box = await handle.boundingBox()
      ok(box && box.x >= frame.x - 1 && box.x + box.width <= frame.x + frame.width + 1, `A reading is cut off at ${width}px ${theme}: ${await handle.textContent()}`)
    }
    ok((await page.locator('.plant-scene svg').getAttribute('aria-label') ?? '').includes('Kelembapan'), 'The picture is described for screen readers')
    await page.locator('.plant-scene').screenshot({ path: `${output}/cabai-${width}-${theme}.png` })
    await page.close()
  }

  // The second species, and growth: a plant 25 days in draws more than a seed.
  const onion = await open('#tanaman', { seed: bawang })
  ok(await onion.locator('.plant-scene .rv').count() === 3, 'Bawang merah renders its readings')
  await onion.locator('.plant-scene').screenshot({ path: `${output}/bawang-1440-light.png` })
  await onion.close()
  const seedOnly = await open('#tanaman', { seed: plantSeed(createJourney(scenarios[0])) })
  const young = await seedOnly.locator('.plant-scene svg *').evaluateAll(all => all.filter(e => e.getAttribute('display') !== 'none' && e.getAttribute('opacity') !== '0.0').length)
  await seedOnly.close()
  const grown = await open('#tanaman', { seed: cabai })
  const mature = await grown.locator('.plant-scene svg *').evaluateAll(all => all.filter(e => e.getAttribute('display') !== 'none' && e.getAttribute('opacity') !== '0.0').length)
  ok(mature > young, `A grown plant shows more parts than a seedling (${mature} vs ${young})`)

  // Nothing in the picture listens to the pointer, so leaves cannot follow it.
  const listening = await grown.evaluate(() => window.__svgListeners.filter(([el]) => el.closest?.('.plant-scene')).map(([el, type]) => `${el.tagName}:${type}`))
  ok(listening.length === 0, `The stage must not listen to the pointer: ${listening}`)
  await grown.close()

  // The sky follows the session clock: the stop colour at night is darker than at noon, and the page period agrees.
  const sky = []
  for (const hours of [0, 6, 16]) {
    const page = await open('#tanaman', { seed: advance(plantSeed(createJourney(scenarios[0])), hours) })
    const stop = await page.locator('.plant-scene linearGradient[id$="-sky"] stop').first().getAttribute('stop-color')
    sky.push({ period: await page.locator('.dash-stage').getAttribute('data-sky'), light: luminance(stop) })
    await page.close()
  }
  const lightest = Math.max(...sky.map(s => s.light)), night = sky.find(s => s.period === 'malam')
  ok(night && night.light < lightest * .6, `Night is darker than day: ${JSON.stringify(sky)}`)

  // The demo weather: every sky draws, rain falls only in the rain, the note speaks only about rain and heat, and the choice is remembered.
  {
    const page = await open('#tanaman', { seed: leafy })
    const pick = name => page.locator('.stage-weather').getByRole('radio', { name, exact: true }).check()
    const skyIs = kind => page.waitForFunction(k => document.querySelector('.plant-scene svg')?.getAttribute('data-weather') === k, kind)
    for (const [name, kind, note] of [['Berawan', 'berawan', null], ['Mendung', 'mendung', null], ['Hujan', 'hujan', /sedang hujan/i], ['Terik', 'terik', /suhu tinggi/i], ['Cerah', 'cerah', null]]) {
      await pick(name); await skyIs(kind)
      await page.waitForTimeout(1800) // the springs settle
      const drops = Number(await page.locator('.plant-scene svg').getAttribute('data-drops'))
      ok(kind === 'hujan' ? drops > 0 : drops === 0, `${kind}: ${drops} streaks of rain`)
      const lines = await page.locator('.stage-weather-note').allTextContents()
      ok(note ? note.test(lines.join(' ')) : lines.length === 0, `${kind}: note ${JSON.stringify(lines)}`)
      await page.locator('.plant-scene').screenshot({ path: `${output}/weather-${kind}.png` })
    }
    await pick('Hujan'); await skyIs('hujan')
    ok(await page.evaluate(() => localStorage.getItem('smart-agro.weather')) === 'hujan', 'The choice is stored')
    await page.reload(); await curtainOpen(page); await page.locator('.plant-scene svg').waitFor()
    await skyIs('hujan')
    ok(await page.locator('.stage-weather input[value=hujan]').isChecked(), 'The choice survives a reload')
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The weather control does not widen the page')
    await page.close()
    const narrow = await open('#tanaman', { width: 320, seed: leafy, text: true, reducedMotion: 'reduce' })
    ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The weather control fits at 320px with text at 200%')
    await narrow.locator('.dash-stage').screenshot({ path: `${output}/stage-320-text200.png` })
    await narrow.close()
  }

  // Text at 200% never pushes the page wider than a phone.
  for (const width of [375, 320]) {
    const page = await open('#tanaman', { width, seed: cabai, text: true, reducedMotion: 'reduce' })
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Text at 200% overflows at ${width}px`)
    await page.locator('.plant-scene').screenshot({ path: `${output}/cabai-${width}-text200.png` })
    await page.close()
  }

  // One gentle breeze moves the plant; reduced motion holds it still.
  const outline = page => page.evaluate(() => [...document.querySelectorAll('.plant-scene path')].map(p => p.getAttribute('d')).join('|'))
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const page = await open('#tanaman', { seed: leafy, reducedMotion })
    const before = await outline(page)
    await page.waitForTimeout(700)
    ok((before === await outline(page)) === (reducedMotion === 'reduce'), `The leaves ${reducedMotion === 'reduce' ? 'must hold still' : 'must sway'} with reduced motion = ${reducedMotion}`)
    await page.close()
  }

  // Going back and forth between pages must not pile up animation loops.
  {
    const page = await open('#tanaman', { seed: cabai })
    const pending = async () => { let most = 0; for (let i = 0; i < 12; i++) { most = Math.max(most, await page.evaluate(() => window.__raf.size)); await page.waitForTimeout(40) } return most }
    const baseline = await pending()
    for (let i = 0; i < 5; i++) {
      await page.getByRole('link', { name: 'Ruang tanam', exact: true }).click()
      await page.getByRole('heading', { name: 'Ruang tanam', exact: true, level: 1 }).waitFor()
      await page.getByRole('link', { name: 'Tanaman', exact: true }).click()
      await page.getByRole('heading', { name: 'Tanaman', exact: true, level: 1 }).waitFor()
    }
    await page.locator('.plant-scene svg').waitFor()
    const after = await pending()
    ok(after <= baseline + 1, `Animation loops piled up: ${baseline} before, ${after} after`)
    await page.close()
  }

  // Watering plays once, and not at all under reduced motion; the app's care effect ends it within seconds.
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await open('#simulasi', { reducedMotion })
    await page.getByRole('button', { name: 'Tanam & mulai', exact: true }).click()
    await page.getByRole('button', { name: 'Jeda', exact: true }).click()
    await page.getByRole('button', { name: 'Siram 150 mL', exact: true }).click()
    if (reducedMotion === 'no-preference') {
      await page.locator('.plant-scene svg[data-pouring]').waitFor({ timeout: 3000 })
      await page.locator('.plant-scene').screenshot({ path: `${output}/pouring.png` })
      await page.locator('.plant-scene svg[data-pouring]').waitFor({ state: 'detached', timeout: 9000 })
      checks++
    } else {
      await page.waitForTimeout(600)
      ok(await page.locator('.plant-scene svg[data-pouring]').count() === 0, 'No pouring animation under reduced motion')
    }
    await page.close()
  }

  assert.deepEqual(errors, [], `Console errors: ${errors.join(' | ')}`)
  console.log(`plant-scene-browser: ${checks} checks passed`)
} finally {
  await browser.close()
}
