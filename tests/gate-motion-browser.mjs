// The sign-in card must never jump: switching tabs moves only its bottom edge and does it over several frames, "Coba tanpa
// akun" and a finished sign-in leave the gate only behind the loading screen, the password boxes run red to green, and a
// sign-up for an address that already has an account lands on "Masuk" with a notice. Auth is mocked (no Docker). Needs the
// local build served (`npm run build && npx vite preview --port 4173`) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gate } from './entry-helpers.mjs'
import { mockAuth, mockSession } from './mock-auth.mjs'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#masuk'
const EMAIL = 'pot@contoh.test', PASSWORD = 'cukup-panjang-12'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const browser = await chromium.launch({ channel: 'chrome' })
const checks = []
async function scenario(name, routes, run, { width = 1280, height = 860 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  const mock = await mockAuth(page, routes)
  try {
    await page.goto(app)
    await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
    await gate(page).getByLabel('Email', { exact: true }).waitFor()
    await run(page, mock)
    checks.push(name)
  } catch (err) {
    console.error(`FAILED SCENARIO: ${name}`)
    throw err
  } finally { await page.close() }
}
/** Per-frame record of the card's box and of what is on screen, for `ms` milliseconds from now. */
const record = (page, ms = 1500) => page.evaluate(ms => new Promise(done => {
  const frames = [], t0 = performance.now()
  const tick = () => {
    const box = document.querySelector('.entry-card')?.getBoundingClientRect()
    frames.push({ t: performance.now() - t0, gate: Boolean(document.querySelector('.entry-gate')), shell: Boolean(document.querySelector('.app-shell, .pot-setup, main[aria-label="Siapkan pot"]')),
      top: box ? box.top : null, h: box ? box.height : null, curtain: document.querySelector('.curtain')?.dataset.state ?? null })
    if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(frames)
  }
  requestAnimationFrame(tick)
}), ms)
const tab = (page, name) => gate(page).getByRole('tab', { name, exact: true })
// A card that eased: the top edge never moved, the height changed over several frames, and no frame jumped.
function assertEased(frames, what) {
  const tops = frames.map(f => f.top).filter(v => v !== null), heights = frames.map(f => f.h).filter(v => v !== null)
  assert.ok(Math.max(...tops) - Math.min(...tops) < 1.5, `${what}: the card's top edge stayed put (${Math.min(...tops)}..${Math.max(...tops)})`)
  const steps = heights.slice(1).map((h, i) => Math.abs(h - heights[i]))
  assert.ok(Math.max(...heights) - Math.min(...heights) > 40, `${what}: the card changed height at all`)
  assert.ok(steps.filter(s => s > 0.5).length >= 4, `${what}: the height changed over at least four frames, not at once (${steps.filter(s => s > 0.5).length})`)
  assert.ok(Math.max(...steps) < 90, `${what}: no single frame moved the card by more than 90px (${Math.max(...steps).toFixed(0)})`)
}
const channels = value => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
const borderOf = page => gate(page).getByLabel('Kata sandi', { exact: true }).evaluate(el => getComputedStyle(el).borderColor)
try {
  for (const [width, height] of [[1280, 860], [390, 800]]) {
    await scenario(`switching Masuk and Daftar eases the card at ${width}px: the top stays, the height moves over several frames`, {}, async page => {
      const going = record(page)
      await tab(page, 'Daftar').click()
      assertEased(await going, 'Masuk to Daftar')
      assert.equal(await gate(page).getByLabel('Konfirmasi kata sandi', { exact: true }).isVisible(), true, 'the sign-up fields are open')
      const back = record(page)
      await tab(page, 'Masuk').click()
      assertEased(await back, 'Daftar to Masuk')
      assert.equal(await gate(page).getByLabel('Konfirmasi kata sandi', { exact: true }).isVisible(), false, 'the sign-up fields are closed again')
      assert.equal(await gate(page).getByLabel('Nama', { exact: true }).isVisible(), false, 'and out of reach for keyboard and screen readers')
    }, { width, height })
  }
  await scenario('"Coba tanpa akun" leaves the gate only behind the loading screen', {}, async page => {
    const seen = record(page, 4500)
    await gate(page).getByRole('button', { name: 'Coba tanpa akun', exact: true }).click()
    const frames = await seen
    const left = frames.findIndex(f => !f.gate)
    assert.ok(left > 0, 'the gate did go')
    assert.equal(frames[left].curtain, 'covered', `the screen was already covered when the gate went (was ${frames[left].curtain})`)
    assert.ok(frames.slice(0, left).some(f => f.curtain === 'covering'), 'the curtain closed over the gate first')
    assert.ok(frames.at(-1).curtain === 'open' && frames.at(-1).shell, 'then it lifted on the app')
  })
  await scenario('the Google row opens in place when the server answers late, and the guest button does not resize', {
    'GET /auth/v1/settings': async () => { await pause(5000); return { external: { google: true } } },
  }, async page => {
    const guest = gate(page).getByRole('button', { name: 'Coba tanpa akun', exact: true })
    assert.equal(await gate(page).getByRole('button', { name: 'Lanjut dengan Google' }).count(), 0, 'not there before the server has answered')
    const width = (await guest.boundingBox()).width
    const seen = record(page, 3500)
    await gate(page).getByRole('button', { name: 'Lanjut dengan Google' }).waitFor({ timeout: 8000 })
    assertEased(await seen, 'Google row')
    assert.ok(Math.abs((await guest.boundingBox()).width - width) < 1, 'the guest button kept its width')
  })
  await scenario('when the server answers early the card is already in its final shape and then stays still', {
    'GET /auth/v1/settings': async () => ({ external: { google: true } }),
  }, async page => {
    await gate(page).getByRole('button', { name: 'Lanjut dengan Google' }).waitFor()
    await pause(500) // the entrance has finished
    const frames = await record(page, 1000), heights = frames.map(f => f.h)
    assert.ok(Math.max(...heights) - Math.min(...heights) < 1, 'the height did not move')
  })
  await scenario('at 320px with text at 200% the quick buttons wrap their words instead of cutting them off', {
    'GET /auth/v1/settings': async () => ({ external: { google: true } }),
  }, async page => {
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await pause(450)
    for (const name of ['Lanjut dengan Google', 'Coba tanpa akun']) {
      const hidden = await gate(page).getByRole('button', { name }).evaluate(el => el.scrollWidth - el.clientWidth)
      assert.ok(hidden <= 1, `${name}: its words are not cut off (${hidden}px outside the button)`)
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'and the page does not scroll sideways')
  }, { width: 320, height: 700 })
  await scenario('password boxes run red then green, and so does the confirmation', {}, async page => {
    await tab(page, 'Daftar').click()
    const password = gate(page).getByLabel('Kata sandi', { exact: true }), confirm = gate(page).getByLabel('Konfirmasi kata sandi', { exact: true })
    const state = label => gate(page).locator('label.miro-field', { has: page.getByLabel(label, { exact: true }) }).getAttribute('data-state')
    assert.equal(await state('Kata sandi'), null, 'untouched: neutral')
    await password.fill('abcdef')
    assert.equal(await state('Kata sandi'), 'bad')
    await pause(450)
    const [r1, g1] = channels(await borderOf(page))
    assert.ok(r1 > g1, `red while short (rgb ${r1},${g1})`)
    assert.equal(await gate(page).locator('.pw-meter i[data-on]').count(), 6, 'six boxes filled for six characters')
    await password.fill(PASSWORD)
    assert.equal(await state('Kata sandi'), 'ok')
    await pause(450)
    const [r2, g2] = channels(await borderOf(page))
    assert.ok(g2 > r2, `green once there are ten (rgb ${r2},${g2})`)
    assert.equal(await gate(page).locator('.pw-meter i[data-on]').count(), 10, 'all ten filled')
    assert.equal(await state('Konfirmasi kata sandi'), null, 'the confirmation is neutral until typed in')
    await confirm.fill(PASSWORD.slice(0, 5))
    assert.equal(await state('Konfirmasi kata sandi'), 'bad')
    await confirm.fill(PASSWORD)
    assert.equal(await state('Konfirmasi kata sandi'), 'ok')
    await password.fill('abcdef')
    assert.equal(await state('Kata sandi'), 'bad', 'shortening it again turns it red again')
    assert.equal(await state('Konfirmasi kata sandi'), 'bad', 'and the confirmation no longer matches')
  })
  await scenario('a sign-up for an address that already has an account moves to Masuk with a notice', {
    // Hosted Auth answers 200 with a user without identities and sends no email.
    'POST /auth/v1/signup': () => ({ id: 'x', email: EMAIL, identities: [] }),
  }, async (page, mock) => {
    await tab(page, 'Daftar').click()
    await gate(page).getByLabel('Nama', { exact: true }).fill('Maliq Athaya')
    await gate(page).getByLabel('Email', { exact: true }).fill(EMAIL)
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill(PASSWORD)
    await gate(page).getByLabel('Konfirmasi kata sandi', { exact: true }).fill(PASSWORD)
    await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).click()
    await gate(page).getByRole('status').filter({ hasText: 'sudah terdaftar' }).waitFor()
    assert.equal(await tab(page, 'Masuk').getAttribute('aria-selected'), 'true', 'moved to Masuk')
    assert.equal(await gate(page).getByLabel('Email', { exact: true }).inputValue(), EMAIL, 'the address is kept')
    await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'password')
    assert.equal(await gate(page).getByRole('heading', { name: 'Masukkan kode dari email' }).count(), 0, 'no code step for a code that will never come')
    assert.equal(mock.count('POST /auth/v1/signup'), 1)
  })
  await scenario('creating an account shows that it is working, then eases to the code step', {
    'POST /auth/v1/signup': async () => { await pause(900); return { id: 'x', email: EMAIL, identities: [{ provider: 'email' }] } },
  }, async page => {
    await tab(page, 'Daftar').click()
    await gate(page).getByLabel('Nama', { exact: true }).fill('Maliq Athaya')
    await gate(page).getByLabel('Email', { exact: true }).fill(EMAIL)
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill(PASSWORD)
    await gate(page).getByLabel('Konfirmasi kata sandi', { exact: true }).fill(PASSWORD)
    await pause(400) // the sign-up fields have finished opening
    const seen = record(page, 2200)
    await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).click()
    const working = gate(page).getByRole('button', { name: 'Membuat akun…', exact: true })
    await working.waitFor()
    assert.equal(await working.getAttribute('aria-busy'), 'true')
    await gate(page).getByRole('heading', { name: 'Masukkan kode dari email' }).waitFor()
    const frames = await seen, heights = frames.map(f => f.h).filter(v => v !== null)
    const steps = heights.slice(1).map((h, i) => Math.abs(h - heights[i]))
    assert.ok(Math.max(...steps) < 90, `the card eased to the code step (largest frame ${Math.max(...steps).toFixed(0)}px)`)
    assert.ok(steps.filter(s => s > 0.5).length >= 4, 'over several frames')
    assert.match(await gate(page).textContent(), /Spam atau Promosi/, 'says where to look when the email is not in the inbox')
  })
  await scenario('a finished sign-in is also covered, and the app opens behind it', {
    'POST /auth/v1/token?grant_type=password': () => mockSession({ pot: { crop: 'cabai', name: 'Cabai teras', device: false } }),
  }, async page => {
    await gate(page).getByLabel('Email', { exact: true }).fill(EMAIL)
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill(PASSWORD)
    const seen = record(page, 4500)
    await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
    const frames = await seen, left = frames.findIndex(f => !f.gate)
    assert.ok(left > 0, 'the gate did go')
    assert.equal(frames[left].curtain, 'covered', `covered when the gate went (was ${frames[left].curtain})`)
  })
} finally { await browser.close() }
console.log(`gate-motion-browser: ${checks.length} checks passed\n- ${checks.join('\n- ')}`)
