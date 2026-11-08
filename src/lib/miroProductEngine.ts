import { evaluate, parseCase, type Decision, type Profile } from './agronomyEngine.ts'

export type AccessRole = 'owner' | 'contributor' | 'curator' | 'operator'
export type ProductVariant = 'single_pot' | 'garden'
export type RegistryStatus = 'active' | 'revoked' | 'pending'
export type MascotState = 'tenang_senang' | 'sedih_perhatian' | 'waspada_marah' | 'bingung_menunggu'

export interface Account {
  id: string
  authSubject: string
  displayName: string
  roles: AccessRole[]
}

export interface Product {
  id: string
  serialPublic: string
  variant: ProductVariant
  registryStatus: RegistryStatus
  issuerSignature: string
  revokedReason?: string
}

export interface Activation {
  productId: string
  secretHash: string
  consumedBy: string | null
  consumedAt: string | null
  failedAttempts: number
}

export interface ActivationNonce {
  id: string
  token: string
  accountId: string
  productId: string
  sessionId: string
  expiresAtMs: number
  usedAtMs: number | null
}

export interface Ownership {
  id: string
  productId: string
  accountId: string
  startAt: string
  endAt: string | null
}

export interface Device {
  id: string
  productId: string
  publicKey: string
  status: 'active' | 'revoked' | 'offline'
}

export interface ProductUnit {
  id: string
  productId: string
  profileVersionId: string
  locationLabel: string
}

export interface DeviceMeasurement {
  id: string
  deviceId: string
  unitId: string
  deviceBootSeqSensor: string
  sensorId: 'moisture' | 'soil_temperature' | 'soil_ph'
  source: 'device' | 'simulation'
  qualityStatus: 'ok' | 'error' | 'not_measured'
  valueNullable: number | null
  measuredAt: string
  receivedAt: string
}

export interface AiSnapshotRecord {
  id: string
  unitId: string
  profileVersionId: string
  evidenceRef: string
  decisionAndState: string
  mascotState: MascotState
  modelPromptVersion: string
  explanation: string
  sourceMode: 'ai_verified' | 'rule_fallback'
  createdAt: string
}

export interface EnergyWindow {
  id: string
  deviceId: string
  bootId: string
  startAt: string
  endAt: string
  startAtMs: number
  endAtMs: number
  solarHarvestWh: number
  loadWh: number
  batterySocPct: number
  evidenceQuality: 'verified_meter' | 'simulated' | 'unverified'
}

export interface RewardEvent {
  id: string
  accountId: string
  energyWindowId: string | null
  sourceEventKey: string
  policyVersion: string
  verificationStatus: 'verified' | 'rejected_simulation' | 'rejected_duplicate' | 'flagged_anomaly'
  points: number
}

export interface LedgerEntry {
  id: string
  accountId: string
  rewardEventId: string | null
  redemptionId: string | null
  signedPoints: number
  idempotencyKey: string
  note: string
  createdAt: string
}

export interface CatalogItem {
  id: string
  title: string
  category: string
  pointCost: number
  stockTotal: number
  stockReserved: number
  availability: 'available' | 'out_of_stock' | 'disabled'
}

export interface Redemption {
  id: string
  accountId: string
  catalogItemId: string
  reservedPoints: number
  status: 'reserved' | 'fulfilled' | 'cancelled' | 'compensated'
  idempotencyKey: string
  createdAt: string
}

export interface PlantProfileEntity {
  id: string
  speciesVariety: string
  contextScope: string
}

export interface Contribution {
  id: string
  profileId: string
  authorAccountId: string
  sourceMethodLicense: string
  evidenceRef: string
  proposedParameters: Profile
  notes: string
  status: 'pending_review' | 'needs_revision' | 'approved' | 'rejected'
  revisionCount: number
  updatedAt: string
}

export interface ReviewRecord {
  id: string
  contributionId: string
  reviewerAccountId: string
  decision: 'approved' | 'needs_revision' | 'rejected'
  decisionReason: string
  reviewedAt: string
}

export interface ProfileVersion {
  id: string
  profileId: string
  contributionId: string
  version: number
  parametersAndScope: Profile
  evidenceLevel: string
  publishedAt: string
}

export interface OutboxJob {
  id: string
  eventKey: string
  kind: 'product_manifest' | 'ownership_claim' | 'ledger_anchor'
  artifactBytes: string
  artifactSha256: string
  status: 'pending' | 'confirmed' | 'failed'
  chainId: string
  contractAddress: string
  issuerSigner: string
  txHash: string | null
  blockNumber: number | null
  attempts: number
  lastError: string | null
  updatedAt: string
}

export interface EcosystemState {
  version: 1
  activeAccountId: string
  accounts: Account[]
  products: Product[]
  activations: Record<string, Activation>
  nonces: ActivationNonce[]
  ownerships: Ownership[]
  devices: Device[]
  units: ProductUnit[]
  measurements: DeviceMeasurement[]
  aiSnapshots: AiSnapshotRecord[]
  energyWindows: EnergyWindow[]
  rewardEvents: RewardEvent[]
  ledgerEntries: LedgerEntry[]
  demoBalances: Record<string, number>
  catalogItems: CatalogItem[]
  redemptions: Redemption[]
  plantProfiles: PlantProfileEntity[]
  contributions: Contribution[]
  reviews: ReviewRecord[]
  profileVersions: ProfileVersion[]
  outboxJobs: OutboxJob[]
}

export const ECOSYSTEM_STORAGE_KEY = 'smart-agro.miro-ecosystem.v1'
const CHAIN_ID = 'eip155:84532' // Base Sepolia Testnet
const CONTRACT_ADDRESS = '0x5A67A9000000000000000000000000000000A620'
const ISSUER_SIGNER = 'issuer:smart-agro-official-v1'

// ponytail: deterministic FIPS 180-4 SHA-256 in pure TS works synchronously in both browser and Node test runner without external deps.
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n))
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const totalWords = (((bytes.length + 8) >> 6) + 1) * 16
  const words = new Uint32Array(totalWords)
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8)
  words[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8)
  words[totalWords - 2] = Math.floor(bitLen / 0x100000000)
  words[totalWords - 1] = bitLen >>> 0
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  for (let i = 0; i < totalWords; i += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[i + t]
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3)
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('')
}

function makeOutboxJob(kind: OutboxJob['kind'], eventKey: string, payload: Record<string, unknown>, nowMs: number): OutboxJob {
  const artifactBytes = JSON.stringify(payload)
  return {
    id: `outbox-${sha256Hex(eventKey).slice(0, 12)}`,
    eventKey,
    kind,
    artifactBytes,
    artifactSha256: sha256Hex(artifactBytes),
    status: 'pending',
    chainId: CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    issuerSigner: ISSUER_SIGNER,
    txHash: null,
    blockNumber: null,
    attempts: 0,
    lastError: null,
    updatedAt: new Date(nowMs).toISOString(),
  }
}

