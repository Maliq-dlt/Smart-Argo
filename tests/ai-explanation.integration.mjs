// Optional AI wording end to end: a second gateway with an explainer pointed at a local OpenAI-compatible stub
// (standing in for 9router) talks to the real local database. Needs `npm run backend:local` running.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { startGateway } from '../scripts/backend-gateway.mjs'
import { createChatExplainer } from '../src/lib/aiExplanation.ts'

const main = 'http://127.0.0.1:54321', ai = 'http://127.0.0.1:54331', settings = JSON.parse(await readFile('.tmp/phase1/settings.json', 'utf8'))
const q = v => "'" + String(v).replaceAll("'", "''") + "'"
const sql = input => execFileSync('docker', ['exec', '-i', 'smart-agro-phase1-db-1', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input, encoding: 'utf8' }).trim()
const api = async (base, path, token, body) => { const r = await fetch(base + path, { method: 'POST', headers: { apikey: settings.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); return { status: r.status, data: await r.json().catch(() => null) } }

// The stub answers like an OpenAI-compatible router; `next` selects the reply for the following call.
const calls = []
let next = { status: 200, content: JSON.stringify({ explanation: 'Media pot terbaca kering menurut sensor kelembapan terbaru, jadi aturan meminta Anda memeriksa media sebelum merawat.', answer: 'Periksa media dulu; sensor pH belum mengukur sehingga tidak dibahas.' }) }
const stub = createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part
  calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
  res.writeHead(next.status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ model: 'ag/gemini-3.8-flash-low', choices: [{ finish_reason: 'stop', message: { content: next.content } }] }))
})
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve))
const gateway = startGateway({ settings, appOrigin: 'http://127.0.0.1:5173', port: 54331, explainer: createChatExplainer({ baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: 'stub-key', timeoutMs: 5000 }) })
await new Promise(resolve => gateway.once('listening', resolve))

