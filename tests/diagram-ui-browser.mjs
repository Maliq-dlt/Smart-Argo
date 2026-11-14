// The owner and operator screens for the Miro gap work (2026-11-14), against the real local backend (gateway, Auth,
// PostgREST, PostgreSQL): unit overview and management (APP-02/03), care journal without notes (APP-04), reward
// appeals panel (RW-04), ownership recovery and proofs (ID-03, A08), recovery codes (APP-01) and the operator section.
// Needs `node .tmp/gateway-claude.mjs` (or npm run backend:local), the build served on 4173, and PLAYWRIGHT_MODULE.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { signIn, ecosystemTab, profileSection } from './entry-helpers.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright')
const app = process.env.TEST_URL || 'http://127.0.0.1:4173/#masuk'
const config = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = v => "'" + String(v).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8' }).trim()
const run = randomUUID().slice(0, 8), email = `diagram-${run}@example.test`, password = randomBytes(18).toString('base64url')
const checks = []
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('dialog', dialog => void dialog.accept())
try {
  await page.goto(app)
  await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
  await signIn(page, email, password, { signup: true })
  const account = sql(`SELECT a.id FROM account a JOIN auth.users u ON u.id=a.auth_user_id WHERE u.email=${q(email)}`)
  // A garden product with one device and a unit that has a reading with a failed sensor.
  const product = randomUUID(), device = randomUUID(), profile = randomUUID(), contribution = randomUUID(), version = randomUUID(), unit = randomUUID(), other = randomUUID()
  const keys = generateKeyPairSync('ed25519'), publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},'UI-${run.toUpperCase()}','garden','synthetic DB test'),(${q(other)},'LOST-${run.toUpperCase()}','single_pot','synthetic DB test');
    INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(publicKey)});
    INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(product)},${q(account)},clock_timestamp()-interval '1 day');
    INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(profile)},'Cabai uji ${run}','Synthetic fixture');
    INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(profile)},${q(account)},'Test-only','local://ui','{}','approved');
    INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level) VALUES(${q(version)},${q(profile)},${q(contribution)},1,'{}','synthetic');
    INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},${q(version)},'Bedeng uji');`)
  const payload = JSON.stringify({ domain: 'smart-agro.telemetry.v2', schema_version: 2, source: 'device', device_id: device, unit_id: unit, boot_id: randomUUID(), sequence: 1, measured_at: new Date().toISOString(), clock_status: 'synced', sensors: { moisture: { status: 'ok', value: 47 }, soil_temperature: { status: 'error', value: null, error: 'Probe disconnected' }, soil_ph: { status: 'not_measured', value: null } } })
  const ingest = await fetch('http://127.0.0.1:54321/rest/v1/rpc/ingest_verified_telemetry', { method: 'POST', headers: { apikey: config.anon, Authorization: `Bearer ${config.service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_payload: payload, p_public_key: publicKey, p_signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') }) })
  assert.equal((await ingest.json()).ok, true)

  await ecosystemTab(page, 'Unit & sensor')
  const overview = page.getByRole('region', { name: 'Kondisi unit', exact: true })
  const card = overview.getByRole('listitem').filter({ hasText: 'Bedeng uji' }).first()
  await card.getByText('Sensor galat').waitFor({ timeout: 20000 })
  assert.match(await card.innerText(), /47\/100/)
  checks.push('overview shows the latest reading and the sensor alert')
  await card.getByText('Kelola unit').click()
  await card.getByLabel('Nama', { exact: true }).fill('Bedeng cabai')
  await card.getByRole('button', { name: 'Simpan nama' }).click()
  await overview.getByRole('listitem').filter({ hasText: 'Bedeng cabai' }).first().waitFor()
  checks.push('rename saved through the server')

  // Care journal on the real contract: a watering entry without notes (p_notes '' and notes '' back).
  const telemetry = page.getByRole('region', { name: 'Data perangkat tersimpan', exact: true })
  await telemetry.getByRole('combobox', { name: 'Unit & perangkat milik saya', exact: true }).click()
  await page.locator(`[role=option][data-value="${unit}:${device}"]`).click()
  const care = telemetry.getByRole('region', { name: 'Jurnal perawatan', exact: true })
  await care.getByRole('button', { name: 'Simpan catatan' }).click()
  await care.getByRole('list', { name: 'Catatan perawatan' }).getByText('Siram 200 ml').waitFor({ timeout: 15000 })
  checks.push('journal entry without notes saved and listed (real backend)')
  // APP-06 paged history on the real contract: the ingested packet, the failed sensor kept as an error, not zero.
  await care.getByRole('button', { name: 'Tampilkan bacaan' }).click()
  const listed = care.getByRole('list', { name: 'Bacaan dalam rentang' })
  await listed.getByText('Kelembapan (0–100): 47').waitFor({ timeout: 15000 })
  await listed.getByText('Suhu tanah (°C): Galat: Probe disconnected').waitFor()
  checks.push('paged sensor history for a date range (real backend)')

  const managed = overview.getByRole('listitem').filter({ hasText: 'Bedeng cabai' }).first()
  await managed.getByRole('button', { name: 'Arsipkan' }).click()
  await overview.getByText('Unit diarsipkan (1)').waitFor()
  await overview.getByText('Unit diarsipkan (1)').click()
  await overview.getByRole('button', { name: 'Pulihkan' }).click()
  await overview.getByRole('listitem').filter({ hasText: 'Bedeng cabai' }).first().getByText('Kelola unit').waitFor()
  checks.push('archive and restore')

  await ecosystemTab(page, 'Energi & reward')
  await page.getByRole('region', { name: 'Keberatan dan peninjauan', exact: true }).getByText('Belum ada pengajuan.').waitFor({ timeout: 15000 })
  checks.push('appeals panel loads')

  await profileSection(page, 'Produk')
  const recovery = page.getByRole('region', { name: 'Pulihkan kepemilikan', exact: true })
  await recovery.getByLabel('Serial produk').fill(`lost-${run}`)
  await recovery.getByLabel('Kronologi').fill('Pot ini saya beli bulan lalu, lalu akun lama saya hilang.')
  await recovery.getByLabel('Rujukan bukti 1').fill('INV-UI-1')
  await recovery.getByRole('button', { name: 'Kirim permintaan' }).click()
  await recovery.getByRole('list', { name: 'Permintaan pemulihan saya' }).getByText(/Menunggu operator/).waitFor({ timeout: 15000 })
  assert.equal(sql(`SELECT evidence->0->>'reference' FROM ownership_recovery_case WHERE claimant_account_id=${q(account)}`), 'INV-UI-1')
  await page.getByRole('region', { name: 'Bukti blockchain kepemilikan', exact: true }).getByText('Belum ada bukti.').waitFor()
  checks.push('ownership recovery request with evidence; proofs panel')

  await profileSection(page, 'Keamanan')
  const codes = page.getByRole('region', { name: 'Kode pemulihan', exact: true })
  await codes.getByText('Belum ada kode pemulihan.').waitFor()
  await codes.getByRole('button', { name: 'Buat kode pemulihan' }).click()
  await codes.locator('p[aria-hidden="true"]', { hasText: 'memerlukan 2FA' }).waitFor()
  checks.push('recovery codes ask for 2FA first')

  assert.equal(await page.getByRole('navigation', { name: 'Bagian profil' }).getByRole('button', { name: 'Operator' }).count(), 0)
  sql(`UPDATE account SET access_roles=ARRAY['owner','operator'] WHERE id=${q(account)}`)
  await page.reload()
  await page.waitForFunction(() => { const c = document.querySelector('.curtain'); return !c || c.dataset.state === 'open' })
  await profileSection(page, 'Operator')
  // Without 2FA the server refuses every operator call, so the section explains the lock instead of failing tabs.
  await page.getByRole('region', { name: 'Operator', exact: true }).getByText('Alat operator terbuka setelah 2FA aktif', { exact: false }).waitFor()
  await ecosystemTab(page, 'Energi & reward')
  await page.getByText('Alat operator terbuka setelah 2FA aktif. Aktifkan di Profil → Keamanan.').waitFor()
  checks.push('operator section only for operators; without 2FA it explains the lock')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  assert.ok(overflow <= 0, `no horizontal scroll (${overflow}px)`)
  console.log(`diagram-ui-browser: ${checks.length} checks passed\n- ${checks.join('\n- ')}`)
} finally {
  await browser.close()
}
