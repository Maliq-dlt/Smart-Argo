// Renders the five device-state posters (transparent WebP) from the code-built 3D scene, so the poster and the live
// device always match. Needs the built site served on 4173 (`npm run build && npm run preview`) and Playwright:
//   PLAYWRIGHT_MODULE=<path to playwright> node scripts/render-device-posters.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from '../tests/entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.POSTER_URL || 'http://127.0.0.1:4173/?device-poster'
const out = 'public/landing/device'
const MAX_KB = 60

await mkdir(out, { recursive: true })
const browser = asGuest(await chromium.launch({ channel: 'chrome' }))
try {
  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => typeof window.__devicePoster === 'function', null, { timeout: 15000 })
  // Settled states, plus the opening shots of the sections that start elsewhere (see DeviceSlot's OPENS).
  for (const [mode, open] of [['studio'], ['label'], ['tembus'], ['tanah'], ['angka'], ['tanah', true], ['angka', true]]) {
    const data = await page.evaluate(([m, o]) => window.__devicePoster(m, 1200, 900, o), [mode, !!open])
    const file = Buffer.from(data.split(',')[1], 'base64'), name = `${mode}${open ? '-open' : ''}.webp`
    await writeFile(`${out}/${name}`, file)
    const kb = Math.round(file.length / 1024)
    console.log(`${name} ${kb} KB${kb > MAX_KB ? ` (over ${MAX_KB} KB)` : ''}`)
  }
} finally {
  await browser.close()
}
