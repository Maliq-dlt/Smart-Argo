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
/** True when a WebGL canvas has drawn something other than a flat colour (copied to 2D; the renderer keeps its buffer). */
const painted3d = (page, selector) => page.evaluate(s => {
  const src = document.querySelector(s)
  if (!src?.width) return false
  const c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height }), ctx = c.getContext('2d')
  ctx.drawImage(src, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data, seen = new Set()
  for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4},${d[i + 3] >> 6}`)
  return seen.size > 6
}, selector)

try {
  // Without WebGL the device falls back to its poster, the curtain still lifts, and the console stays clean.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : original.call(this, type, ...rest) }
    })
    page.on('pageerror', error => errors.push(`no-webgl: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') errors.push(`no-webgl: ${message.text()}`) })
    await page.goto(url)
    await page.waitForSelector('.curtain[data-state=open]', { timeout: 8000 })
    await page.waitForFunction(() => document.querySelector('.v5-hero .device-poster')?.naturalWidth > 0, null, { timeout: 5000 })
    assert.equal(await page.locator('.v5-hero .device-poster').isVisible(), true, 'Poster stands in for the device without WebGL')
    await page.close()
  }

  // The browser toolbar sliding in and out (pointer flicked to the top edge in fullscreen) resizes the viewport many
  // times a second. The 3D buffer is resized once the size settles, so the device neither flickers nor breaks.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.on('pageerror', error => errors.push(`resize storm: ${error.message}`))
    await page.goto(url)
    await page.waitForSelector('.v5-hero .device-slot[data-live] canvas', { timeout: 10000 })
    await page.evaluate(() => {
      const canvas = document.querySelector('.v5-hero .device-slot canvas')
      Object.assign(window, { __lost: 0, __reallocs: 0 })
      canvas.addEventListener('webglcontextlost', () => window.__lost++)
      let last = `${canvas.width}x${canvas.height}`
      const watch = () => { const now = `${canvas.width}x${canvas.height}`; if (now !== last) { window.__reallocs++; last = now } requestAnimationFrame(watch) }
      watch()
    })
    for (let round = 0; round < 4; round++) {
      for (let h = 900; h >= 820; h -= 8) { await page.setViewportSize({ width: 1440, height: h }); await page.waitForTimeout(16) }
      for (let h = 820; h <= 900; h += 8) { await page.setViewportSize({ width: 1440, height: h }); await page.waitForTimeout(16) }
    }
    await page.waitForTimeout(600)
    const storm = await page.evaluate(() => ({ lost: window.__lost, reallocs: window.__reallocs }))
    assert(storm.reallocs <= 2, `3D buffer resized ${storm.reallocs} times during the toolbar slide`)
    assert.equal(storm.lost, 0, 'No lost WebGL context')
    assert(await painted3d(page, '.v5-hero .device-slot canvas'), 'Device still drawn after the slide')
    await page.close()
  }

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
    // Hero device: the live 3D canvas with motion, the still poster under reduced motion.
    const heroCanvas = '.v5-hero .device-slot[data-active=true] canvas'
    if (reducedMotion === 'no-preference') {
      await page.waitForSelector(heroCanvas, { timeout: 8000 })
      await page.waitForTimeout(400)
      assert(await painted3d(page, heroCanvas), 'Hero draws the 3D device')
      if (width === 390) assert.equal(await page.evaluate(s => getComputedStyle(document.querySelector(s)).touchAction, heroCanvas), 'pan-y', 'A vertical swipe over the device still scrolls the page')
    } else {
      assert.equal(await page.locator('.v5-hero .device-slot canvas').count(), 0, 'Reduced motion shows no live canvas')
      await page.waitForFunction(() => document.querySelector('.v5-hero .device-poster')?.naturalWidth > 0)
    }

    // Theme: the landing follows the same toggle and storage key as the simulator.
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme)
    const before = await theme()
    await page.locator('.sa-nav .theme-toggle').click()
    await page.waitForFunction(previous => document.documentElement.dataset.theme !== previous, before)
    assert.equal(await page.evaluate(() => localStorage.getItem('smart-agro.theme')), await theme())
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sa')).backgroundColor), (await theme()) === 'dark' ? 'rgb(22, 29, 25)' : 'rgb(236, 239, 231)', 'Landing palette follows the theme')
    if (reducedMotion === 'no-preference') await page.waitForFunction(s => document.querySelector(s)?.dataset.theme === document.documentElement.dataset.theme, heroCanvas, { timeout: 3000 })
    // The hero is a sage stage in both themes (dark ink stays readable) and nothing old shows behind the device.
    const heroStage = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.v5-hero')); return { bg: s.backgroundColor, image: s.backgroundImage, ink: getComputedStyle(document.querySelector('.v5-hero-copy h1')).color } })
    assert.equal(heroStage.bg, 'rgb(167, 178, 156)', `Hero stays sage in the ${await theme()} theme`)
    assert.equal(heroStage.image, 'none', 'No old poster behind the device')
    assert.equal(heroStage.ink, 'rgb(24, 33, 27)', 'Hero text stays dark ink on the sage stage')
    // The leaf shade covers the whole hero edge to edge, and sways only when motion is allowed.
    const shadeBox = await page.evaluate(() => { const h = document.querySelector('.v5-hero').getBoundingClientRect(), s = document.querySelector('.v5-leaf-shade').getBoundingClientRect(); return { left: s.left <= h.left, right: s.right >= h.right, top: s.top <= h.top, bottom: s.bottom >= h.bottom } })
    assert.deepEqual(shadeBox, { left: true, right: true, top: true, bottom: true }, 'Leaf shade covers the full hero')
    const shadeFrame = () => page.evaluate(() => document.querySelector('.v5-leaf-shade').toDataURL())
    const firstShade = await shadeFrame()
    await page.waitForTimeout(700)
    assert.equal((await shadeFrame()) !== firstShade, reducedMotion === 'no-preference', 'Leaves sway with motion, stay still without')
    if (reducedMotion === 'no-preference') {
      // The 3D layer draws only the device and its shadow: its corners stay transparent while it turns.
      const corners = await page.evaluate(s => {
        const src = document.querySelector(s), c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height }), ctx = c.getContext('2d')
        ctx.drawImage(src, 0, 0)
        return [[2, 2], [c.width - 3, 2], [2, c.height - 3], [c.width - 3, c.height - 3]].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3])
      }, heroCanvas)
      assert.deepEqual(corners, [0, 0, 0, 0], 'The device canvas paints no backdrop of its own')
    }
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
      // Squares stay in the muted sage range of the stage: no highlighter green or bright yellow.
      const loudest = await page.evaluate(() => {
        const c = document.querySelector('.v5-trail'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, sat = []
        for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] > 200) { const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]); sat.push(max ? (max - min) / max : 0) }
        sat.sort((a, b) => a - b)
        return sat[Math.floor(sat.length * .95)] ?? 0
      })
      assert(loudest < .5, `Trail squares stay muted (95th percentile saturation ${loudest.toFixed(2)})`)
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

    // Device scene: one live device follows the story. Phases and device states track the scroll, forwards and back.
    const phase = () => page.locator('.v5-pin-product .v5-stage').getAttribute('data-phase')
    const slot = section => page.locator(`${section} .device-slot`)
    const shownLabels = section => page.locator(`${section} .device-label.is-on:not(.is-hidden)`).evaluateAll(els => els.map(el => el.dataset.label))
    if (reducedMotion === 'no-preference') {
      for (const [fraction, expected, mode] of [[.1, '0', 'studio'], [.5, '1', 'label'], [.9, '2', 'tembus'], [.1, '0', 'studio']]) {
        await scrollPin(page, '.v5-pin-product', fraction)
        assert.equal(await phase(), expected, `Device phase at ${fraction}`)
        assert.equal(await slot('.v5-pin-product').getAttribute('data-mode'), mode, `Device state at ${fraction}`)
      }
      await scrollPin(page, '.v5-pin-product', .5)
      assert.equal(await page.locator('.v5-pin-product .device-label.is-on').count(), 3, 'Three parts are labelled')
      // No label sits on the phase copy ("Kenalkan Smart Agro." once covered "Panel surya" around 1024–1280 px).
      const onCopy = await page.evaluate(() => {
        const copy = document.querySelector('.v5-pin-product .v5-ph-1').getBoundingClientRect()
        return [...document.querySelectorAll('.v5-pin-product .device-label.is-on')].filter(label => {
          const r = label.getBoundingClientRect()
          return r.left < copy.right && copy.left < r.right && r.top < copy.bottom && copy.top < r.bottom
        }).map(label => label.dataset.label)
      })
      assert.deepEqual(onCopy, [], `Labels clear of the phase copy at ${width}`)
      assert(await painted3d(page, '.v5-pin-product .device-slot[data-active=true] canvas'), 'Product draws the 3D device')
      await scrollPin(page, '.v5-pin-product', .9)
      assert((await page.locator('.v5-pin-product .device-label.is-on').evaluateAll(els => els.map(el => el.dataset.label))).includes('esp32'), 'See-through shell names the ESP32')
      if (width === 1440) {
        // Resizing keeps the labels inside the slot and the canvas as wide as the slot.
        await scrollPin(page, '.v5-pin-product', .5)
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(700)
        await scrollPin(page, '.v5-pin-product', .5)
        const fit = await page.evaluate(() => {
          const s = document.querySelector('.v5-pin-product .device-slot'), box = s.getBoundingClientRect(), canvas = s.querySelector('canvas')
          const out = [...s.querySelectorAll('.device-label.is-on')].map(l => l.getBoundingClientRect()).filter(r => r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)
          return { out: out.length, canvas: Math.round(canvas?.getBoundingClientRect().width ?? 0), slot: Math.round(box.width) }
        })
        assert.equal(fit.out, 0, 'Labels stay inside the slot after a resize')
        assert.equal(fit.canvas, fit.slot, 'Canvas follows the slot width after a resize')
        await page.setViewportSize({ width, height }); await page.waitForTimeout(700)
      }
      await scrollPin(page, '.v5-pin-root', .9)
      assert.equal(await slot('.v5-pin-root').getAttribute('data-mode'), 'tanah', 'Root zone shows the device in the soil')
      assert(await painted3d(page, '.v5-pin-root .device-slot[data-active=true] canvas'), 'Root zone draws the 3D device')
      assert.deepEqual(await shownLabels('.v5-pin-root'), [], 'Root zone does not name the parts again')
      // Numbers: each figure lights its device part as it passes the middle of the screen.
      const nums = page.locator('.v5-num')
      for (const [i, part] of ['led', 'probe', 'moisture', 'solar'].entries()) {
        await nums.nth(i).evaluate(el => scrollTo(0, el.getBoundingClientRect().top + scrollY + el.offsetHeight / 2 - innerHeight / 2))
        await page.waitForTimeout(900)
        assert.equal(await slot('.v5-numbers').getAttribute('data-highlight'), part, `Figure ${i + 1} lights ${part}`)
      }
      assert.equal(await slot('.v5-numbers').getAttribute('data-mode'), 'angka')
      assert.deepEqual(await shownLabels('.v5-numbers'), [], 'Numbers animate the parts instead of naming them')
      // A jump from the hero lands with exactly one live slot, the one in view.
      await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600)
      await page.evaluate(() => document.getElementById('zona-akar').scrollIntoView()); await page.waitForTimeout(1300)
      assert.deepEqual(await page.locator('.device-slot[data-active=true]').evaluateAll(els => els.map(el => el.closest('section')?.id + ':' + el.dataset.mode)), ['zona-akar:tanah'], 'One live slot after a jump')
    } else {
      assert.equal(await phase(), 'all', 'Reduced motion shows every phase')
      for (const [section, mode] of [['.v5-pin-product', 'tembus'], ['.v5-pin-root', 'tanah'], ['.v5-numbers', 'angka']]) {
        assert.equal(await slot(section).getAttribute('data-mode'), mode, `${section} shows its final state`)
        await slot(section).scrollIntoViewIfNeeded()
        await page.waitForFunction(s => document.querySelector(`${s} .device-poster`)?.naturalWidth > 0, section)
      }
      assert.equal(await page.locator('.device-slot canvas').count(), 0, 'No live canvas under reduced motion')
    }

    // Leaf reveal: the leaf opens onto a vector garden (a chili and a shallot pot), not a video.
    assert.equal(await page.locator('.v5-leafreveal video').count(), 0, 'No garden video left')
    assert(await page.locator('.v5-garden .v5-leaf-shape').count() >= 16, 'The garden has the chili plant')
    assert.equal(await page.locator('.v5-garden .v5-shallot').count(), 3, 'The garden has shallot bulbs')
    await scrollPin(page, '.v5-pin-leaf', .95)
    assert.equal(await page.locator('#v5-leaf-title').isVisible(), true)
    if (width === 1440 || width === 390) await page.screenshot({ path: `${output}/leaf-${width}-${reducedMotion}.png` })

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
    // The growth is a vector clip: an SVG with visible shapes, no bitmap frames.
    assert(await page.locator('.v5-grow-art svg path').evaluateAll(paths => paths.some(p => { const r = p.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(p).display !== 'none' })), 'Growth clip is drawn')
    assert.equal(await page.locator('.v5-grow canvas').count(), 0, 'No frame sequence left in Grow')
    if (width === 1440 && reducedMotion === 'no-preference') await page.screenshot({ path: `${output}/grow.png` })
    await page.getByRole('button', { name: 'Ulangi' }).click()
    await page.getByRole('button', { name: 'Siram sesuai saran' }).waitFor()

    // Ask the engine: the answer comes from the simulator's rules and the chosen crop's own profile.
    const ask = page.locator('#tanya')
    await ask.scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
    // The section adds no status region of its own: the page keeps a single role=status (an <output> would add one).
    assert.equal(await ask.getByRole('status').count(), 0, 'No extra status region in Tanya mesinnya')
    const slider = ask.getByRole('slider', { name: /Kelembapan tanah/ }), answer = () => ask.locator('.v5-ask-rule').textContent()
    for (const [value, label] of [['25', 'Kering terkonfirmasi'], ['55', 'Pengamatan'], ['92', 'Basah menetap'], ['33', 'Kering terkonfirmasi']]) {
      await slider.fill(value)
      assert.equal(await answer(), label, `Moisture ${value} for chili`)
    }
    await ask.getByRole('button', { name: 'Bawang merah' }).click()
    assert.equal(await answer(), 'Pengamatan', 'The same reading is not dry for shallots')
    assert.equal(await ask.getByRole('button', { name: 'Bawang merah' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await ask.locator('.v5-shallot').count(), 3, 'The pot shows the shallot')
    assert.deepEqual(await ask.locator('.v5-ask-actions a').evaluateAll(links => links.map(a => a.getAttribute('href'))), ['#simulasi', '#statistik'])
    if ([1440, 390].includes(width) && reducedMotion === 'no-preference') await ask.screenshot({ path: `${output}/ask-${width}.png` })

    // Footer and overall fit.
    await page.locator('.mrf-root').scrollIntoViewIfNeeded()
    assert(await fits(page), `Page overflow at ${width}`)
    if ([1440, 390].includes(width)) await page.screenshot({ path: `${output}/footer-${width}-${reducedMotion}.png` })
    report.push({ width, reducedMotion, curtain: reducedMotion === 'reduce' ? 'skipped' : 'pass', hero: 'pass', theme: 'pass', plant: 'pass', phases: 'pass', device: 'pass', garden: 'pass', grow: 'pass', ask: 'pass', overflow: 'pass' })
    await page.close()
  }
  assert.deepEqual(errors, [], 'No page errors')
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
