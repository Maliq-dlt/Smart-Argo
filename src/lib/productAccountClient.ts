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
/** Unverified JWT payload, for display and UI hints only; the server checks the signature. */
export function tokenClaims(token: string | undefined): Record<string, unknown> {
  try { const value: unknown = JSON.parse(atob((token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return record(value) ? value : {} } catch { return {} }
}
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** RFC 7636 code verifier: 32 random bytes, base64url (43 characters). */
export const pkceVerifier = () => base64url(crypto.getRandomValues(new Uint8Array(32)))
export const pkceChallenge = async (verifier: string) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
/** What Auth appended to the return URL after Google: the PKCE code, or the provider's error. */
export function oauthReturn(search: string): { code: string } | { error: string } | null {
  const query = new URLSearchParams(search), code = query.get('code'), error = query.get('error_description') ?? query.get('error')
  if (code !== null) return code.length <= 512 && validToken(code) ? { code } : null
  return error ? { error: error.slice(0, 300) } : null
}
export interface TotpEnrollment { id: string; secret: string; uri: string }
const totpCode = (code: string) => { const value = code.replace(/\s/g, ''); if (!/^\d{6}$/.test(value)) throw new Error('Kode autentikator harus 6 angka.'); return value }
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const runtime = (globalThis as typeof globalThis & { SMART_AGRO_CONFIG?: Record<string, unknown> }).SMART_AGRO_CONFIG
const endpoint = (typeof runtime?.url === 'string' ? runtime.url : env?.VITE_SUPABASE_URL)?.replace(/\/$/, '') ?? ''
const anonKey = (typeof runtime?.anonKey === 'string' ? runtime.anonKey : env?.VITE_SUPABASE_ANON_KEY) ?? ''
const storageKey = `smart-agro.account:${endpoint}`
const pkceKey = `smart-agro.pkce:${endpoint}`
export const productAccountConfigured = Boolean(endpoint && anonKey && (() => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) } catch { return false }
})())
/** Mode B (hosted backend, `.env.cloud`): every visitor signs in, so the gate offers no guest visit. */
export const signInRequired = productAccountConfigured && env?.VITE_SIGN_IN_REQUIRED === 'true'

export class ProductAccountClient {
  session: ProductSession | null = null
  private refreshing: Promise<void> | null = null
  /** Password sign-in that still needs its second factor (aal1); never stored. */
  private pending: Record<string, unknown> | null = null
  get mfa() { return tokenClaims(this.session?.access_token).aal === 'aal2' }
  /** Signed up through Google only: there is no password to re-enter. */
  get passwordless() { const meta = tokenClaims(this.session?.access_token).app_metadata; return record(meta) && Array.isArray(meta.providers) && !meta.providers.includes('email') }

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

  private async request(path: string, body?: unknown, token?: string, method = 'POST', timeout = 20000): Promise<Record<string, unknown>> {
    const response = await fetch(`${endpoint}${path}`, {
      method, headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeout),
    })
    if (response.status === 401 && token && token === this.session?.access_token) this.clear()
    if (response.status === 204) return {}
    const value = await response.json().catch(() => null)
    if (record(value) && value.ok === false && token === this.session?.access_token && (value.code === 'unauthorized' || value.code === 'invalid_session' || value.code === undefined)) this.clear()
    if (!response.ok || !record(value) || value.ok === false) throw Object.assign(new Error(typeof value?.message === 'string' ? value.message : typeof value?.error_description === 'string' ? value.error_description : 'Permintaan akun gagal. Coba kembali.'), { code: typeof value?.code === 'string' ? value.code : undefined })
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

