import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const config = new URL('smart_agro/DeviceConfig.h', import.meta.url)
const example = readFileSync(new URL('smart_agro/DeviceConfig.example.h', import.meta.url), 'utf8')
const empty = 'constexpr uint8_t signingSeed[32] = {};'
if (!example.includes(empty)) throw new Error('DeviceConfig.example.h: initial signing seed not found')

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url')
const bytes = Array.from(seed, byte => '0x' + byte.toString(16).padStart(2, '0'))
try {
  writeFileSync(config, example.replace(empty, 'constexpr uint8_t signingSeed[32] = {' + bytes.join(', ') + '};'), {
    flag: 'wx', mode: 0o600,
  })
} finally {
  seed.fill(0)
}

const rawPublicKey = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')
console.log('DeviceConfig.h created. Ed25519 public key (raw 32 bytes, standard Base64):')
console.log(rawPublicKey.toString('base64'))
