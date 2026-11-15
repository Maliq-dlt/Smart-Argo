// Renders public/mail/header.png, the band at the top of the Auth emails. Gmail does not show SVG, so the brand is a
// PNG (600×150 CSS px at 2x), served from the app origin. Needs PLAYWRIGHT_MODULE and Chrome.
// Run: node scripts/build-mail-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fonts = pathToFileURL(resolve('public/fonts')).href
const MARK = 'M18 19V9M18 12C10 13 7 9 8 5c7 0 10 3 10 7ZM18 9C18 3 23 2 28 3c0 6-4 8-10 6ZM8 18h20l-3 12H11L8 18ZM18 19v7m0-4-4 3m4-2 4 3'
const mark = size => `<svg width="${size}" height="${size}" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${MARK}"/></svg>`

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Fraunces Soft'; src: url('${fonts}/fraunces-soft.woff2') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'General Sans'; src: url('${fonts}/general-sans-500.woff2') format('woff2'); font-weight: 500; }
html, body { margin: 0; width: 600px; height: 150px; overflow: hidden; }
.band { position: relative; width: 600px; height: 150px; overflow: hidden; background: linear-gradient(120deg, #2f5a3c 0%, #3a6b47 58%, #4b7a45 100%); color: #c3df95; }
.leaf { position: absolute; opacity: .13; }
.brand { position: absolute; inset: 0 auto 0 40px; display: flex; align-items: center; gap: 16px; }
.word { font: 420 38px/1 'Fraunces Soft', Georgia, serif; font-variation-settings: 'SOFT' 100; letter-spacing: -.01em; color: #fbfcf9; }
.tag { margin-top: 9px; font: 500 14px/1 'General Sans', system-ui, sans-serif; letter-spacing: .04em; }
</style><div class="band">
<span class="leaf" style="right:-20px;top:-40px">${mark(240)}</span>
<span class="leaf" style="right:170px;top:78px;opacity:.09;transform:rotate(-26deg)">${mark(96)}</span>
<div class="brand">${mark(64)}<div><div class="word">Smart Agro</div><div class="tag">Amati. Pahami. Rawat.</div></div></div></div>`

mkdirSync('.tmp', { recursive: true }); mkdirSync('public/mail', { recursive: true })
writeFileSync('.tmp/mail-header.html', html)
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 150 }, deviceScaleFactor: 2 })
  await page.goto(pathToFileURL(resolve('.tmp/mail-header.html')).href)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'public/mail/header.png', clip: { x: 0, y: 0, width: 600, height: 150 } })
  console.log('public/mail/header.png written')
} finally { await browser.close() }
