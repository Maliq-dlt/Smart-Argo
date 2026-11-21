import { generateKeyPairSync, randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const config = new URL('smart_agro/DeviceConfig.h', import.meta.url)
const example = readFileSync(new URL('smart_agro/DeviceConfig.example.h', import.meta.url), 'utf8')
const empty = 'constexpr uint8_t signingSeed[32] = {};'
const emptySetup = 'constexpr char setupPassword[] = "";'
const emptyMeter = 'constexpr uint8_t meterSeed[32] = {};'
if (!example.includes(empty)) throw new Error('DeviceConfig.example.h: initial signing seed not found')
if (!example.includes(emptySetup)) throw new Error('DeviceConfig.example.h: setup password not found')
if (!example.includes(emptyMeter)) throw new Error('DeviceConfig.example.h: meter seed not found')

// WPA2 key for the SmartAgro-xxxx setup network, printed on the device label. No 0/O or 1/I/L to misread.
const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const setup = Array.from({ length: 12 }, () => letters[randomInt(letters.length)]).join('')

// Two keys: the device key signs soil telemetry, the meter key signs energy windows (docs/energy-rewards.md).
const device = generateKeyPairSync('ed25519')
const meter = generateKeyPairSync('ed25519')
const seedOf = pair => Buffer.from(pair.privateKey.export({ format: 'jwk' }).d, 'base64url')
const publicOf = pair => Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
const literal = seed => '{' + Array.from(seed, byte => '0x' + byte.toString(16).padStart(2, '0')).join(', ') + '}'
const deviceSeed = seedOf(device)
const meterSeed = seedOf(meter)
try {
  const filled = example.replace(empty, `constexpr uint8_t signingSeed[32] = ${literal(deviceSeed)};`)
    .replace(emptyMeter, `constexpr uint8_t meterSeed[32] = ${literal(meterSeed)};`)
    .replace(emptySetup, `constexpr char setupPassword[] = "${setup}";`)
  writeFileSync(config, filled, { flag: 'wx', mode: 0o600 })
} finally {
  deviceSeed.fill(0)
  meterSeed.fill(0)
}

console.log('DeviceConfig.h created. Device Ed25519 public key (raw 32 bytes, standard Base64):')
console.log(publicOf(device))
console.log('Energy meter Ed25519 public key, for operator meter registration (then fill meterId):')
console.log(publicOf(meter))
console.log('Setup Wi-Fi password for the device label (also in DeviceConfig.h):')
console.log(setup)