  async authenticate(email: string, password: string, signup: boolean): Promise<'ok' | 'mfa' | 'confirm'> {
    this.pending = null
    const value = await this.request(signup ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', { email, password })
    if (!value.access_token) return 'confirm'
    return this.begin(value)
  }

  /** Whether this Auth server has Google sign-in configured (public settings, no session needed). */
  async googleEnabled() {
    const settings = await this.request('/auth/v1/settings', undefined, undefined, 'GET')
    return record(settings.external) && settings.external.google === true
  }

  /** Google through Auth's PKCE flow: the browser leaves for Google and comes back to `returnTo` with ?code=. */
  async startGoogle(returnTo: string) {
    const verifier = pkceVerifier()
    sessionStorage.setItem(pkceKey, verifier)
    const query = new URLSearchParams({ provider: 'google', redirect_to: returnTo, code_challenge: await pkceChallenge(verifier), code_challenge_method: 's256' })
    location.assign(`${endpoint}/auth/v1/authorize?${query}`)
  }

  /** Finishes a Google return; the verifier is single-use and only lives in this tab. */
  async completeGoogle(code: string): Promise<'ok' | 'mfa'> {
    const verifier = sessionStorage.getItem(pkceKey)
    sessionStorage.removeItem(pkceKey)
    if (!verifier) throw new Error('Proses masuk Google tidak dimulai dari tab ini. Coba lagi.')
    this.pending = null
    return this.begin(await this.request('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }))
  }

  /** A fresh sign-in either becomes the session or waits for its second factor (aal1 is never stored). */
  private begin(value: Record<string, unknown>): 'ok' | 'mfa' {
    const factors = record(value.user) && Array.isArray(value.user.factors) ? value.user.factors : []
    if (factors.some(f => record(f) && f.status === 'verified')) { this.pending = value; return 'mfa' }
    this.store(value)
    return 'ok'
  }

  private async factors(token: string) {
    const user = await this.request('/auth/v1/user', undefined, token, 'GET')
    return (Array.isArray(user.factors) ? user.factors : []).filter((f): f is { id: string; status: string } => record(f) && f.factor_type === 'totp' && typeof f.id === 'string' && uuid.test(f.id))
  }

  private async confirmFactor(id: string, code: string, token: string) {
    const challenge = await this.request(`/auth/v1/factors/${id}/challenge`, {}, token)
    this.store(await this.request(`/auth/v1/factors/${id}/verify`, { challenge_id: challenge.id, code: totpCode(code) }, token))
    this.pending = null
  }

  /** Second factor: finishes a pending sign-in, or renews the code time for actions that need a fresh one. */
  async verifyMfa(code: string) {
    totpCode(code)
    if (!this.pending) await this.refreshIfNeeded()
    const token = String((this.pending ?? this.session)?.access_token ?? '')
    const factor = (await this.factors(token)).find(f => f.status === 'verified')
    if (!factor) throw new Error('Aktifkan 2FA di bagian Keamanan akun lebih dulu.')
    await this.confirmFactor(factor.id, code, token)
  }

  /** Starts TOTP enrollment; unfinished earlier enrollments are removed first. */
  async enrollMfa(): Promise<TotpEnrollment> {
    await this.refreshIfNeeded()
    const token = this.session!.access_token
    for (const f of await this.factors(token)) if (f.status !== 'verified') await this.request(`/auth/v1/factors/${f.id}`, undefined, token, 'DELETE')
    const value = await this.request('/auth/v1/factors', { factor_type: 'totp' }, token)
    const totp = value.totp
    if (typeof value.id !== 'string' || !uuid.test(value.id) || !record(totp) || typeof totp.secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(totp.secret) || typeof totp.uri !== 'string' || !totp.uri.startsWith('otpauth://totp/')) throw new Error('Respons 2FA tidak valid.')
    return { id: value.id, secret: totp.secret, uri: totp.uri }
  }

  async confirmMfa(id: string, code: string) {
    await this.refreshIfNeeded()
    await this.confirmFactor(id, code, this.session!.access_token)
  }

  /** Needs a current code: Auth only removes a verified factor from an aal2 session. */
  async removeMfa(code: string) {
    await this.verifyMfa(code)
    const token = this.session!.access_token
    for (const f of await this.factors(token)) await this.request(`/auth/v1/factors/${f.id}`, undefined, token, 'DELETE')
    // The old token still says aal2; refresh so the UI reflects the change.
    this.store(await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: this.session!.refresh_token }))
  }

  async signOutOthers() {
    await this.refreshIfNeeded()
    await this.request('/auth/v1/logout?scope=others', {}, this.session!.access_token)
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

  async rpc(name: 'ensure_my_account' | 'my_products' | 'issue_activation_nonce' | 'my_device_units' | 'unit_measurements' | 'create_my_unit' | 'published_profile_versions' | 'unit_explanations' | 'knowledge_workspace' | 'submit_profile_contribution' | 'revise_profile_contribution' | 'review_profile_contribution' | 'published_profile_details' | 'assign_unit_profile' | 'energy_workspace' | 'operator_register_energy_meter' | 'operator_revoke_energy_meter' | 'operator_set_reward_policy' | 'operator_upsert_catalog' | 'reserve_my_reward' | 'cancel_my_redemption' | 'operator_fulfill_redemption' | 'operator_compensate_redemption' | 'reward_workspace' | 'create_transfer_offer' | 'cancel_transfer_offer' | 'accept_transfer' | 'security_workspace', body?: unknown) {
    await this.refreshIfNeeded()
    return this.request(`/rest/v1/rpc/${name}`, body, this.session!.access_token)
  }

  async claim(nonceId: string, sealedCode: string, signature: string) {
    await this.refreshIfNeeded()
    return this.request('/functions/v1/product-claim', { nonce_id: nonceId, sealed_code: sealedCode, signature }, this.session!.access_token)
  }

  /** ID-01: registry status of a public serial; needs no account. */
  publicStatus(serial: string) { return this.request('/rest/v1/rpc/product_public_status', { p_serial: serial }) }

  async explain(unitId: string, deviceId: string, requestId: string, question: string) {
    await this.refreshIfNeeded()
    // The server may wait up to 20 s for the optional AI wording before it saves the snapshot.
    return this.request('/functions/v1/unit-explanation', { unit_id: unitId, device_id: deviceId, request_id: requestId, question }, this.session!.access_token, 'POST', 45000)
  }

  async logout() {
    const token = this.session?.access_token
    this.pending = null
    this.clear()
    if (token) await this.request('/auth/v1/logout?scope=local', {}, token)
  }
}

export interface PublicStatus { serial_public: string; variant: 'single_pot' | 'garden'; registry_status: 'active' | 'revoked' | 'pending'; claimed: boolean }
export function parsePublicStatus(value: unknown): PublicStatus {
  if (!record(value) || typeof value.serial_public !== 'string' || !['single_pot', 'garden'].includes(String(value.variant)) || !['active', 'revoked', 'pending'].includes(String(value.registry_status)) || typeof value.claimed !== 'boolean') throw new Error('Status produk tidak valid.')
  return { serial_public: value.serial_public, variant: value.variant as PublicStatus['variant'], registry_status: value.registry_status as PublicStatus['registry_status'], claimed: value.claimed }
}