export function createInitialEcosystemState(defaultProfile: Profile): EcosystemState {
  const nowIso = '2026-10-22T09:00:00.000Z'
  const nowMs = Date.parse(nowIso)
  const ownerAccount: Account = {
    id: 'acc-owner-01',
    authSubject: 'user:pemilik-utama',
    displayName: 'Pemilik Kebun & Pot',
    roles: ['owner'],
  }
  const contributorAccount: Account = {
    id: 'acc-contrib-01',
    authSubject: 'user:kontributor-agronomi',
    displayName: 'Kontributor Riset',
    roles: ['owner', 'contributor'],
  }
  const curatorAccount: Account = {
    id: 'acc-curator-01',
    authSubject: 'user:kurator-agronomi',
    displayName: 'Kurator Agronomi',
    roles: ['curator'],
  }
  const operatorAccount: Account = {
    id: 'acc-operator-01',
    authSubject: 'user:operator-program',
    displayName: 'Operator Penerbit & Program',
    roles: ['operator'],
  }

  const plantProfile1: PlantProfileEntity = {
    id: 'prof-cabai-01',
    speciesVariety: 'Cabai Rawit (Capsicum frutescens)',
    contextScope: 'Polybag 3–5 L · Media sekam-kompos · Dataran rendah-menengah',
  }
  const plantProfile2: PlantProfileEntity = {
    id: 'prof-bawang-01',
    speciesVariety: 'Bawang Merah (Allium ascalonicum)',
    contextScope: 'Bedeng / Pot dangkal · Drainase cepat · Fase umbi',
  }

  const profileVersion1: ProfileVersion = {
    id: 'pver-cabai-v1',
    profileId: plantProfile1.id,
    contributionId: 'contrib-seed-01',
    version: 1,
    parametersAndScope: structuredClone(defaultProfile),
    evidenceLevel: 'validated_baseline_v1',
    publishedAt: nowIso,
  }

  // Produk 1: Kit Satu Pot (sudah siap diklaim via kode tersegel SEALED-POT-001-SECRET)
  const potUnclaimed: Product = {
    id: 'prod-pot-001',
    serialPublic: 'AGRO-KIT-POT-001',
    variant: 'single_pot',
    registryStatus: 'active',
    issuerSignature: `sig:${ISSUER_SIGNER}:AGRO-KIT-POT-001`,
  }
  // Produk 2: Kit Satu Pot aktif milik ownerAccount
  const potOwned: Product = {
    id: 'prod-pot-002',
    serialPublic: 'AGRO-KIT-POT-002',
    variant: 'single_pot',
    registryStatus: 'active',
    issuerSignature: `sig:${ISSUER_SIGNER}:AGRO-KIT-POT-002`,
  }
  // Produk 3: Kit Satu Kebun aktif milik ownerAccount (mendukung multi-zona)
  const gardenOwned: Product = {
    id: 'prod-garden-001',
    serialPublic: 'AGRO-KIT-GARDEN-001',
    variant: 'garden',
    registryStatus: 'active',
    issuerSignature: `sig:${ISSUER_SIGNER}:AGRO-KIT-GARDEN-001`,
  }

  const activations: Record<string, Activation> = {
    [potUnclaimed.id]: {
      productId: potUnclaimed.id,
      secretHash: sha256Hex('SEALED-POT-001-SECRET'),
      consumedBy: null,
      consumedAt: null,
      failedAttempts: 0,
    },
    [potOwned.id]: {
      productId: potOwned.id,
      secretHash: sha256Hex('SEALED-POT-002-SECRET'),
      consumedBy: ownerAccount.id,
      consumedAt: nowIso,
      failedAttempts: 0,
    },
    [gardenOwned.id]: {
      productId: gardenOwned.id,
      secretHash: sha256Hex('SEALED-GARDEN-001-SECRET'),
      consumedBy: ownerAccount.id,
      consumedAt: nowIso,
      failedAttempts: 0,
    },
  }

  const ownerships: Ownership[] = [
    {
      id: 'own-pot-002',
      productId: potOwned.id,
      accountId: ownerAccount.id,
      startAt: nowIso,
      endAt: null,
    },
    {
      id: 'own-garden-001',
      productId: gardenOwned.id,
      accountId: ownerAccount.id,
      startAt: nowIso,
      endAt: null,
    },
  ]

  const devices: Device[] = [
    { id: 'dev-pot-001', productId: potUnclaimed.id, publicKey: 'pubkey:esp32-pot-001', status: 'active' },
    { id: 'dev-pot-002', productId: potOwned.id, publicKey: 'pubkey:esp32-pot-002', status: 'active' },
    { id: 'dev-garden-gw1', productId: gardenOwned.id, publicKey: 'pubkey:esp32-garden-gw1', status: 'active' },
  ]

  const units: ProductUnit[] = [
    {
      id: 'unit-pot-002-main',
      productId: potOwned.id,
      profileVersionId: profileVersion1.id,
      locationLabel: 'Pot Utama · Cabai Rawit P1',
    },
    {
      id: 'unit-garden-zone-a',
      productId: gardenOwned.id,
      profileVersionId: profileVersion1.id,
      locationLabel: 'Bedeng A · Cabai Rawit Timur',
    },
  ]

  const catalogItems: CatalogItem[] = [
    {
      id: 'cat-dolomit-1kg',
      title: 'Kapur Pertanian Dolomit Super (1 kg)',
      category: 'Koreksi pH & Media',
      pointCost: 100,
      stockTotal: 5,
      stockReserved: 0,
      availability: 'available',
    },
    {
      id: 'cat-npk-generatif',
      title: 'Nutrisi Kalium & Kalsium Fase Berbunga (500 g)',
      category: 'Nutrisi HST',
      pointCost: 180,
      stockTotal: 3,
      stockReserved: 0,
      availability: 'available',
    },
    {
      id: 'cat-probe-rs485',
      title: 'Voucher Kalibrasi Buffer pH 4.01 & 6.86',
      category: 'Perawatan Sensor',
      pointCost: 80,
      stockTotal: 8,
      stockReserved: 0,
      availability: 'available',
    },
  ]

  const seedJob = makeOutboxJob(
    'product_manifest',
    `manifest:${potOwned.serialPublic}`,
    {
      schema: 'smart-agro.manifest.v1',
      serial_public: potOwned.serialPublic,
      variant: potOwned.variant,
      device_public_key: 'pubkey:esp32-pot-002',
      issuer: ISSUER_SIGNER,
      issued_at: nowIso,
    },
    nowMs
  )
  const confirmedSeedJob: OutboxJob = {
    ...seedJob,
    status: 'confirmed',
    txHash: `0x${sha256Hex(seedJob.artifactSha256).slice(0, 64)}`,
    blockNumber: 18_420_110,
    attempts: 1,
  }

  return {
    version: 1,
    activeAccountId: ownerAccount.id,
    accounts: [ownerAccount, contributorAccount, curatorAccount, operatorAccount],
    products: [potOwned, gardenOwned, potUnclaimed],
    activations,
    nonces: [],
    ownerships,
    devices,
    units,
    measurements: [],
    aiSnapshots: [],
    energyWindows: [],
    rewardEvents: [],
    ledgerEntries: [],
    demoBalances: {},
    catalogItems,
    redemptions: [],
    plantProfiles: [plantProfile1, plantProfile2],
    contributions: [],
    reviews: [],
    profileVersions: [profileVersion1],
    outboxJobs: [confirmedSeedJob],
  }
}

export function registerAccount(
  state: EcosystemState,
  input: { authSubject: string; displayName?: string; roles?: AccessRole[] }
): { state: EcosystemState; account: Account } {
  const subject = input.authSubject.trim()
  if (!subject || subject.length > 120) throw new Error('Identitas auth_subject tidak valid.')
  if (state.accounts.some(a => a.authSubject === subject)) throw new Error('Akun dengan auth_subject tersebut sudah terdaftar.')
  const roles: AccessRole[] = input.roles?.length ? [...new Set(input.roles)] : ['owner']
  const account: Account = {
    id: `acc-${sha256Hex(`${subject}:${state.accounts.length}`).slice(0, 10)}`,
    authSubject: subject,
    displayName: (input.displayName ?? subject).slice(0, 80),
    roles,
  }
  return {
    state: { ...state, accounts: [...state.accounts, account] },
    account,
  }
}

