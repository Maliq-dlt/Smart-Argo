// Sign-up visibility and the first-pot step, against a mocked Auth (no Docker needed): the email form is open with
// Masuk/Daftar tabs, a short new password is explained before submitting, sign-up asks to confirm by email, and the
// first sign-in opens "Siapkan pot", whose answer is saved on the account and opens that crop's journey.
// Needs the local build served (`npm run build && npx vite preview --port 4173`) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gate } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#masuk'
const auth = process.env.AUTH_URL || 'http://127.0.0.1:54321'
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = meta => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f', email: 'pot@contoh.test', exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal1', app_metadata: { providers: ['email'] }, user_metadata: meta })}.sig`
const session = meta => ({ access_token: jwt(meta), refresh_token: `r${Math.random().toString(36).slice(2)}`, expires_in: 3600, token_type: 'bearer', user: { id: '6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f', email: 'pot@contoh.test', factors: [] } })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let saved = null, signups = 0, lastSignup = null
await page.route(`${auth}/**`, async route => {
  const request = route.request(), url = new URL(request.url())
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  const json = body => route.fulfill({ status: 200, headers: cors, json: body })
  if (url.pathname === '/auth/v1/settings') return json({ external: { google: false, email: true } })
  if (url.pathname === '/auth/v1/signup') { signups++; lastSignup = request.postDataJSON(); return json({ id: 'x', email: 'pot@contoh.test' }) } // confirmation pending
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') return json(session({}))
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return json(session(saved ? { pot: saved } : {}))
  if (url.pathname === '/auth/v1/user' && request.method() === 'PUT') { saved = request.postDataJSON().data.pot; return json({ id: 'x', user_metadata: { pot: saved } }) }
  if (url.pathname.endsWith('/my_products')) return json({ products: [] })
  return json({})
})

const checks = []
try {
  await page.goto(app)
  await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
  const email = gate(page).getByLabel('Email', { exact: true }), password = gate(page).getByLabel('Kata sandi', { exact: true })
  await email.waitFor()
  assert.equal(await page.locator('details.signin-email').count(), 0, 'no folded email form')
  checks.push('email form open on arrival, no fold')

  await gate(page).getByRole('tab', { name: 'Daftar', exact: true }).click()
  await gate(page).getByLabel('Nama', { exact: true }).fill('Penguji Smart Agro')
  const confirm = gate(page).getByLabel('Konfirmasi kata sandi', { exact: true })
  await email.fill('pot@contoh.test'); await password.fill('pendek')
  const hint = gate(page).locator('.signin-hint')
  assert.match(await hint.textContent(), /Minimal 10 karakter · kurang 4/)
  assert.equal(await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).getAttribute('aria-disabled'), 'true')
  await password.press('Enter') // trying anyway: the browser's own length check stops it
  assert.equal(signups, 0, 'a short password never reaches Auth')
  await password.fill('cukup-panjang-12')
  assert.match(await hint.textContent(), /sudah cukup/)
  await confirm.fill('cukup-panjang-13')
  assert.match(await hint.textContent(), /Konfirmasi kata sandi belum sama\./)
  assert.equal(await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).getAttribute('aria-disabled'), 'true')
  await confirm.press('Enter') // trying anyway: a mismatch never reaches Auth
  assert.equal(signups, 0, 'a mismatched confirmation never reaches Auth')
  await confirm.fill('cukup-panjang-12')
  assert.match(await hint.textContent(), /sudah cukup/)
  await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).click()
  await gate(page).getByRole('heading', { name: 'Masukkan kode dari email' }).waitFor()
  assert.equal(signups, 1)
  assert.equal(lastSignup.data.display_name, 'Penguji Smart Agro', 'the name travels as user metadata')
  checks.push('Daftar tab explains the 10-character rule, then opens the email code step')
  await gate(page).getByRole('button', { name: 'Ganti email', exact: true }).click()

  await gate(page).getByRole('tab', { name: 'Masuk', exact: true }).click()
  await password.fill('cukup-panjang-12')
  await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
  const setup = page.getByRole('main', { name: 'Siapkan pot', exact: true })
  await setup.waitFor({ timeout: 15000 })
  await setup.getByLabel('Nama pot').fill('Bawang teras')
  await setup.getByRole('radio', { name: /Bawang merah/ }).check()
  await setup.getByRole('button', { name: 'Simpan dan mulai', exact: true }).click()
  await page.locator('.app-shell').waitFor({ timeout: 15000 })
  assert.deepEqual(saved, { name: 'Bawang teras', crop: 'bawang', device: false })
  const pill = page.locator('.session-pill')
  assert.match(await pill.textContent(), /Bawang teras/)
  // The pill names the pot only (dashboard v3); the crop is the stage heading, "Bawang merah dalam pot".
  await page.getByRole('heading', { name: /Bawang merah/ }).waitFor({ timeout: 15000 })
  checks.push('first sign-in asks for the pot once, saves it on the account, opens a Bawang merah journey named after it')

  await page.reload()
  await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
  await page.locator('.app-shell').waitFor({ timeout: 15000 })
  assert.equal(await setup.count(), 0, 'not asked again once saved')
  checks.push('not asked again after a reload')
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await browser.close()
}
