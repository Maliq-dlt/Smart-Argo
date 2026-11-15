// Sign-up verifies the email with a six-digit code before "Siapkan pot", against a mocked Auth (no Docker): the code
// is accepted pasted with spaces and sent once, a wrong code explains itself and clears, signing in with an unconfirmed
// email opens the same step, and "send again" waits out its cooldown. Needs the local build served
// (`npm run build && npx vite preview --port 4173`) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gate } from './entry-helpers.mjs'
import { mockAuth, mockSession } from './mock-auth.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#masuk'
const EMAIL = 'pot@contoh.test', PASSWORD = 'cukup-panjang-12'
const WRONG = { status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } }
const UNCONFIRMED = { status: 400, body: { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' } }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const browser = await chromium.launch({ channel: 'chrome' })
const checks = []

async function scenario(name, routes, run) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
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
async function signUp(page) {
  await gate(page).getByRole('tab', { name: 'Daftar', exact: true }).click()
  await gate(page).getByLabel('Nama', { exact: true }).fill('Maliq Athaya')
  await gate(page).getByLabel('Email', { exact: true }).fill(EMAIL)
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill(PASSWORD)
  await gate(page).getByLabel('Konfirmasi kata sandi', { exact: true }).fill(PASSWORD)
  await gate(page).getByRole('button', { name: 'Buat akun', exact: true }).click()
}
const codeStep = page => gate(page).getByRole('heading', { name: 'Masukkan kode dari email' })
const codeInput = page => gate(page).getByLabel('Kode verifikasi', { exact: true })
const waiting = page => gate(page).getByRole('button', { name: /^Kirim ulang dalam \d+ dtk$/ })
const signup = () => ({ id: 'x', email: EMAIL }) // Auth answers a pending confirmation without a session

try {
  await scenario('a pasted code with spaces is sent once, even when Enter follows, then "Siapkan pot" opens', {
    'POST /auth/v1/signup': signup,
    'POST /auth/v1/verify': async () => { await pause(300); return mockSession({}) },
  }, async (page, mock) => {
    await signUp(page)
    await codeStep(page).waitFor()
    assert.match(await gate(page).textContent(), /pot@contoh\.test/)
    assert.equal(await waiting(page).isDisabled(), true, 'send again waits out its cooldown')
    assert.equal(mock.bodies('POST /auth/v1/signup')[0].data.display_name, 'Maliq Athaya')
    await codeInput(page).fill('482 915')
    await codeInput(page).press('Enter').catch(() => undefined) // the step may already be gone
    await page.getByRole('main', { name: 'Siapkan pot', exact: true }).waitFor({ timeout: 15000 })
    assert.equal(mock.count('POST /auth/v1/verify'), 1, 'one verify call, not two')
    assert.deepEqual(mock.bodies('POST /auth/v1/verify')[0], { type: 'signup', email: EMAIL, token: '482915' })
  })

  let attempt = 0
  await scenario('a wrong code explains itself, clears and refocuses the field, and the next code works', {
    'POST /auth/v1/signup': signup,
    'POST /auth/v1/verify': () => ++attempt === 1 ? WRONG : mockSession({}),
  }, async page => {
    await signUp(page)
    await codeInput(page).fill('111111')
    await gate(page).getByRole('alert').filter({ hasText: 'Kode salah atau sudah kedaluwarsa. Periksa kodenya, atau pilih Kirim ulang.' }).waitFor()
    assert.equal(await codeInput(page).inputValue(), '')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('autocomplete')), 'one-time-code')
    await codeInput(page).fill('482915')
    await page.getByRole('main', { name: 'Siapkan pot', exact: true }).waitFor({ timeout: 15000 })
  })

  await scenario('signing in with an unconfirmed email opens the code step with send again ready', {
    'POST /auth/v1/token?grant_type=password': () => UNCONFIRMED,
    'POST /auth/v1/resend': () => ({}),
  }, async (page, mock) => {
    await gate(page).getByLabel('Email', { exact: true }).fill(EMAIL)
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill(PASSWORD)
    await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
    await codeStep(page).waitFor()
    await gate(page).getByRole('button', { name: 'Kirim ulang kode', exact: true }).click()
    await waiting(page).waitFor()
    assert.equal(mock.count('POST /auth/v1/resend'), 1)
    assert.deepEqual(mock.bodies('POST /auth/v1/resend')[0], { type: 'signup', email: EMAIL })
    await waiting(page).click({ force: true, timeout: 2000 }).catch(() => undefined)
    assert.equal(mock.count('POST /auth/v1/resend'), 1, 'clicking during the cooldown sends nothing')
  })

  await scenario('"Ganti email" returns to the sign-up form with the address kept', { 'POST /auth/v1/signup': signup }, async page => {
    await signUp(page)
    await codeStep(page).waitFor()
    await gate(page).getByRole('button', { name: 'Ganti email', exact: true }).click()
    await gate(page).getByRole('heading', { name: 'Buat akun Smart Agro' }).waitFor()
    assert.equal(await gate(page).getByLabel('Email', { exact: true }).inputValue(), EMAIL)
  })

  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await browser.close()
}
