// The issuer's side of ID-04: a key pair whose public half is pinned in ISSUER_PUBLIC_KEYS (server) and
// VITE_ISSUER_PUBLIC_KEYS (browser), and signed manifests that an operator pastes into "Daftarkan produk dari manifest".
// The private key and every unit's secrets stay in .tmp/cloud/issuer/ (ignored by Git) and are never printed.
//
//   node scripts/issuer.mjs keygen <key-id>                          new issuer key; prints the public JSON for the pins
//   node scripts/issuer.mjs sign <key-id> <SERIAL> [single_pot|garden] [devices]
//                                                                    new device keys + activation code + signed manifest
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const SCHEMA = 'smart-agro.product-manifest.v1'
const KEY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/
const SERIAL = /^[A-Z0-9][A-Z0-9._-]{2,119}$/

/** Raw 32-byte Ed25519 public key in standard base64 (44 characters), the form the pins and the database use. */
export const publicKeyB64 = key => Buffer.from(key.export({ format: 'jwk' }).x, 'base64url').toString('base64')

/** The exact manifest text and its issuer signature. Rules mirror operator_provision_product, so a bad input fails here. */
export function signManifest({ privateKey, keyId, serial, variant = 'single_pot', devicePublicKeys, issuedAt = new Date() }) {
  if (!KEY_ID.test(keyId)) throw new Error('key id: lowercase letters, digits and dashes, 3 to 64 characters')
  if (!SERIAL.test(serial)) throw new Error('serial: capital letters, digits, dot, dash or underscore, 3 to 120 characters')
  if (!['single_pot', 'garden'].includes(variant)) throw new Error('variant: single_pot or garden')
  if (devicePublicKeys.length < 1 || devicePublicKeys.length > 32 || (variant === 'single_pot' && devicePublicKeys.length !== 1)) throw new Error('a single pot has one device; a garden has 1 to 32')
  const manifest = JSON.stringify({ schema: SCHEMA, serial_public: serial, variant, device_public_keys: devicePublicKeys, issued_at: issuedAt.toISOString(), issuer_key_id: keyId })
  return { manifest, signature: sign(null, Buffer.from(manifest), privateKey).toString('base64') }
}

/** What goes on the packaging: 20 characters from 15 random bytes, well over the 16 the form asks for. */
export const activationCode = () => randomBytes(15).toString('base64url')

const dir = '.tmp/cloud/issuer'
const keyFile = id => `${dir}/${id}.pem`
const writeNew = (path, text) => { if (existsSync(path)) throw new Error(`${path} exists; refusing to overwrite it`); writeFileSync(path, text, { mode: 0o600 }) }

function main([command, keyId, serial, variant = 'single_pot', count = '1']) {
  if (!keyId || !KEY_ID.test(keyId)) throw new Error('Usage: node scripts/issuer.mjs keygen <key-id> | sign <key-id> <SERIAL> [variant] [devices]')
  mkdirSync(`${dir}/units`, { recursive: true })
  if (command === 'keygen') {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    writeNew(keyFile(keyId), privateKey.export({ type: 'pkcs8', format: 'pem' }))
    console.log(`Private key: ${keyFile(keyId)} (keep it offline; back it up).`)
    console.log(`Pin this public key as ISSUER_PUBLIC_KEYS and VITE_ISSUER_PUBLIC_KEYS:\n${JSON.stringify({ [keyId]: publicKeyB64(publicKey) })}`)
    return
  }
  if (command !== 'sign') throw new Error(`Unknown command ${command}`)
  const devices = Array.from({ length: Number(count) }, () => generateKeyPairSync('ed25519'))
  const signed = signManifest({ privateKey: createPrivateKey(readFileSync(keyFile(keyId))), keyId, serial, variant, devicePublicKeys: devices.map(d => publicKeyB64(d.publicKey)) })
  const unitFile = `${dir}/units/${serial}.json`
  writeNew(unitFile, JSON.stringify({ ...signed, activation_code: activationCode(),
    devices: devices.map(d => ({ public_key: publicKeyB64(d.publicKey), private_key_pem: d.privateKey.export({ type: 'pkcs8', format: 'pem' }) })) }, null, 2))
  console.log(`Signed ${serial}. Manifest, signature and the activation code for the operator form are in ${unitFile}`)
  console.log('(the device private keys are there too: they belong in the device, nowhere else).')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
