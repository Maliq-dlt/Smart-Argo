// Renders the Auth email templates to PNG for review: each template at 600 px (desktop) and 375 px (phone) wide, with
// sample values for the variables Auth fills and the header image read from public/mail. Output goes to
// design-previews/email-2026-11-15/ (git-ignored). Chrome does not imitate a mail client's dark-mode inversion, so
// there is no dark preview; every surface in the templates has an explicit background so clients invert them coherently.
// Run: node scripts/preview-email.mjs [confirmation|recovery]   (needs PLAYWRIGHT_MODULE and Chrome)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const names = process.argv[2] ? [process.argv[2]] : ['confirmation', 'recovery']
const out = 'design-previews/email-2026-11-15'
const sample = { '.Token': '482915', '.ConfirmationURL': 'https://smart-agro-demo.pages.dev/#statistik', '.Email': 'tani@contoh.id', '.SiteURL': 'https://smart-agro-demo.pages.dev' }
const localImages = pathToFileURL(resolve('public/mail')).href + '/'

mkdirSync(out, { recursive: true }); mkdirSync('.tmp', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const name of names) {
    const html = readFileSync(`supabase/templates/${name}.html`, 'utf8')
      .replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, action) => sample[action] ?? `[${action}]`)
      .replaceAll('https://smart-agro-demo.pages.dev/mail/', localImages)
    const file = resolve(`.tmp/preview-${name}.html`)
    writeFileSync(file, html)
    for (const width of [600, 375]) {
      const page = await browser.newPage({ viewport: { width: width + 40, height: 800 }, deviceScaleFactor: 2 })
      await page.goto(pathToFileURL(file).href)
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true })
      await page.close()
      console.log(`${out}/${name}-${width}.png`)
    }
  }
} finally { await browser.close() }