export function registerProductManifest(
  state: EcosystemState,
  input: {
    operatorAccountId: string
    serialPublic: string
    variant: ProductVariant
    sealedCode: string
    devicePublicKey: string
    nowMs?: number
  }
): { state: EcosystemState; product: Product; device: Device; outboxJob: OutboxJob } {
  const operator = state.accounts.find(a => a.id === input.operatorAccountId)
  if (!operator || !operator.roles.includes('operator')) throw new Error('Otorisasi operator penerbit diperlukan (ID-04).')
  const serial = input.serialPublic.trim().toUpperCase()
  if (!serial || state.products.some(p => p.serialPublic === serial)) throw new Error('Nomor seri publik produk tidak valid atau sudah terdaftar.')
  if (!input.sealedCode || input.sealedCode.trim().length < 8) throw new Error('Kode aktivasi tersegel minimal 8 karakter.')
  if (!input.devicePublicKey.trim()) throw new Error('Kunci publik perangkat wajib diisi.')
  const nowMs = input.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const product: Product = {
    id: `prod-${sha256Hex(serial).slice(0, 10)}`,
    serialPublic: serial,
    variant: input.variant,
    registryStatus: 'active',
    issuerSignature: `sig:${ISSUER_SIGNER}:${serial}`,
  }
  const device: Device = {
    id: `dev-${sha256Hex(`${serial}:dev`).slice(0, 10)}`,
    productId: product.id,
    publicKey: input.devicePublicKey.trim(),
    status: 'active',
  }
  const activation: Activation = {
    productId: product.id,
    secretHash: sha256Hex(input.sealedCode.trim()),
    consumedBy: null,
    consumedAt: null,
    failedAttempts: 0,
  }
  // Penting (SPESIFIKASI.md Bab 3): Kode aktivasi rahasia dan PII tidak pernah dimasukkan ke artefak blockchain
  const outboxJob = makeOutboxJob(
    'product_manifest',
    `manifest:${serial}`,
    {
      schema: 'smart-agro.manifest.v1',
      serial_public: serial,
      variant: product.variant,
      device_public_key: device.publicKey,
      issuer: ISSUER_SIGNER,
      issued_at: nowIso,
    },
    nowMs
  )
  return {
    state: {
      ...state,
      products: [...state.products, product],
      devices: [...state.devices, device],
      activations: { ...state.activations, [product.id]: activation },
      outboxJobs: [...state.outboxJobs, outboxJob],
    },
    product,
    device,
    outboxJob,
  }
}

export function inspectPublicQr(state: EcosystemState, serialPublic: string) {
  const product = state.products.find(p => p.serialPublic === serialPublic.trim().toUpperCase())
  if (!product) {
    return {
      found: false,
      verifiedRegistry: false,
      productId: '',
      serialPublic,
      variant: 'single_pot' as ProductVariant,
      registryStatus: 'pending' as RegistryStatus,
      devicePublicKey: '',
      hasActiveOwner: false,
      physicalNotice: 'ID produk tidak terdaftar pada registri penerbit resmi. Jangan menganggap perangkat asli.',
    }
  }
  const device = state.devices.find(d => d.productId === product.id)
  const signatureOk = product.issuerSignature === `sig:${ISSUER_SIGNER}:${product.serialPublic}`
  const verifiedRegistry = signatureOk && product.registryStatus === 'active' && device?.status === 'active'
  const activeOwner = state.ownerships.find(o => o.productId === product.id && o.endAt === null)
  return {
    found: true,
    verifiedRegistry,
    productId: product.id,
    serialPublic: product.serialPublic,
    variant: product.variant,
    registryStatus: product.registryStatus,
    devicePublicKey: device?.publicKey ?? '',
    hasActiveOwner: Boolean(activeOwner),
    physicalNotice: verifiedRegistry
      ? 'Identitas terdaftar sah. Salinan QR belum membuktikan barang fisik asli tanpa kode tersegel dan bukti challenge perangkat.'
      : `Produk berstatus ${product.registryStatus}${product.revokedReason ? ` (${product.revokedReason})` : ''}. Aktivasi ditolak.`,
  }
}

export function issueActivationNonce(
  state: EcosystemState,
  input: { accountId: string; productId: string; sessionId: string; nowMs?: number }
): { state: EcosystemState; nonce: ActivationNonce } {
  const account = state.accounts.find(a => a.id === input.accountId)
  if (!account) throw new Error('Akun tidak ditemukan.')
  const product = state.products.find(p => p.id === input.productId)
  if (!product || product.registryStatus !== 'active') throw new Error('Produk tidak aktif atau telah dicabut.')
  const nowMs = input.nowMs ?? Date.now()
  const token = sha256Hex(`${input.accountId}:${input.productId}:${input.sessionId}:${nowMs}:${state.nonces.length}`).slice(0, 24)
  const nonce: ActivationNonce = {
    id: `nonce-${token.slice(0, 10)}`,
    token,
    accountId: input.accountId,
    productId: input.productId,
    sessionId: input.sessionId,
    expiresAtMs: nowMs + 5 * 60_000,
    usedAtMs: null,
  }
  return {
    state: { ...state, nonces: [...state.nonces, nonce] },
    nonce,
  }
}

export function claimProductActivation(
  state: EcosystemState,
  input: {
    accountId: string
    productId: string
    sealedCode: string
    nonceId: string
    deviceSignature: string
    nowMs?: number
  }
): { state: EcosystemState; ownership: Ownership; outboxJob: OutboxJob } {
  const nowMs = input.nowMs ?? Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const account = state.accounts.find(a => a.id === input.accountId)
  if (!account) throw new Error('Akun tidak ditemukan.')
  const product = state.products.find(p => p.id === input.productId)
  if (!product || product.registryStatus !== 'active') throw new Error('Produk tidak berstatus aktif.')
  const device = state.devices.find(d => d.productId === product.id && d.status === 'active')
  if (!device) throw new Error('Perangkat produk tidak aktif.')
  const activation = state.activations[product.id]
  if (!activation) throw new Error('Data aktivasi produk tidak ditemukan.')
  if (activation.failedAttempts >= 5) throw new Error('Batas percobaan aktivasi terlampaui. Hubungi dukungan pemulihan.')
  if (activation.consumedAt !== null) throw new Error('Kode aktivasi sudah dikonsumsi.')
  if (state.ownerships.some(o => o.productId === product.id && o.endAt === null)) {
    throw new Error('Produk sudah memiliki pemilik aktif.')
  }

  const nonce = state.nonces.find(n => n.id === input.nonceId)
  if (!nonce || nonce.productId !== product.id || nonce.accountId !== account.id) {
    throw new Error('Nonce tidak terikat pada akun dan produk ini.')
  }
  if (nonce.usedAtMs !== null || nowMs > nonce.expiresAtMs) {
    throw new Error('Nonce sudah pernah dipakai atau kedaluwarsa.')
  }

  const expectedSignature = `sig:${device.publicKey}:${nonce.token}`
  if (input.deviceSignature.trim() !== expectedSignature) {
    throw new Error('Tanda tangan challenge perangkat tidak cocok.')
  }

  if (sha256Hex(input.sealedCode.trim()) !== activation.secretHash) {
    throw new Error('Kode aktivasi tersegel tidak sah.')
  }

  // Satu transaksi atomik: konsumsi kode + konsumsi nonce + buat kepemilikan aktif + tulis outbox
  const updatedActivation: Activation = {
    ...activation,
    consumedBy: account.id,
    consumedAt: nowIso,
  }
  const updatedNonces = state.nonces.map(n => (n.id === nonce.id ? { ...n, usedAtMs: nowMs } : n))
  const ownership: Ownership = {
    id: `own-${sha256Hex(`${product.id}:${account.id}:${nowMs}`).slice(0, 10)}`,
    productId: product.id,
    accountId: account.id,
    startAt: nowIso,
    endAt: null,
  }
  // Komitmen audit klaim tanpa menyertakan email/nama pribadi atau kode aktivasi
  const outboxJob = makeOutboxJob(
    'ownership_claim',
    `claim:${product.serialPublic}:${ownership.id}`,
    {
      schema: 'smart-agro.claim-commitment.v1',
      serial_public: product.serialPublic,
      ownership_commitment: sha256Hex(`${ownership.id}:${product.id}:${nowIso}`),
      claimed_at: nowIso,
    },
    nowMs
  )

  // Jika produk belum punya unit awal, buatkan 1 unit default
  const hasUnit = state.units.some(u => u.productId === product.id)
  const nextUnits = hasUnit
    ? state.units
    : [
        ...state.units,
        {
          id: `unit-${product.id}-1`,
          productId: product.id,
          profileVersionId: state.profileVersions[0].id,
          locationLabel: product.variant === 'single_pot' ? `Pot ${product.serialPublic}` : `Zona 1 · ${product.serialPublic}`,
        },
      ]

  return {
    state: {
      ...state,
      activations: { ...state.activations, [product.id]: updatedActivation },
      nonces: updatedNonces,
      ownerships: [...state.ownerships, ownership],
      units: nextUnits,
      outboxJobs: [...state.outboxJobs, outboxJob],
    },
    ownership,
    outboxJob,
  }
}

