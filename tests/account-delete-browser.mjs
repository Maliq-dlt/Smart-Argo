// Profile photo and account deletion on the web (plan 2026-11-22, phase 2): the photo is cropped and sent as WebP, the
// deletion takes four steps with re-verification, an account inside its grace period sees only the way back, and
// #hapus-akun survives signing in. Mocked Auth (no Docker). Needs the build served on 4173 and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { crc32, deflateSync } from 'node:zlib'
import { gate } from './entry-helpers.mjs'
import { mockAuth, mockSession } from './mock-auth.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const POT = { name: 'Pot teras', crop: 'cabai', device: false }
const PRODUCT = { ownership_id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed', product_id: '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b', serial_public: 'SA-POT-0001', variant: 'single_pot', start_at: '2026-11-01T00:00:00+00:00' }
const PENDING = { pending: true, requested_at: '2026-11-22T04:00:00+00:00', purge_after: '2026-12-06T04:00:00+00:00', released: ['SA-POT-0001'], restorable: ['SA-POT-0001'] }
// A 4×3 PNG drawn here (not wider than tall, so the crop matters), re-encoded by the page.
function png(width, height) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4); return out }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.from([0, ...Array.from({ length: width }, (_, x) => [x * 60, y * 80, 120]).flat()])))
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
const PNG = png(4, 3)
const browser = await chromium.launch({ channel: 'chrome' })
const checks = []

async function scenario(name, { hash = '#masuk', routes = {} } = {}, run) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const mock = await mockAuth(page, {
    'POST /auth/v1/token?grant_type=password': () => mockSession({ pot: POT }),
    'POST /auth/v1/token?grant_type=refresh_token': () => mockSession({ pot: POT }),
    'POST /rest/v1/rpc/my_products': () => ({ products: [PRODUCT] }),
    ...routes,
  })
  try {
    await page.goto(base + hash)
    await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
    await gate(page).getByLabel('Email', { exact: true }).fill('pot@contoh.test')
    await gate(page).getByLabel('Kata sandi', { exact: true }).fill('cukup-panjang-12')
    await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
    await run(page, mock)
    assert.deepEqual(errors, [])
    checks.push(name)
  } finally { await page.close() }
}

try {
  await scenario('a picked photo is cropped, sent as WebP, shown in Profil and the account menu, and can be removed', {}, async (page, mock) => {
    await page.locator('.app-shell').waitFor({ timeout: 20000 })
    await page.evaluate(() => { location.hash = '#profil' })
    const editor = page.locator('.avatar-editor')
    await editor.getByRole('img', { name: 'Inisial pot' }).waitFor()
    await editor.locator('input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
    await editor.getByText('Foto profil disimpan.').waitFor()
    const sent = mock.bodies('POST /rest/v1/rpc/set_my_avatar').at(-1)
    assert.equal(sent.p_mime, 'image/webp')
    assert.ok(Buffer.from(sent.p_data, 'base64').subarray(8, 12).toString() === 'WEBP', 'real WebP bytes')
    await editor.getByRole('img', { name: 'Foto profil pot' }).waitFor()
    assert.equal(await page.locator('.account-trigger img.account-photo').count(), 1)
    await editor.getByRole('button', { name: 'Hapus foto' }).click()
    await editor.getByText('Foto dihapus. Inisial dipakai lagi.').waitFor()
    assert.equal(mock.count('POST /rest/v1/rpc/clear_my_avatar'), 1)
    assert.equal(await page.locator('.account-trigger img').count(), 0)
  })

  await scenario('deleting takes four steps, verifies the password again, and ends signed out', {
    routes: { 'POST /rest/v1/rpc/request_account_deletion': () => ({ ok: true, idempotent: false, deletion: PENDING }) },
  }, async (page, mock) => {
    await page.locator('.app-shell').waitFor({ timeout: 20000 })
    await page.evaluate(() => { location.hash = '#profil' })
    await page.locator('.profile-account').getByRole('link', { name: 'Hapus akun' }).click()
    const panel = page.locator('.delete-account')
    await panel.getByRole('heading', { name: 'Sebelum menghapus akun' }).waitFor()
    await panel.getByText('SA-POT-0001').waitFor()
    await panel.getByRole('button', { name: 'Lanjutkan' }).click()
    await panel.getByRole('heading', { name: 'Pastikan ini Anda' }).waitFor()
    const signIns = mock.count('POST /auth/v1/token')
    await panel.getByLabel('Kata sandi').fill('cukup-panjang-12')
    await panel.getByRole('button', { name: 'Verifikasi' }).click()
    await panel.getByRole('heading', { name: 'Hapus akun pot?' }).waitFor()
    assert.equal(mock.count('POST /auth/v1/token'), signIns + 1, 'the password was checked by signing in again')
    assert.equal(mock.count('POST /rest/v1/rpc/request_account_deletion'), 0, 'nothing is deleted before the last step')
    await panel.getByRole('button', { name: 'Hapus akun' }).click()
    await panel.getByRole('heading', { name: 'Akun dijadwalkan dihapus' }).waitFor()
    await panel.getByText('6 Desember 2026', { exact: false }).waitFor()
    await panel.getByRole('button', { name: 'Selesai' }).click()
    await gate(page).waitFor()
  })

  let deleted = true
  await scenario('an account inside its grace period sees only the way back, and cancelling opens the app', {
    routes: {
      'POST /rest/v1/rpc/my_account_deletion': () => ({ ok: true, deletion: deleted ? PENDING : { pending: false }, products: [] }),
      'POST /rest/v1/rpc/cancel_account_deletion': () => { deleted = false; return { ok: true, restored: ['SA-POT-0001'], lost: 0 } },
    },
  }, async (page, mock) => {
    const pending = page.getByRole('main', { name: 'Akun dijadwalkan dihapus' })
    await pending.getByRole('heading', { name: 'Akun ini dijadwalkan dihapus' }).waitFor({ timeout: 20000 })
    await pending.getByText('6 Desember 2026', { exact: false }).waitFor()
    await pending.getByText('Produk SA-POT-0001 kembali ke akun ini bila dibatalkan.').waitFor()
    assert.equal(mock.count('POST /rest/v1/rpc/ensure_my_account'), 0, 'no other call while the account is inactive')
    assert.equal(mock.count('POST /rest/v1/rpc/my_garden'), 0)
    await pending.getByRole('button', { name: 'Batalkan penghapusan' }).click()
    await page.locator('.app-shell').waitFor({ timeout: 20000 })
    assert.equal(mock.count('POST /rest/v1/rpc/cancel_account_deletion'), 1)
  })

  await scenario('#hapus-akun asks to sign in first and opens again afterwards', { hash: '#hapus-akun' }, async page => {
    await page.locator('.delete-account').getByRole('heading', { name: 'Sebelum menghapus akun' }).waitFor({ timeout: 20000 })
    assert.equal(new URL(page.url()).hash, '#hapus-akun')
  })

  console.log(`account-delete-browser: ${checks.length} skenario lolos\n- ${checks.join('\n- ')}`)
} finally { await browser.close() }
