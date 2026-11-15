// The display name in Profil › Akun: shown from the token (the name the person chose, else the Google name), changed
// in place, validated, and a forged oversized name in the token never reaches the screen. Mocked Auth (no Docker).
// Needs the local build served (`npm run build && npx vite preview --port 4173`) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { gate } from './entry-helpers.mjs'
import { mockAuth, mockSession } from './mock-auth.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#masuk'
const POT = { name: 'Pot teras', crop: 'cabai', device: false }
const browser = await chromium.launch({ channel: 'chrome' })
const checks = []

async function scenario(name, startMeta, run) {
  let meta = startMeta
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  const mock = await mockAuth(page, {
    'POST /auth/v1/token?grant_type=password': () => mockSession(meta),
    'POST /auth/v1/token?grant_type=refresh_token': () => mockSession(meta),
    'PUT /auth/v1/user': request => { meta = { ...meta, ...request.postDataJSON().data }; return { id: 'x', user_metadata: meta } },
  })
  try {
    await page.goto(app)
    await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
    await gate(page).getByLabel('Email', { exact: true }).fill('pot@contoh.test')
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill('cukup-panjang-12')
    await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
    await page.locator('.app-shell').waitFor({ timeout: 20000 })
    await page.evaluate(() => { location.hash = '#profil' })
    await page.getByRole('navigation', { name: 'Bagian profil' }).waitFor()
    await run(page, mock)
    checks.push(name)
  } finally { await page.close() }
}
const account = page => page.locator('.profile-account')

try {
  await scenario('the Google name shows until the person chooses their own, which is saved cleaned and shown everywhere', { full_name: 'Nama Google', pot: POT }, async (page, mock) => {
    await account(page).getByText('Nama Google', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Akun: Nama Google' }).waitFor()
    await account(page).getByRole('button', { name: 'Ubah nama', exact: true }).click()
    await account(page).getByLabel('Nama', { exact: true }).fill('  Maliq   A ')
    await account(page).getByRole('button', { name: 'Simpan', exact: true }).click()
    await account(page).getByText('Maliq A', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Akun: Maliq A' }).waitFor()
    assert.deepEqual(mock.bodies('PUT /auth/v1/user').at(-1), { data: { display_name: 'Maliq A' } })
  })

  await scenario('a name over 40 characters is refused with a message and nothing is saved', { full_name: 'Nama Google', pot: POT }, async (page, mock) => {
    await account(page).getByRole('button', { name: 'Ubah nama', exact: true }).click()
    await account(page).getByLabel('Nama', { exact: true }).fill('x'.repeat(41))
    await account(page).getByRole('button', { name: 'Simpan', exact: true }).click()
    await account(page).getByRole('alert').filter({ hasText: 'Nama harus 1–40 karakter.' }).waitFor()
    assert.equal(mock.count('PUT /auth/v1/user'), 0)
    await account(page).getByRole('button', { name: 'Batal', exact: true }).click()
    await account(page).getByText('Nama Google', { exact: true }).waitFor()
  })

  await scenario('a forged oversized display_name in the token falls back to the Google name', { display_name: 'x'.repeat(2000), full_name: 'Nama Google', pot: POT }, async page => {
    await account(page).getByText('Nama Google', { exact: true }).waitFor()
    assert.equal(await page.getByText('xxxxxxxxxx').count(), 0)
  })

  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await browser.close()
}
