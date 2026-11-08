export interface ProductSession { access_token: string; refresh_token: string; expires_at: number }
export interface OwnedProduct { ownership_id: string; product_id: string; serial_public: string; variant: 'single_pot' | 'garden'; start_at: string }
export interface ProductChallenge { nonce_id: string; challenge: string; expires_at: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)) }
function validDate(value: unknown): value is string { return typeof value === 'string' && value.length <= 64 && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) }
function validToken(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/\s/.test(value) }
function parseSession(value: unknown): ProductSession {
  if (!record(value) || !validToken(value.access_token) || !validToken(value.refresh_token) || typeof value.expires_at !== 'number' || !Number.isFinite(value.expires_at) || value.expires_at <= 0 || value.expires_at > Date.now() / 1000 + 7 * 86400) throw new Error('Sesi tersimpan tidak valid.')
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at }
}
export function parseOwnedProducts(value: unknown): OwnedProduct[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Daftar produk tidak valid.')
  return value.map(item => {
    if (!record(item) || typeof item.ownership_id !== 'string' || !uuid.test(item.ownership_id) || typeof item.product_id !== 'string' || !uuid.test(item.product_id) || typeof item.serial_public !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(item.serial_public) || !['single_pot', 'garden'].includes(String(item.variant)) || !validDate(item.start_at)) throw new Error('Data kepemilikan produk tidak valid.')
    return { ownership_id: item.ownership_id, product_id: item.product_id, serial_public: item.serial_public, variant: item.variant as OwnedProduct['variant'], start_at: item.start_at }
  })
}
export function parseProductChallenge(value: unknown): ProductChallenge {
  if (!record(value) || typeof value.nonce_id !== 'string' || !uuid.test(value.nonce_id) || typeof value.challenge !== 'string' || value.challenge.length < 1 || value.challenge.length > 2048 || !validDate(value.expires_at) || Date.parse(value.expires_at) <= Date.now() || Date.parse(value.expires_at) > Date.now() + 10 * 60000) throw new Error('Challenge tidak valid atau kedaluwarsa.')
  return { nonce_id: value.nonce_id, challenge: value.challenge, expires_at: value.expires_at }
}
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const runtime = (globalThis as typeof globalThis & { SMART_AGRO_CONFIG?: Record<string, unknown> }).SMART_AGRO_CONFIG
const endpoint = (typeof runtime?.url === 'string' ? runtime.url : env?.VITE_SUPABASE_URL)?.replace(/\/$/, '') ?? ''
const anonKey = (typeof runtime?.anonKey === 'string' ? runtime.anonKey : env?.VITE_SUPABASE_ANON_KEY) ?? ''
const storageKey = `smart-agro.account:${endpoint}`
export const productAccountConfigured = Boolean(endpoint && anonKey && (() => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) } catch { return false }
})())

export class ProductAccountClient {
  session: ProductSession | null = null
  private refreshing: Promise<void> | null = null

  private clear() {
    this.session = null
    sessionStorage.removeItem(storageKey)
  }

  private store(value: Record<string, unknown>) {
    if (!validToken(value.access_token) || !validToken(value.refresh_token)) throw new Error('Respons sesi tidak valid.')
    const expires = typeof value.expires_at === 'number' ? value.expires_at : Date.now() / 1000 + Number(value.expires_in)
    this.session = parseSession({ ...value, expires_at: expires })
    try { sessionStorage.setItem(storageKey, JSON.stringify(this.session)) } catch { this.session = null; throw new Error('Browser tidak dapat menyimpan sesi sementara.') }
  }

  private async request(path: string, body?: unknown, token?: string, method = 'POST'): Promise<Record<string, unknown>> {
    const response = await fetch(`${endpoint}${path}`, {
      method, headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(20000),
    })
    if (response.status === 401 && token && token === this.session?.access_token) this.clear()
    if (response.status === 204) return {}
    const value = await response.json().catch(() => null)
    if (record(value) && value.ok === false && token === this.session?.access_token && (value.code === 'unauthorized' || value.code === 'invalid_session' || value.code === undefined)) this.clear()
    if (!response.ok || !record(value) || value.ok === false) throw new Error(typeof value?.message === 'string' ? value.message : typeof value?.error_description === 'string' ? value.error_description : 'Permintaan akun gagal. Coba kembali.')
    return value
  }

  async restore() {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return
      if (raw.length > 20000) throw new Error('Sesi tersimpan terlalu besar.')
      this.session = parseSession(JSON.parse(raw))
      await this.refreshIfNeeded()
      await this.request('/auth/v1/user', undefined, this.session?.access_token, 'GET')
    } catch { this.clear(); throw new Error('Sesi berakhir atau tidak dapat diverifikasi. Silakan masuk kembali.') }
  }

  async authenticate(email: string, password: string, signup: boolean) {
    const value = await this.request(signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { email, password })
    if (value.access_token) this.store(value)
    return Boolean(value.access_token)
  }

  async refreshIfNeeded() {
    if (!this.session) throw new Error('Silakan masuk terlebih dahulu.')
    if (this.session.expires_at * 1000 > Date.now() + 60000) return
    if (!this.refreshing) {
      const token = this.session.refresh_token
      this.refreshing = this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: token })
        .then(value => { if (this.session?.refresh_token === token) this.store(value) }).catch(() => { if (this.session?.refresh_token === token) this.clear(); throw new Error('Pembaruan sesi gagal. Silakan masuk kembali.') }).finally(() => { this.refreshing = null })
    }
    await this.refreshing
  }

  async rpc(name: 'ensure_my_account' | 'my_products' | 'issue_activation_nonce' | 'my_device_units' | 'unit_measurements' | 'create_my_unit' | 'published_profile_versions' | 'unit_explanations' | 'knowledge_workspace' | 'submit_profile_contribution' | 'revise_profile_contribution' | 'review_profile_contribution' | 'published_profile_details' | 'assign_unit_profile' | 'energy_workspace' | 'operator_register_energy_meter' | 'operator_revoke_energy_meter' | 'operator_set_reward_policy' | 'operator_upsert_catalog' | 'reserve_my_reward' | 'cancel_my_redemption' | 'operator_fulfill_redemption' | 'operator_compensate_redemption' | 'reward_workspace', body?: unknown) {
    await this.refreshIfNeeded()
    return this.request(`/rest/v1/rpc/${name}`, body, this.session!.access_token)
  }

  async claim(nonceId: string, sealedCode: string, signature: string) {
    await this.refreshIfNeeded()
    return this.request('/functions/v1/product-claim', { nonce_id: nonceId, sealed_code: sealedCode, signature }, this.session!.access_token)
  }

  async explain(unitId: string, deviceId: string, requestId: string, question: string) {
    await this.refreshIfNeeded()
    return this.request('/functions/v1/unit-explanation', { unit_id: unitId, device_id: deviceId, request_id: requestId, question }, this.session!.access_token)
  }

  async logout() {
    const token = this.session?.access_token
    this.clear()
    if (token) await this.request('/auth/v1/logout?scope=local', {}, token)
  }
}