export function transferOwnership(
  state: EcosystemState,
  input: {
    productId: string
    fromAccountId: string
    toAccountId: string
    reauthenticated: boolean
    nowMs?: number
  }
): { state: EcosystemState; ownership: Ownership } {
  if (!input.reauthenticated) throw new Error('Autentikasi ulang diperlukan untuk transfer kepemilikan (ID-03).')
  if (input.fromAccountId === input.toAccountId) throw new Error('Akun tujuan harus berbeda dari pemilik saat ini.')
  const targetAccount = state.accounts.find(a => a.id === input.toAccountId)
  if (!targetAccount) throw new Error('Akun penerima tidak ditemukan.')
  const currentOwnership = state.ownerships.find(
    o => o.productId === input.productId && o.accountId === input.fromAccountId && o.endAt === null
  )
  if (!currentOwnership) throw new Error('Pemohon bukan pemilik aktif produk ini.')
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const newOwnership: Ownership = {
    id: `own-${sha256Hex(`${input.productId}:${input.toAccountId}:${nowIso}`).slice(0, 10)}`,
    productId: input.productId,
    accountId: input.toAccountId,
    startAt: nowIso,
    endAt: null,
  }
  return {
    state: {
      ...state,
      ownerships: [
        ...state.ownerships.map(o => (o.id === currentOwnership.id ? { ...o, endAt: nowIso } : o)),
        newOwnership,
      ],
    },
    ownership: newOwnership,
  }
}

export function revokeProductOrDevice(
  state: EcosystemState,
  input: { operatorAccountId: string; productId: string; reason: string; nowMs?: number }
): { state: EcosystemState } {
  const operator = state.accounts.find(a => a.id === input.operatorAccountId)
  if (!operator || !operator.roles.includes('operator')) throw new Error('Otorisasi operator diperlukan untuk pencabutan (ID-05).')
  const reason = input.reason.trim()
  if (!reason) throw new Error('Alasan pencabutan wajib dicatat.')
  return {
    state: {
      ...state,
      products: state.products.map(p =>
        p.id === input.productId ? { ...p, registryStatus: 'revoked', revokedReason: reason } : p
      ),
      devices: state.devices.map(d =>
        d.productId === input.productId ? { ...d, status: 'revoked' } : d
      ),
    },
  }
}

export function createProductUnit(
  state: EcosystemState,
  input: { accountId: string; productId: string; profileVersionId: string; locationLabel: string }
): { state: EcosystemState; unit: ProductUnit } {
  const activeOwnership = state.ownerships.find(
    o => o.productId === input.productId && o.accountId === input.accountId && o.endAt === null
  )
  if (!activeOwnership) throw new Error('Hanya pemilik aktif yang dapat menambah unit pada produk ini.')
  const product = state.products.find(p => p.id === input.productId)
  if (!product || product.registryStatus !== 'active') throw new Error('Produk tidak aktif.')
  const existingUnits = state.units.filter(u => u.productId === product.id)
  if (product.variant === 'single_pot' && existingUnits.length >= 1) {
    throw new Error('Kit satu pot hanya mengizinkan maksimal satu unit aktif.')
  }
  const profileVersion = state.profileVersions.find(v => v.id === input.profileVersionId)
  if (!profileVersion) throw new Error('Versi profil tanaman tidak ditemukan.')
  const label = input.locationLabel.trim()
  if (!label || label.length > 80) throw new Error('Label lokasi unit wajib 1–80 karakter.')
  const unit: ProductUnit = {
    id: `unit-${sha256Hex(`${product.id}:${label}:${state.units.length}`).slice(0, 10)}`,
    productId: product.id,
    profileVersionId: profileVersion.id,
    locationLabel: label,
  }
  return {
    state: { ...state, units: [...state.units, unit] },
    unit,
  }
}

export function ingestDeviceMeasurement(
  state: EcosystemState,
  input: {
    deviceId: string
    unitId: string
    bootId: string
    sequence: number
    sensorId: 'moisture' | 'soil_temperature' | 'soil_ph'
    source: 'device' | 'simulation'
    qualityStatus: 'ok' | 'error' | 'not_measured'
    value: number | null
    measuredAtMs: number
    receivedAtMs?: number
  }
): { state: EcosystemState; measurement: DeviceMeasurement; deduplicated: boolean } {
  const device = state.devices.find(d => d.id === input.deviceId)
  const unit = state.units.find(u => u.id === input.unitId)
  if (!device || !unit || device.productId !== unit.productId) {
    throw new Error('device_id dan unit_id harus berada pada produk yang sama (E02).')
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 0) throw new Error('Nomor sequence tidak valid.')
  const ranges: Record<typeof input.sensorId, [number, number]> = {
    moisture: [0, 100],
    soil_temperature: [-20, 60],
    soil_ph: [0, 14],
  }
  const [low, high] = ranges[input.sensorId]
  if (input.qualityStatus === 'ok') {
    if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < low || input.value > high) {
      throw new Error(`Nilai ${input.sensorId} untuk status ok harus berada dalam rentang ${low}–${high}.`)
    }
  } else if (input.value !== null) {
    throw new Error('Status selain ok wajib memakai nilai null.')
  }

  const dedupKey = `${device.id}:${input.bootId.trim()}:${input.sequence}:${input.sensorId}`
  const existing = state.measurements.find(m => m.deviceBootSeqSensor === dedupKey)
  if (existing) {
    return { state, measurement: existing, deduplicated: true }
  }

  const measurement: DeviceMeasurement = {
    id: `meas-${sha256Hex(dedupKey).slice(0, 12)}`,
    deviceId: device.id,
    unitId: unit.id,
    deviceBootSeqSensor: dedupKey,
    sensorId: input.sensorId,
    source: input.source,
    qualityStatus: input.qualityStatus,
    valueNullable: input.value,
    measuredAt: new Date(input.measuredAtMs).toISOString(),
    receivedAt: new Date(input.receivedAtMs ?? input.measuredAtMs).toISOString(),
  }
  return {
    state: { ...state, measurements: [...state.measurements, measurement] },
    measurement,
    deduplicated: false,
  }
}

