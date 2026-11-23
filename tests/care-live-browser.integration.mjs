// LOCAL SYNTHETIC owner and hardware records. Real GoTrue/PostgREST/gateway, no routed responses or physical device.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { gate } from './entry-helpers.mjs'
const config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const base = process.env.AUTH_URL || 'http://127.0.0.1:54321'
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/'
const api = async (url, token, body) => { const r = await fetch(base + url, { method: 'POST', headers: { apikey: config.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); return { status: r.status, data: await r.json() } }
const rpc = async (name, token, body = {}) => { const result = await api('/rest/v1/rpc/' + name, token, body); assert.equal(result.status, 200, name); assert.equal(result.data.ok, true, name); return result.data }
const email = `web-care-${randomUUID()}@example.test`, password = randomBytes(24).toString('base64url')
const signup = await api('/auth/v1/signup', config.anon, { email, password, data: { display_name: 'Uji web sintetis', pot: { name: 'Pot lokal sintetis', crop: 'cabai', device: true } } })
assert.equal(signup.status, 200, 'Local signup')
assert.equal(typeof signup.data.access_token, 'string', 'Local auto-confirm session')
const token = signup.data.access_token, owner = (await rpc('ensure_my_account', token)).account.id
const product = randomUUID(), unit = randomUUID(), device = randomUUID(), pair = generateKeyPairSync('ed25519')
const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: `
BEGIN;
INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('WEB-SYN-' + product.slice(0, 8))},'garden','SINTETIS web integration');
INSERT INTO ownership(account_id,product_id,start_at) VALUES(${q(owner)},${q(product)},now()-interval '1 day');
INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(publicKey)});
INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},(SELECT id FROM profile_version ORDER BY id LIMIT 1),'Unit web sintetis');
INSERT INTO device_placement(device_id,unit_id,placed_by,start_at) VALUES(${q(device)},${q(unit)},${q(owner)},now()-interval '10 minutes'); COMMIT;` })
const site = await rpc('add_my_site', token, { p_request_id: randomUUID(), p_name: 'Pot web sintetis', p_kind: 'pot', p_placement: 'indoor', p_zones: null, p_latitude: null, p_longitude: null })
await rpc('plant_in_my_slot', token, { p_request_id: randomUUID(), p_slot_id: site.slot_ids[0], p_species_id: 1, p_planted_on: new Date().toISOString().slice(0, 10), p_nickname: 'Cabai lokal sintetis' })
const payload = JSON.stringify({ domain: 'smart-agro.telemetry.v2', schema_version: 2, source: 'device', device_id: device, unit_id: unit, boot_id: randomUUID(), sequence: 1, clock_status: 'synced', measured_at: new Date().toISOString(), sensors: { moisture: { status: 'ok', value: 55 }, soil_temperature: { status: 'ok', value: 26 }, soil_ph: { status: 'not_measured', value: null } }, battery: { status: 'ok', value: 3.77 } })
const ingested = await api('/functions/v1/telemetry-ingest', config.anon, { payload, signature: sign(null, Buffer.from(payload), pair.privateKey).toString('base64') })
assert.equal(ingested.status, 200, 'Signed local synthetic telemetry accepted')
const output = path.resolve('.tmp/web-care-live'); await mkdir(output, { recursive: true })
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome', env: { ...process.env, TEMP: output, TMP: output } })
let checks = 0
const check = (value, description) => { assert(value, description); checks++ }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await page.addInitScript(({ url, anonKey }) => { globalThis.SMART_AGRO_CONFIG = { url, anonKey } }, { url: base, anonKey: config.anon })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(new URL('#pengaturan-peringatan', app).href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await gate(page).getByLabel('Email', { exact: true }).fill(email)
  await gate(page).getByLabel('Kata sandi', { exact: true }).fill(password)
  await gate(page).getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByLabel('Kirim email peringatan').waitFor()
  check(!await page.getByLabel('Kirim email peringatan').isChecked(), 'Actual local account starts opted out')
  await page.getByLabel('Kirim email peringatan').check()
  await page.getByLabel('Baterai rendah', { exact: true }).check()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Pengaturan peringatan disimpan.' }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByLabel('Kirim email peringatan').waitFor()
  check(await page.getByLabel('Kirim email peringatan').isChecked(), 'Opt-in persists after full page reload')
  check(await page.getByLabel('Baterai rendah', { exact: true }).isChecked(), 'Kind persists after full page reload')
  await page.getByLabel('Kirim email peringatan').uncheck()
  await page.getByRole('button', { name: 'Simpan pengaturan' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Pengaturan peringatan disimpan.' }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByLabel('Kirim email peringatan').waitFor()
  check(!await page.getByLabel('Kirim email peringatan').isChecked(), 'Opt-out persists after full page reload')
  check((await rpc('my_alert_preferences', token)).email_enabled === false, 'Server confirms opt-out')
  await page.evaluate(() => { location.hash = '#statistik' })
  await page.locator('.ov-card').waitFor()
  check((await page.locator('.overview').innerText()).includes('Belum ada perangkat'), 'Unassigned slot has no invented sensor reading')
  await page.locator('.ov-card').click()
  await page.getByLabel('Unit untuk tanaman ini').selectOption(unit)
  await page.getByRole('button', { name: 'Simpan hubungan unit' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Hubungan unit disimpan.' }).waitFor()
  await page.locator('.device-health').getByText('3,77 V', { exact: true }).waitFor()
  check((await rpc('my_overview', token)).plants[0].unit_id === unit, 'UI saves real slot-unit association')
  check((await page.locator('.live-care').innerText()).includes('Kelembapan: 55'), 'Plant detail reads signed synthetic local measurement')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.device-health').getByText('3,77 V', { exact: true }).waitFor()
  check(await page.getByLabel('Unit untuk tanaman ini').inputValue() === unit, 'Association persists after page reload')
  await page.getByLabel('Unit untuk tanaman ini').selectOption('')
  await page.getByRole('button', { name: 'Simpan hubungan unit' }).click()
  await page.locator('[aria-live="polite"]', { hasText: 'Hubungan unit disimpan.' }).waitFor()
  check((await rpc('my_overview', token)).plants[0].unit_id === null, 'UI can detach the unit')
  await page.screenshot({ path: path.join(output, 'unassigned-local-plant.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(`care-live-browser: ${checks} checks passed; real local Auth/RPC, synthetic owner and signed telemetry; email left disabled`)
} finally { await rpc('set_my_alert_preferences', token, { p_email_enabled: false, p_kinds: [] }); await browser.close() }
