// Care journal and sensor history for an owned unit (docs/care-history-api.md), against a mocked backend (no Docker):
// the journal loads empty, a failed save is retried with the same request id, the entry appears, the two weeks are
// compared with null kept as "—", and the CSV downloads for an inclusive date range.
// Needs the local build served (`npm run build && npx vite preview --port 4173`) and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ecosystemTab } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#ekosistem'
const auth = process.env.AUTH_URL || 'http://127.0.0.1:54321'
const shots = process.env.SHOTS_DIR
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const user = '6f1d2c4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f', pot = { name: 'Pot teras', crop: 'cabai', device: true }
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user, email: 'kebun@contoh.test', exp: Math.floor(Date.now() / 1000) + 3600, aal: 'aal1', app_metadata: { providers: ['email'] }, user_metadata: { pot } })}.sig`
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const unit = { unit_id: id(10), product_id: id(11), serial_public: 'SA-0001', location_label: 'Teras', device_id: id(12), device_status: 'active', profile_version_id: id(13) }

const browser = await chromium.launch({ channel: 'chrome' })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-history-row-count' }
const journal = [], appends = [], exports = []
let failNext = true
const checks = []
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const page = await browser.newPage({ viewport, acceptDownloads: true })
    await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [`smart-agro.account:${auth}`, JSON.stringify({ access_token: token, refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600 })])
    await page.route(`${auth}/**`, async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const json = (body, status = 200) => route.fulfill({ status, headers: cors, json: body })
      const body = request.method() === 'POST' ? request.postDataJSON() ?? {} : {}
      if (path === '/auth/v1/settings') return json({ external: { google: false, email: true } })
      if (path === '/auth/v1/user') return json({ id: user, email: 'kebun@contoh.test', factors: [], user_metadata: { pot } })
      if (path.endsWith('/my_products')) return json({ products: [{ ownership_id: id(14), product_id: unit.product_id, serial_public: unit.serial_public, variant: 'single_pot', start_at: '2026-11-01T00:00:00.000Z' }] })
      if (path.endsWith('/my_device_units')) return json({ units: [unit] })
      if (path.endsWith('/published_profile_versions')) return json({ profiles: [] })
      if (path.endsWith('/unit_measurements')) return json({ readings: [] })
      if (path.endsWith('/unit_explanations')) return json({ snapshots: [] })
      if (path.endsWith('/read_my_care_journal')) return json({ ok: true, entries: [...journal].reverse(), snapshot_as_of: new Date().toISOString(), next_cursor: null })
      if (path.endsWith('/append_my_care_journal')) {
        appends.push(body)
        if (failNext) { failNext = false; return json({ ok: false, code: 'upstream_unavailable', message: 'Upstream unavailable' }, 503) }
        const entry = { id: id(100 + journal.length), unit_id: unit.unit_id, kind: body.p_kind, observed_at: body.p_observed_at, created_at: new Date().toISOString(), amount_ml: body.p_amount_ml, notes: body.p_notes }
        journal.push(entry)
        return json({ ok: true, entry, idempotent: false })
      }
      if (path.endsWith('/compare_my_measurement_history')) return json({ ok: true, sensors: [
        { sensor_id: 'moisture', first: { avg: 58, eligible_count: 300 }, second: { avg: 61.5, eligible_count: 320 }, avg_delta: 3.5 },
        { sensor_id: 'soil_ph', first: { avg: null, eligible_count: 0 }, second: { avg: 6.4, eligible_count: 12 }, avg_delta: null }] })
      if (path === '/functions/v1/history-export') { exports.push(body); return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/csv; charset=utf-8', 'x-history-row-count': '3' }, body: '﻿id,unit_id\r\n' }) }
      return json({ ok: true })
    })
    await page.goto(app)
    await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
    await ecosystemTab(page, 'Unit & sensor')
    const panel = page.getByRole('region', { name: 'Data perangkat tersimpan', exact: true })
    await panel.getByRole('combobox', { name: 'Unit & perangkat milik saya', exact: true }).click()
    await page.locator(`[role=option][data-value="${unit.unit_id}:${unit.device_id}"]`).click()
    const care = panel.getByRole('region', { name: 'Jurnal perawatan', exact: true })
    // Results show right after the control that caused them (the hidden live region repeats them for screen readers).
    const shown = (after, text) => care.locator(`${after} + p[aria-hidden="true"]`, { hasText: text }).waitFor()
    const wide = viewport.width > 600

    if (wide) {
      await care.getByText('Belum ada catatan dalam 31 hari terakhir.').waitFor()
      checks.push('journal loads empty')
      await care.getByLabel('Air (ml)').fill('250')
      await care.getByLabel('Catatan (opsional)').fill('Media kering di permukaan')
      await care.getByRole('button', { name: 'Simpan catatan' }).click()
      await shown('form', 'Upstream unavailable')
      await care.getByRole('button', { name: 'Simpan catatan' }).click()
      await shown('form', 'Catatan tersimpan.')
      assert.equal(appends.length, 2)
      assert.equal(appends[0].p_request_id, appends[1].p_request_id, 'a retry keeps its request id')
      assert.equal(appends[0].p_observed_at, appends[1].p_observed_at, 'a retry keeps its payload')
      assert.equal(appends[1].p_amount_ml, 250)
      await care.getByRole('list', { name: 'Catatan perawatan' }).getByText('Siram 250 ml').waitFor()
      checks.push('failed save retried with the same request id, entry listed')
    } else await care.getByText('Siram 250 ml').waitFor()

    await care.getByRole('button', { name: 'Bandingkan dengan minggu lalu' }).click()
    const table = care.getByRole('table')
    await table.getByRole('rowheader', { name: 'pH tanah' }).waitFor()
    const ph = await table.getByRole('row').filter({ hasText: 'pH tanah' }).innerText()
    assert.match(ph, /—/, 'missing week stays —, not 0')
    assert.match(await table.getByRole('row').filter({ hasText: 'Kelembapan' }).innerText(), /\+3,5/)
    if (wide) checks.push('weeks compared, null shown as —')

    const download = page.waitForEvent('download')
    await care.getByRole('button', { name: 'Unduh CSV' }).click()
    assert.match((await download).suggestedFilename(), /^smart-agro-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/)
    await shown('form:has(input[type=date])', '3 bacaan diunduh.')
    const last = exports.at(-1)
    assert.match(last.from, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    assert.equal(Date.parse(last.to) - Date.parse(last.from), 7 * 86400000, 'seven inclusive days')
    if (wide) checks.push('CSV downloaded for 7 inclusive days')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert.ok(overflow <= 0, `no horizontal scroll at ${viewport.width}px (${overflow}px)`)
    checks.push(`no horizontal scroll at ${viewport.width}px`)
    if (shots) for (const theme of ['light', 'dark']) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
      await page.waitForTimeout(500) // let the colour transitions finish, or the shot catches a half-switched theme
      await care.screenshot({ path: `${shots}/care-${viewport.width}-${theme}.png` })
    }
    await page.close()
  }
  console.log(`care-history-browser: ${checks.length} checks passed\n- ${checks.join('\n- ')}`)
} finally {
  await browser.close()
}