export function evaluateUnitWithMascot(
  potCaseInput: unknown,
  previousMascotState: MascotState | null = null
): {
  decision: Decision
  mascotState: MascotState
  mascotLabel: string
  userGuidance: string
} {
  const checked = parseCase(potCaseInput)
  const decision = evaluate(checked)
  let rawState: MascotState
  switch (decision.decision) {
    case 'KALIBRASI_LOKAL':
    case 'PULIHKAN_DATA':
    case 'PERIKSA_SENSOR':
      rawState = 'bingung_menunggu'
      break
    case 'AMATI':
      rawState = 'tenang_senang'
      break
    case 'PERIKSA_MEDIA_KERING':
    case 'PERIKSA_SIRAMAN':
    case 'PERIKSA_SEBELUM_PERGI':
      rawState = 'sedih_perhatian'
      break
    case 'PERIKSA_DRAINASE':
    case 'PERIKSA_PANAS':
    case 'UKUR_ULANG_PH':
      rawState = 'waspada_marah'
      break
  }

  // Anti-flicker: status kualitas data (bingung_menunggu) selalu punya prioritas tertinggi
  const mascotState = rawState === 'bingung_menunggu' ? 'bingung_menunggu' : rawState
  const meta: Record<MascotState, { label: string; guidance: string }> = {
    bingung_menunggu: {
      label: 'Bingung · Menunggu Data Sah',
      guidance: `Kondisi belum dapat dinilai (${decision.decision}). ${decision.reason}`,
    },
    tenang_senang: {
      label: 'Tenang · Pengamatan Rutin',
      guidance: `Lanjutkan pengamatan; bukan jaminan tanaman sehat. ${decision.reason}`,
    },
    sedih_perhatian: {
      label: 'Perlu Perhatian · Cek Media & Air',
      guidance: `${decision.action} — ${decision.reason}`,
    },
    waspada_marah: {
      label: 'Waspada · Prioritas Pemeriksaan',
      guidance: `${decision.action} — ${decision.reason}`,
    },
  }
  void previousMascotState
  return {
    decision,
    mascotState,
    mascotLabel: meta[mascotState].label,
    userGuidance: meta[mascotState].guidance,
  }
}

export function generateAiSnapshot(
  state: EcosystemState,
  input: {
    unitId: string
    potCase: unknown
    userQuestion?: string
    candidateAiResponse?: string
    simulateTimeout?: boolean
    nowMs?: number
  }
): { state: EcosystemState; snapshot: AiSnapshotRecord } {
  const unit = state.units.find(u => u.id === input.unitId)
  if (!unit) throw new Error('Unit pengamatan tidak ditemukan.')
  const evalResult = evaluateUnitWithMascot(input.potCase)
  const { decision, mascotState, userGuidance } = evalResult
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const question = (input.userQuestion ?? '').trim().slice(0, 280)

  // Periksa apakah kandidat jawaban AI aman dan tidak bertentangan dengan bukti aturan (SPESIFIKASI.md Bab 6 & 10)
  let sourceMode: AiSnapshotRecord['sourceMode'] = 'ai_verified'
  let explanation = ''

  const dataUnusable = mascotState === 'bingung_menunggu'
  const candidate = input.candidateAiResponse?.trim()
  const contradictsUnusableData =
    dataUnusable && candidate !== undefined && /sehat|optimal|lanjutkan|aman|subur/i.test(candidate)
  const contradictsWarning =
    mascotState !== 'tenang_senang' && candidate !== undefined && /tidak perlu diperiksa|semua normal/i.test(candidate)

  if (input.simulateTimeout || dataUnusable || contradictsUnusableData || contradictsWarning) {
    sourceMode = 'rule_fallback'
    explanation = `[Fallback Aturan · ${decision.decision}] ${userGuidance}`
  } else if (candidate) {
    explanation = candidate
  } else {
    explanation =
      `Ringkasan Snapshot (${decision.decision}): ${decision.action}. Bukti: kelembapan ${decision.evidence.moisture}/100 ` +
      `(ambang kering ${decision.evidence.low}, basah ${decision.evidence.wet}), suhu ${decision.evidence.temp_c} °C, ` +
      `${decision.evidence.ph_status}.` +
      (question ? ` Jawaban konteks "${question}": Ikuti prioritas ${decision.decision}; AI tidak mengubah jadwal atau aktuator.` : '')
  }

  const snapshot: AiSnapshotRecord = {
    id: `aisnap-${sha256Hex(`${unit.id}:${nowIso}:${state.aiSnapshots.length}`).slice(0, 10)}`,
    unitId: unit.id,
    profileVersionId: unit.profileVersionId,
    evidenceRef: JSON.stringify(decision.evidence),
    decisionAndState: `${decision.decision}:${mascotState}`,
    mascotState,
    modelPromptVersion: 'smart-agro-snapshot-prompt.v2',
    explanation,
    sourceMode,
    createdAt: nowIso,
  }
  return {
    state: { ...state, aiSnapshots: [snapshot, ...state.aiSnapshots].slice(0, 50) },
    snapshot,
  }
}

export interface PowerModeSpec {
  name: string
  powerW: number
  hoursPerDay: number
}

export function calculateSolarBatterySizing(input: {
  modes: PowerModeSpec[]
  autonomyDays: number
  usableDepthOfDischarge: number
  batteryPathEfficiency: number
  peakSunHours: number
  solarSystemEfficiency: number
  batteryNominalVoltageV: number
  currentSocPct?: number
}) {
  if (!input.modes.length) throw new Error('Minimal satu mode beban harus diisi.')
  const totalHours = input.modes.reduce((acc, m) => acc + m.hoursPerDay, 0)
  if (Math.abs(totalHours - 24) > 1e-6) {
    throw new Error('Total durasi mode harian harus tepat 24 jam.')
  }
  for (const m of input.modes) {
    if (m.powerW < 0 || m.hoursPerDay < 0) throw new Error('Daya dan durasi mode tidak boleh negatif.')
  }
  if (
    input.autonomyDays <= 0 ||
    input.usableDepthOfDischarge <= 0 ||
    input.usableDepthOfDischarge > 1 ||
    input.batteryPathEfficiency <= 0 ||
    input.batteryPathEfficiency > 1 ||
    input.peakSunHours <= 0 ||
    input.solarSystemEfficiency <= 0 ||
    input.solarSystemEfficiency > 1 ||
    input.batteryNominalVoltageV <= 0
  ) {
    throw new Error('Parameter otonomi, efisiensi, jam matahari puncak, dan tegangan nominal harus bernilai positif valid.')
  }

  const dailyEnergyWh = input.modes.reduce((acc, m) => acc + m.powerW * m.hoursPerDay, 0)
  const minBatteryWh =
    (dailyEnergyWh * input.autonomyDays) / (input.usableDepthOfDischarge * input.batteryPathEfficiency)
  const minBatteryAh = minBatteryWh / input.batteryNominalVoltageV
  const minPanelWp = dailyEnergyWh / (input.peakSunHours * input.solarSystemEfficiency)

  const soc = input.currentSocPct ?? 85
  const powerPolicy: 'normal' | 'low_power_buffer' | 'critical_cutoff' =
    soc < 15 ? 'critical_cutoff' : soc < 35 ? 'low_power_buffer' : 'normal'

  return {
    dailyEnergyWh,
    minBatteryWh,
    minBatteryAh,
    minPanelWp,
    powerPolicy,
  }
}

