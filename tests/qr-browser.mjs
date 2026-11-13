// Product QR in a real Chrome: the public code renders, a downloaded PNG is read back from a photo, a fake camera
// that shows the code is read live, and a refused camera explains the photo fallback. Needs a running build
// (`npx vite preview --port 4173`) and ffmpeg on PATH for the fake camera clip.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { asGuest } from './entry-helpers.mjs'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = new URL('#ekosistem', process.env.TEST_URL || 'http://127.0.0.1:4173/').href
const output = resolve('.tmp/qr-browser')
await mkdir(output, { recursive: true })
const errors = []
const curtainOpen = page => page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
const watch = (page, label) => {
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error' && !/getUserMedia|Permission|NotAllowed/.test(message.text())) errors.push(`${label}: ${message.text()}`) })
}
const qrCard = page => page.locator('#qr-verify-heading').locator('xpath=ancestor::section')
const selected = page => page.locator('#qr-verify-heading').locator('xpath=ancestor::section').locator('.ui-select-trigger').innerText()
const pick = async (page, serial) => {
  await page.getByRole('combobox', { name: 'Pilih nomor seri QR publik' }).click()
  await page.getByRole('option', { name: new RegExp(serial) }).click()
}
const feedback = page => page.locator('.miro-feedback span').innerText()

const plain = await chromium.launch({ headless: true, channel: 'chrome' })

asGuest(plain) // account entry is covered by the account checks
let png
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await plain.newPage({ viewport: { width, height }, acceptDownloads: true })
    watch(page, `${width}`)
    await page.goto(url); await curtainOpen(page)
    await page.locator('#qr-verify-heading').waitFor()

    // The selected product shows its public QR: a link with the serial and nothing secret.
    const qr = page.getByRole('img', { name: 'QR produk AGRO-KIT-POT-001' })
    await qr.waitFor()
    assert.match(await page.locator('.product-qr small').innerText(), /\?serial=AGRO-KIT-POT-001#ekosistem$/)
    assert.doesNotMatch(await page.locator('.product-qr').innerText(), /SEALED|SECRET/i, 'The public QR never shows the sealed code')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}`)
    await page.locator('.product-qr').screenshot({ path: `${output}/qr-card-${width}.png` })

    // Download the PNG of POT-002, switch to POT-001, then read the photo back: the picker follows the code.
    await pick(page, 'AGRO-KIT-POT-002')
    const download = page.waitForEvent('download')
    await page.locator('.product-qr').getByRole('button', { name: 'PNG' }).click()
    png = `${output}/agro-kit-pot-002.png`
    await (await download).saveAs(png)
    await pick(page, 'AGRO-KIT-POT-001')
    await qrCard(page).getByRole('button', { name: 'Pindai QR' }).click()
    const dialog = page.getByRole('dialog', { name: 'Pindai QR produk' })
    await dialog.waitFor()
    // Headless Chrome has no camera here: the dialog says so and offers the photo.
    await dialog.locator('.qr-scanner-status').filter({ hasText: /foto QR/ }).waitFor({ timeout: 8000 })
    await dialog.locator('input[type=file]').setInputFiles(png)
    await dialog.waitFor({ state: 'detached', timeout: 15000 })
    assert.match(await selected(page), /AGRO-KIT-POT-002/, 'Scanning the photo selects the product on the code')
    assert.match(await feedback(page), /QR AGRO-KIT-POT-002 terbaca/)

    // A photo without a product code is refused without changing the selection.
    await qrCard(page).getByRole('button', { name: 'Pindai QR' }).click()
    await dialog.locator('input[type=file]').setInputFiles(resolve('public/favicon.svg'))
    await dialog.locator('.qr-scanner-status').filter({ hasText: /tidak terbaca|tidak dapat dibaca/ }).waitFor({ timeout: 15000 })
    await page.keyboard.press('Escape')
    assert.match(await selected(page), /AGRO-KIT-POT-002/)
    await page.close()
  }
} finally { await plain.close() }

// Fake camera: Chrome plays a still clip of the PNG as the webcam; the scanner must read it without any click.
const clip = `${output}/camera.y4m`
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-vf', 'scale=480:480,pad=640:480:80:0:white,format=yuv420p', '-t', '2', '-r', '10', clip])
const camera = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`] })
asGuest(camera) // account entry is covered by the account checks
try {
  const context = await camera.newContext({ viewport: { width: 1024, height: 768 }, permissions: ['camera'] })
  const page = await context.newPage()
  watch(page, 'camera')
  await page.goto(url); await curtainOpen(page)
  await page.locator('#qr-verify-heading').waitFor()
  await qrCard(page).getByRole('button', { name: 'Pindai QR' }).click()
  // The code can be read on the first frames, so the dialog may close before a preview screenshot is possible.
  await page.getByRole('dialog', { name: 'Pindai QR produk' }).waitFor({ state: 'detached', timeout: 15000 }).catch(async error => {
    throw new Error(`${error.message.split(/\r?\n/)[0]} — status: ${await page.locator('.qr-scanner-status').innerText().catch(() => '?')}`)
  })
  assert.match(await selected(page), /AGRO-KIT-POT-002/, 'The live camera frame selects the product')
  // Closing the dialog releases the camera.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].some(v => v.srcObject)), false)
  await context.close()

  // A refused permission explains the alternatives instead of failing silently.
  const denied = await camera.newContext({ viewport: { width: 1024, height: 768 }, permissions: [] })
  const page2 = await denied.newPage()
  watch(page2, 'denied')
  await page2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')) })
  await page2.goto(url); await curtainOpen(page2)
  await qrCard(page2).getByRole('button', { name: 'Pindai QR' }).click()
  await page2.locator('.qr-scanner-status').filter({ hasText: 'Izin kamera ditolak' }).waitFor()
  await denied.close()
} finally { await camera.close() }

assert.deepEqual(errors, [], 'No page errors')
console.log('QR browser checks passed: render, PNG photo read, invalid photo, fake camera, denied camera at 1440/390/1024.')
