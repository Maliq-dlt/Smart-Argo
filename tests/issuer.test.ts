import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
// @ts-expect-error: a plain .mjs script, tested through its exports
import { activationCode, publicKeyB64, signManifest, SCHEMA } from '../scripts/issuer.mjs'
import { verifyDeviceSignature } from '../supabase/functions/_shared/deviceSignature.ts'
import { issuerKeysFrom } from '../supabase/functions/product-provision/handler.ts'
import { verifyIssuerManifest } from '../src/lib/productAccountClient.ts'

const issuer = generateKeyPairSync('ed25519'), device = generateKeyPairSync('ed25519')
const pins = { 'smart-agro-test': publicKeyB64(issuer.publicKey) }
const signed = (extra = {}) => signManifest({ privateKey: issuer.privateKey, keyId: 'smart-agro-test', serial: 'SA-DEMO-0001', devicePublicKeys: [publicKeyB64(device.publicKey)], issuedAt: new Date('2026-11-16T10:00:00Z'), ...extra })

test('a signed manifest passes the edge function\'s check and the browser\'s, against the printed pin', async () => {
  const { manifest, signature } = signed()
  assert.deepEqual(issuerKeysFrom(JSON.stringify(pins)), pins, 'the printed public key is a valid pin')
  assert.equal(await verifyDeviceSignature(pins['smart-agro-test'], signature, manifest), true)
  const status = { serial_public: 'SA-DEMO-0001', variant: 'single_pot' as const, registry_status: 'active' as const, claimed: false, manifest, issuer_key_id: 'smart-agro-test', issuer_signature: signature, issuer_verified: true }
  assert.equal(await verifyIssuerManifest(status, pins), 'valid')
  assert.deepEqual(JSON.parse(manifest), { schema: SCHEMA, serial_public: 'SA-DEMO-0001', variant: 'single_pot', device_public_keys: [publicKeyB64(device.publicKey)], issued_at: '2026-11-16T10:00:00.000Z', issuer_key_id: 'smart-agro-test' })
  assert.equal(await verifyDeviceSignature(pins['smart-agro-test'], signature, manifest.replace('0001', '0002')), false, 'one changed byte breaks it')
})

test('inputs the database would refuse are refused before signing', () => {
  for (const extra of [{ keyId: 'Bad_Key' }, { serial: 'sa-lower' }, { serial: 'X' }, { variant: 'tray' }, { devicePublicKeys: [] },
    { devicePublicKeys: ['a', 'b'] }, { variant: 'garden', devicePublicKeys: Array(33).fill('k') }]) assert.throws(() => signed(extra), JSON.stringify(extra))
  assert.doesNotThrow(() => signed({ variant: 'garden', devicePublicKeys: ['a', 'b'] }))
})

test('activation codes are long enough for the form and differ each time', () => {
  const a = activationCode(), b = activationCode()
  assert.ok(a.length >= 16 && /^[A-Za-z0-9_-]+$/.test(a))
  assert.notEqual(a, b)
})