export function recordEnergyWindow(
  state: EcosystemState,
  input: {
    deviceId: string
    bootId: string
    startAtMs: number
    endAtMs: number
    solarHarvestWh: number
    loadWh: number
    batterySocPct: number
    evidenceQuality: EnergyWindow['evidenceQuality']
  }
): { state: EcosystemState; window: EnergyWindow } {
  const device = state.devices.find(d => d.id === input.deviceId)
  if (!device) throw new Error('Perangkat pengukur energi tidak ditemukan.')
  if (input.endAtMs <= input.startAtMs) throw new Error('Waktu akhir jendela energi harus setelah waktu mulai.')
  if (input.solarHarvestWh < 0 || input.loadWh < 0 || input.batterySocPct < 0 || input.batterySocPct > 100) {
    throw new Error('Nilai energi panen, beban, atau SOC baterai tidak valid.')
  }
  const overlaps = state.energyWindows.some(
    w =>
      w.deviceId === input.deviceId &&
      w.bootId === input.bootId.trim() &&
      input.startAtMs < w.endAtMs &&
      input.endAtMs > w.startAtMs
  )
  if (overlaps) {
    throw new Error('Jendela energi tumpang tindih pada perangkat dan periode boot yang sama.')
  }
  const window: EnergyWindow = {
    id: `ewin-${sha256Hex(`${input.deviceId}:${input.bootId}:${input.startAtMs}:${input.endAtMs}`).slice(0, 10)}`,
    deviceId: input.deviceId,
    bootId: input.bootId.trim(),
    startAt: new Date(input.startAtMs).toISOString(),
    endAt: new Date(input.endAtMs).toISOString(),
    startAtMs: input.startAtMs,
    endAtMs: input.endAtMs,
    solarHarvestWh: input.solarHarvestWh,
    loadWh: input.loadWh,
    batterySocPct: input.batterySocPct,
    evidenceQuality: input.evidenceQuality,
  }
  return {
    state: { ...state, energyWindows: [...state.energyWindows, window] },
    window,
  }
}

export function getAccountPointSummary(state: EcosystemState, accountId: string) {
  const settledPoints = state.ledgerEntries
    .filter(e => e.accountId === accountId)
    .reduce((acc, e) => acc + e.signedPoints, 0)
  const reservedPoints = state.redemptions
    .filter(r => r.accountId === accountId && r.status === 'reserved')
    .reduce((acc, r) => acc + r.reservedPoints, 0)
  return {
    settledPoints,
    reservedPoints,
    availablePoints: settledPoints - reservedPoints,
    demoPoints: state.demoBalances[accountId] ?? 0,
  }
}

export function claimGardeningReward(
  state: EcosystemState,
  input: {
    accountId: string
    energyWindowId: string | null
    sourceEventKey: string
    source: 'device' | 'simulation'
    points: number
    nowMs?: number
  }
): {
  state: EcosystemState
  event: RewardEvent
  availablePoints: number
  demoPoints: number
} {
  const account = state.accounts.find(a => a.id === input.accountId)
  if (!account) throw new Error('Akun penerima hadiah tidak ditemukan.')
  const eventKey = input.sourceEventKey.trim()
  if (!eventKey) throw new Error('source_event_key wajib diisi.')
  if (!Number.isInteger(input.points) || input.points <= 0 || input.points > 1000) {
    throw new Error('Poin klaim harus bilangan bulat positif 1–1000.')
  }
  if (state.rewardEvents.some(e => e.sourceEventKey === eventKey)) {
    throw new Error('Bukti klaim sudah pernah dikreditkan.')
  }
  const ewin = input.energyWindowId ? state.energyWindows.find(w => w.id === input.energyWindowId) : null
  if (input.energyWindowId && !ewin) throw new Error('Jendela energi tidak ditemukan.')
  if (
    input.energyWindowId &&
    state.rewardEvents.some(e => e.energyWindowId === input.energyWindowId && e.verificationStatus === 'verified')
  ) {
    throw new Error('Jendela energi tersebut sudah pernah dipakai untuk klaim hadiah.')
  }

  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const isSimulationOrUnverified =
    input.source === 'simulation' || !ewin || ewin.evidenceQuality !== 'verified_meter'

  if (isSimulationOrUnverified) {
    const rejectedEvent: RewardEvent = {
      id: `revt-${sha256Hex(eventKey).slice(0, 10)}`,
      accountId: account.id,
      energyWindowId: input.energyWindowId,
      sourceEventKey: eventKey,
      policyVersion: 'reward-policy.v2',
      verificationStatus: 'rejected_simulation',
      points: input.points,
    }
    const nextDemo = (state.demoBalances[account.id] ?? 0) + input.points
    const nextState: EcosystemState = {
      ...state,
      rewardEvents: [...state.rewardEvents, rejectedEvent],
      demoBalances: { ...state.demoBalances, [account.id]: nextDemo },
    }
    const summary = getAccountPointSummary(nextState, account.id)
    return {
      state: nextState,
      event: rejectedEvent,
      availablePoints: summary.availablePoints,
      demoPoints: summary.demoPoints,
    }
  }

  const verifiedEvent: RewardEvent = {
    id: `revt-${sha256Hex(eventKey).slice(0, 10)}`,
    accountId: account.id,
    energyWindowId: ewin.id,
    sourceEventKey: eventKey,
    policyVersion: 'reward-policy.v2',
    verificationStatus: 'verified',
    points: input.points,
  }
  const ledgerEntry: LedgerEntry = {
    id: `led-${sha256Hex(`credit:${eventKey}`).slice(0, 10)}`,
    accountId: account.id,
    rewardEventId: verifiedEvent.id,
    redemptionId: null,
    signedPoints: input.points,
    idempotencyKey: `credit:${eventKey}`,
    note: `Kredit aktivitas & energi terverifikasi (${ewin.solarHarvestWh} Wh panen surya)`,
    createdAt: nowIso,
  }
  const nextState: EcosystemState = {
    ...state,
    rewardEvents: [...state.rewardEvents, verifiedEvent],
    ledgerEntries: [...state.ledgerEntries, ledgerEntry],
  }
  const summary = getAccountPointSummary(nextState, account.id)
  return {
    state: nextState,
    event: verifiedEvent,
    availablePoints: summary.availablePoints,
    demoPoints: summary.demoPoints,
  }
}

export function requestCatalogRedemption(
  state: EcosystemState,
  input: {
    accountId: string
    catalogItemId: string
    idempotencyKey: string
    nowMs?: number
  }
): { state: EcosystemState; redemption: Redemption; availablePoints: number } {
  const idemKey = input.idempotencyKey.trim()
  if (!idemKey) throw new Error('idempotency_key wajib diisi.')
  const existing = state.redemptions.find(r => r.idempotencyKey === idemKey)
  if (existing) {
    const summary = getAccountPointSummary(state, input.accountId)
    return { state, redemption: existing, availablePoints: summary.availablePoints }
  }

  const item = state.catalogItems.find(c => c.id === input.catalogItemId)
  if (!item || item.availability !== 'available') throw new Error('Produk katalog tidak tersedia.')
  if (item.stockTotal - item.stockReserved < 1) throw new Error('Stok produk katalog habis atau sedang direservasi.')
  const summary = getAccountPointSummary(state, input.accountId)
  if (summary.availablePoints < item.pointCost) {
    throw new Error('Saldo poin tersedia tidak mencukupi.')
  }

  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const redemption: Redemption = {
    id: `red-${sha256Hex(idemKey).slice(0, 10)}`,
    accountId: input.accountId,
    catalogItemId: item.id,
    reservedPoints: item.pointCost,
    status: 'reserved',
    idempotencyKey: idemKey,
    createdAt: nowIso,
  }
  const nextState: EcosystemState = {
    ...state,
    catalogItems: state.catalogItems.map(c =>
      c.id === item.id ? { ...c, stockReserved: c.stockReserved + 1 } : c
    ),
    redemptions: [...state.redemptions, redemption],
  }
  return {
    state: nextState,
    redemption,
    availablePoints: getAccountPointSummary(nextState, input.accountId).availablePoints,
  }
}