await test('AI wording is stored only when checked; the rule decision stays authoritative', async t => {
  const run = randomUUID().slice(0, 8), password = randomBytes(20).toString('base64url')
  const signup = await api(main, '/auth/v1/signup', null, { email: `ai-${run}@example.test`, password })
  const token = signup.data.access_token, account = (await api(main, '/rest/v1/rpc/ensure_my_account', token, {})).data.account.id
  const product = randomUUID(), unit = randomUUID(), device = randomUUID(), plant = randomUUID(), contribution = randomUUID(), version = randomUUID(), boot = randomUUID(), keys = generateKeyPairSync('ed25519')
  const raw = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
  // Synthetic protocol fixture only, as in explanations.integration.mjs.
  const profile = { pot_id: unit, crop: 'Synthetic test crop', media: 'Synthetic test medium', phase: 'Software test', validated: true, ph_validated: true, needs_water: [30, 35, 40], drained: [70, 75, 80], hot_c: 35, next_visit_h: 6, ph_range: [5.5, 7] }
  const provenance = { species_variety: `Synthetic AI ${run}`, context_scope: 'Protocol test', source_method_license: 'Synthetic software fixture', evidence_ref: 'tests/ai-explanation.integration.mjs' }
  sql(`INSERT INTO product(id,serial_public,variant,issuer_signature) VALUES(${q(product)},${q('AI-' + run)},'single_pot','software-test'); INSERT INTO device(id,product_id,public_key) VALUES(${q(device)},${q(product)},${q(raw)}); INSERT INTO ownership(product_id,account_id,start_at) VALUES(${q(product)},${q(account)},clock_timestamp()-interval '20 minutes'); INSERT INTO plant_profile(id,species_variety,context_scope) VALUES(${q(plant)},${q(provenance.species_variety)},'Protocol test'); INSERT INTO contribution(id,profile_id,author_account_id,source_method_license,evidence_ref,proposed_parameters,status) VALUES(${q(contribution)},${q(plant)},${q(account)},'Synthetic software fixture','tests/ai-explanation.integration.mjs',${q(JSON.stringify(profile))}::jsonb,'approved'); INSERT INTO profile_version(id,profile_id,contribution_id,version,parameters_and_scope,evidence_level,provenance) VALUES(${q(version)},${q(plant)},${q(contribution)},1,${q(JSON.stringify(profile))}::jsonb,'Synthetic software tests only',${q(JSON.stringify(provenance))}::jsonb); INSERT INTO unit(id,product_id,profile_version_id,location_label) VALUES(${q(unit)},${q(product)},${q(version)},'Synthetic test unit');`)
  for (const sequence of [1, 2, 3]) {
    const payload = JSON.stringify({ domain: 'smart-agro.telemetry.v2', schema_version: 2, source: 'device', device_id: device, unit_id: unit, boot_id: boot, sequence, measured_at: new Date(Date.now() - (4 - sequence) * 60000).toISOString(), clock_status: 'synced', sensors: { moisture: { status: 'ok', value: 25 }, soil_temperature: { status: 'ok', value: 28 }, soil_ph: { status: 'not_measured', value: null } } })
    assert.equal((await api(main, '/functions/v1/telemetry-ingest', null, { payload, signature: sign(null, Buffer.from(payload), keys.privateKey).toString('base64') })).status, 200)
  }
  const explain = question => api(ai, '/functions/v1/unit-explanation', token, { unit_id: unit, device_id: device, request_id: randomUUID(), question })

  await t.test('checked AI text is stored with model and prompt version; no identifiers leave the server', async () => {
    const r = await explain('Apakah perlu disiram?')
    assert.equal(r.status, 200)
    const d = r.data.snapshot.decision_payload
    assert.equal(d.source_mode, 'ai_explained'); assert.equal(d.ai_status, 'ok'); assert.equal(d.decision, 'PERIKSA_MEDIA_KERING')
    assert.equal(d.ai.model, 'ag/gemini-3.8-flash-low'); assert.equal(d.ai.prompt_version, 'smart-agro.explain.v1'); assert.match(d.ai.answer, /Periksa media/)
    assert.match(sql(`SELECT model_prompt_version FROM ai_snapshot WHERE id=${q(r.data.snapshot.id)}`), /ag\/gemini-3\.8-flash-low smart-agro\.explain\.v1/)
    const call = calls.at(-1)
    assert.equal(call.path, '/v1/chat/completions'); assert.equal(call.auth, 'Bearer stub-key'); assert.equal(call.body.model, 'ag/gemini-3.8-flash-low')
    const sent = JSON.stringify(call.body)
    for (const id of [unit, device, product, account, signup.data.user.id]) assert.equal(sent.includes(id), false, 'No identifier in the prompt')
  })

  await t.test('dose advice or a failing router keeps the rule explanation, labelled with the reason', async () => {
    next = { status: 200, content: JSON.stringify({ explanation: 'Tambahkan 250 ml air dan 5 gram pupuk sekarang agar tanaman segera pulih.', answer: null }) }
    let d = (await explain('')).data.snapshot.decision_payload
    assert.equal(d.source_mode, 'rule_fallback'); assert.equal(d.ai_status, 'rejected'); assert.equal(d.ai, undefined)
    next = { status: 500, content: '' }
    d = (await explain('')).data.snapshot.decision_payload
    assert.equal(d.source_mode, 'rule_fallback'); assert.equal(d.ai_status, 'failed')
  })

  await t.test('the database refuses an AI label without model and prompt version', async () => {
    const context = (await api(main, '/rest/v1/rpc/unit_explanation_context', token, { p_unit_id: unit, p_device_id: device })).data
    const session = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).session_id
    const forged = { decision: 'AMATI', action: 'x', reason: 'x', mascot_state: 'tenang_senang', explanation: 'x', source_mode: 'ai_explained', rule_version: 'agronomy-v1.telemetry-v1', ai_status: 'ok', ai: { explanation: 'tanpa model' } }
    const r = await api(main, '/rest/v1/rpc/save_unit_explanation', settings.service, { p_auth_user_id: signup.data.user.id, p_session_id: session, p_context: context, p_result: forged, p_request_id: randomUUID(), p_question: '' })
    assert.equal(r.data.code, 'context_changed')
  })
})
gateway.close(); stub.close()