export function cancelCatalogRedemption(
  state: EcosystemState,
  input: { redemptionId: string; accountId: string; nowMs?: number }
): { state: EcosystemState; redemption: Redemption; availablePoints: number } {
  const redemption = state.redemptions.find(r => r.id === input.redemptionId && r.accountId === input.accountId)
  if (!redemption) throw new Error('Reservasi penukaran tidak ditemukan.')
  if (redemption.status !== 'reserved') throw new Error('Hanya penukaran berstatus reserved yang dapat dibatalkan.')
  const updated: Redemption = { ...redemption, status: 'cancelled' }
  const nextState: EcosystemState = {
    ...state,
    catalogItems: state.catalogItems.map(c =>
      c.id === redemption.catalogItemId ? { ...c, stockReserved: Math.max(0, c.stockReserved - 1) } : c
    ),
    redemptions: state.redemptions.map(r => (r.id === redemption.id ? updated : r)),
  }
  void input.nowMs
  return {
    state: nextState,
    redemption: updated,
    availablePoints: getAccountPointSummary(nextState, input.accountId).availablePoints,
  }
}

export function fulfillCatalogRedemption(
  state: EcosystemState,
  input: { redemptionId: string; operatorAccountId: string; nowMs?: number }
): { state: EcosystemState; redemption: Redemption; availablePoints: number } {
  const operator = state.accounts.find(a => a.id === input.operatorAccountId)
  if (!operator || !operator.roles.includes('operator')) throw new Error('Otorisasi operator diperlukan untuk pemenuhan pesanan (RW-05).')
  const redemption = state.redemptions.find(r => r.id === input.redemptionId)
  if (!redemption) throw new Error('Pesanan penukaran tidak ditemukan.')
  if (redemption.status === 'fulfilled') {
    return {
      state,
      redemption,
      availablePoints: getAccountPointSummary(state, redemption.accountId).availablePoints,
    }
  }
  if (redemption.status !== 'reserved') throw new Error('Pesanan tidak dalam status reserved.')
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const updated: Redemption = { ...redemption, status: 'fulfilled' }
  const debitEntry: LedgerEntry = {
    id: `led-${sha256Hex(`debit:${redemption.id}`).slice(0, 10)}`,
    accountId: redemption.accountId,
    rewardEventId: null,
    redemptionId: redemption.id,
    signedPoints: -redemption.reservedPoints,
    idempotencyKey: `debit:${redemption.id}`,
    note: `Penyelesaian penukaran katalog (${redemption.catalogItemId})`,
    createdAt: nowIso,
  }
  const nextState: EcosystemState = {
    ...state,
    catalogItems: state.catalogItems.map(c =>
      c.id === redemption.catalogItemId
        ? {
            ...c,
            stockTotal: Math.max(0, c.stockTotal - 1),
            stockReserved: Math.max(0, c.stockReserved - 1),
          }
        : c
    ),
    redemptions: state.redemptions.map(r => (r.id === redemption.id ? updated : r)),
    ledgerEntries: [...state.ledgerEntries, debitEntry],
  }
  return {
    state: nextState,
    redemption: updated,
    availablePoints: getAccountPointSummary(nextState, redemption.accountId).availablePoints,
  }
}

export function compensateLedgerEntry(
  state: EcosystemState,
  input: {
    operatorAccountId: string
    accountId: string
    signedPoints: number
    reason: string
    idempotencyKey: string
    nowMs?: number
  }
): { state: EcosystemState; entry: LedgerEntry; availablePoints: number } {
  const operator = state.accounts.find(a => a.id === input.operatorAccountId)
  if (!operator || !operator.roles.includes('operator')) throw new Error('Otorisasi operator diperlukan untuk kompensasi ledger (RW-04).')
  if (!Number.isInteger(input.signedPoints) || input.signedPoints === 0) throw new Error('Nilai kompensasi harus bilangan bulat bukan nol.')
  if (!input.reason.trim()) throw new Error('Alasan kompensasi wajib dicatat.')
  const existing = state.ledgerEntries.find(e => e.idempotencyKey === input.idempotencyKey.trim())
  if (existing) {
    return {
      state,
      entry: existing,
      availablePoints: getAccountPointSummary(state, input.accountId).availablePoints,
    }
  }
  const entry: LedgerEntry = {
    id: `led-${sha256Hex(input.idempotencyKey).slice(0, 10)}`,
    accountId: input.accountId,
    rewardEventId: null,
    redemptionId: null,
    signedPoints: input.signedPoints,
    idempotencyKey: input.idempotencyKey.trim(),
    note: `Kompensasi Operator: ${input.reason.trim()}`,
    createdAt: new Date(input.nowMs ?? Date.now()).toISOString(),
  }
  const nextState: EcosystemState = {
    ...state,
    ledgerEntries: [...state.ledgerEntries, entry],
  }
  return {
    state: nextState,
    entry,
    availablePoints: getAccountPointSummary(nextState, input.accountId).availablePoints,
  }
}

export function submitProfileContribution(
  state: EcosystemState,
  input: {
    authorAccountId: string
    profileId: string
    sourceMethodLicense: string
    evidenceRef: string
    proposedProfile: Profile
    notes: string
    nowMs?: number
  }
): { state: EcosystemState; contribution: Contribution } {
  const author = state.accounts.find(a => a.id === input.authorAccountId)
  if (!author) throw new Error('Akun kontributor tidak ditemukan.')
  const plantProfile = state.plantProfiles.find(p => p.id === input.profileId)
  if (!plantProfile) throw new Error('Profil komoditas tanaman tidak ditemukan.')
  const license = input.sourceMethodLicense.trim()
  if (!license || license.length < 5) throw new Error('Lisensi dan metode sumber wajib diisi.')
  const evidence = input.evidenceRef.trim()
  if (!evidence) throw new Error('Referensi bukti wajib diisi.')

  // Blokir injeksi instruksi atau data pribadi (SPESIFIKASI.md Bab 6, 7 & 10)
  const combinedText = `${license} ${evidence} ${input.notes}`
  if (/ignore previous|system instruction|drop table|nik\s*:|password/i.test(combinedText)) {
    throw new Error('Pengajuan ditolak karena mengandung pola instruksi sistem atau data pribadi tanpa izin.')
  }

  // Validasi struktur profil menggunakan parseCase dari agronomi engine
  const validatedCase = parseCase({
    profile: input.proposedProfile,
    now_h: 0,
    samples: [{ t_h: 0, moisture: 55, temp_c: 26, ph: 6.2, valid: true }],
  })

  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  const contribution: Contribution = {
    id: `contrib-${sha256Hex(`${author.id}:${plantProfile.id}:${nowIso}:${state.contributions.length}`).slice(0, 10)}`,
    profileId: plantProfile.id,
    authorAccountId: author.id,
    sourceMethodLicense: license,
    evidenceRef: evidence,
    proposedParameters: validatedCase.profile,
    notes: input.notes.trim().slice(0, 400),
    status: 'pending_review',
    revisionCount: 1,
    updatedAt: nowIso,
  }
  return {
    state: { ...state, contributions: [contribution, ...state.contributions] },
    contribution,
  }
}

export function reviseProfileContribution(
  state: EcosystemState,
  input: {
    contributionId: string
    authorAccountId: string
    proposedProfile: Profile
    notes: string
    nowMs?: number
  }
): { state: EcosystemState; contribution: Contribution } {
  const existing = state.contributions.find(c => c.id === input.contributionId)
  if (!existing) throw new Error('Pengajuan kontribusi tidak ditemukan.')
  if (existing.authorAccountId !== input.authorAccountId) throw new Error('Hanya penulis asli yang dapat merevisi pengajuan ini (KB-03).')
  if (existing.status === 'approved') throw new Error('Kontribusi yang sudah diterbitkan tidak dapat diedit; buat pengajuan baru.')
  const validatedCase = parseCase({
    profile: input.proposedProfile,
    now_h: 0,
    samples: [{ t_h: 0, moisture: 55, temp_c: 26, ph: 6.2, valid: true }],
  })
  const updated: Contribution = {
    ...existing,
    proposedParameters: validatedCase.profile,
    notes: input.notes.trim().slice(0, 400),
    status: 'pending_review',
    revisionCount: existing.revisionCount + 1,
    updatedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
  }
  return {
    state: {
      ...state,
      contributions: state.contributions.map(c => (c.id === existing.id ? updated : c)),
    },
    contribution: updated,
  }
}

export function reviewProfileContribution(
  state: EcosystemState,
  input: {
    contributionId: string
    reviewerAccountId: string
    decision: ReviewRecord['decision']
    decisionReason: string
    evidenceLevel: string
    nowMs?: number
  }
): {
  state: EcosystemState
  review: ReviewRecord
  publishedVersion: ProfileVersion | null
} {
  const contribution = state.contributions.find(c => c.id === input.contributionId)
  if (!contribution) throw new Error('Kontribusi tidak ditemukan.')
  if (contribution.authorAccountId === input.reviewerAccountId) {
    throw new Error('Pengaju tidak boleh meninjau atau menyetujui kontribusinya sendiri (KB-04).')
  }
  const reviewer = state.accounts.find(a => a.id === input.reviewerAccountId)
  if (!reviewer || !reviewer.roles.includes('curator')) {
    throw new Error('Akses kurator diperlukan untuk meninjau kontribusi profil.')
  }
  const reason = input.decisionReason.trim()
  if (!reason) throw new Error('Alasan keputusan kurasi wajib diisi.')
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()

  const review: ReviewRecord = {
    id: `rev-${sha256Hex(`${contribution.id}:${reviewer.id}:${nowIso}`).slice(0, 10)}`,
    contributionId: contribution.id,
    reviewerAccountId: reviewer.id,
    decision: input.decision,
    decisionReason: reason,
    reviewedAt: nowIso,
  }

  let publishedVersion: ProfileVersion | null = null
  let nextVersions = state.profileVersions
  if (input.decision === 'approved') {
    const maxVersion = state.profileVersions
      .filter(v => v.profileId === contribution.profileId)
      .reduce((max, v) => Math.max(max, v.version), 0)
    publishedVersion = {
      id: `pver-${contribution.profileId}-v${maxVersion + 1}`,
      profileId: contribution.profileId,
      contributionId: contribution.id,
      version: maxVersion + 1,
      parametersAndScope: structuredClone(contribution.proposedParameters),
      evidenceLevel: input.evidenceLevel.trim() || 'curated',
      publishedAt: nowIso,
    }
    nextVersions = [...state.profileVersions, publishedVersion]
  }

  const nextStatus: Contribution['status'] =
    input.decision === 'approved'
      ? 'approved'
      : input.decision === 'needs_revision'
        ? 'needs_revision'
        : 'rejected'

  return {
    state: {
      ...state,
      contributions: state.contributions.map(c =>
        c.id === contribution.id ? { ...c, status: nextStatus, updatedAt: nowIso } : c
      ),
      reviews: [review, ...state.reviews],
      profileVersions: nextVersions,
    },
    review,
    publishedVersion,
  }
}

export function processOutboxJob(
  state: EcosystemState,
  input: {
    jobId: string
    simulateOutcome: 'confirm' | 'timeout' | 'fail'
    nowMs?: number
  }
): { state: EcosystemState; job: OutboxJob } {
  const existing = state.outboxJobs.find(j => j.id === input.jobId)
  if (!existing) throw new Error('Pekerjaan outbox tidak ditemukan.')
  if (existing.status === 'confirmed') {
    return { state, job: existing }
  }
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString()
  let updated: OutboxJob
  if (input.simulateOutcome === 'timeout') {
    updated = {
      ...existing,
      status: 'pending',
      attempts: existing.attempts + 1,
      lastError: 'RPC timeout menunggu receipt blok; siap diulang dengan eventKey yang sama.',
      updatedAt: nowIso,
    }
  } else if (input.simulateOutcome === 'fail') {
    updated = {
      ...existing,
      status: 'failed',
      attempts: existing.attempts + 1,
      lastError: 'Transaksi ditolak jaringan; klaim lokal tetap tersimpan namun status chain belum terverifikasi.',
      updatedAt: nowIso,
    }
  } else {
    updated = {
      ...existing,
      status: 'confirmed',
      attempts: existing.attempts + 1,
      txHash: existing.txHash ?? `0x${sha256Hex(`${existing.eventKey}:${existing.artifactSha256}`).slice(0, 64)}`,
      blockNumber: existing.blockNumber ?? 18_420_200 + state.outboxJobs.length,
      lastError: null,
      updatedAt: nowIso,
    }
  }
  return {
    state: {
      ...state,
      outboxJobs: state.outboxJobs.map(j => (j.id === existing.id ? updated : j)),
    },
    job: updated,
  }
}

export function verifyBlockchainCommitment(job: OutboxJob, candidateArtifactBytes: string) {
  const computedSha256 = sha256Hex(candidateArtifactBytes)
  const digestMatch = computedSha256 === job.artifactSha256
  const receiptConfirmed =
    job.status === 'confirmed' &&
    job.chainId === CHAIN_ID &&
    job.contractAddress === CONTRACT_ADDRESS &&
    job.issuerSigner === ISSUER_SIGNER &&
    Boolean(job.txHash) &&
    typeof job.blockNumber === 'number'
  return {
    verified: digestMatch && receiptConfirmed,
    digestMatch,
    receiptConfirmed,
    computedSha256,
    expectedSha256: job.artifactSha256,
  }
}

export function readEcosystemState(storage: Pick<Storage, 'getItem'>, defaultProfile: Profile): EcosystemState {
  try {
    const raw = storage.getItem(ECOSYSTEM_STORAGE_KEY)
    if (!raw) return createInitialEcosystemState(defaultProfile)
    const parsed = JSON.parse(raw) as EcosystemState
    if (parsed?.version !== 1 || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.products)) {
      return createInitialEcosystemState(defaultProfile)
    }
    return parsed
  } catch {
    return createInitialEcosystemState(defaultProfile)
  }
}

export function saveEcosystemState(storage: Pick<Storage, 'setItem'>, state: EcosystemState) {
  storage.setItem(ECOSYSTEM_STORAGE_KEY, JSON.stringify(state))
}
