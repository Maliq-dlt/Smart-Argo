import { features } from './appMode.ts'
import { normalizeDisplayName, normalizeEmailCode } from './signupForm.ts'
import { isCuratedId, type CuratedId } from './species.ts'
import { parseSnapshot, type WeatherSnapshot } from './weather.ts'
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
/** Deletion with a 14-day grace period (20261122000000_account_deletion_avatar): serials, never names. */
export interface AccountDeletion { pending: boolean; requestedAt: string; purgeAfter: string; released: string[]; restorable: string[] }
const serials = (value: unknown) => Array.isArray(value) && value.length <= 1000 && value.every(s => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(s)) ? value as string[] : null
export function parseDeletion(value: unknown): AccountDeletion | null {
  if (!record(value) || value.pending !== true) return null
  const released = serials(value.released), restorable = serials(value.restorable)
  if (!validDate(value.requested_at) || !validDate(value.purge_after) || !released || !restorable) throw new Error('Status penghapusan akun tidak valid.')
  return { pending: true, requestedAt: value.requested_at, purgeAfter: value.purge_after, released, restorable }
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
/** Backend gates answer in English; these codes get the app's own words (see privileged_write_gate, activation_mfa). */
const GATE_TEXT: Record<string, string> = {
  mfa_required: 'Aksi ini memerlukan 2FA. Aktifkan di Profil, bagian Keamanan, lalu masuk kembali dengan kodenya.',
  step_up_required: 'Masukkan kode 2FA terbaru untuk melanjutkan aksi ini.',
  forbidden: 'Akun ini tidak punya peran untuk aksi tersebut.',
  rate_limited: 'Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.',
  unit_unavailable: 'Unit ini tidak tersedia untuk akun Anda.',
  invalid_request: 'Isian tidak valid. Periksa lagi lalu coba kembali.',
  request_conflict: 'Kiriman ini bentrok dengan kiriman sebelumnya. Muat ulang lalu coba lagi.',
  request_pending: 'Permintaan yang sama masih diproses. Tunggu sebentar.',
  request_expired: 'Permintaan kedaluwarsa. Kirim ulang.',
  invalid_range: 'Rentang waktu tidak valid.',
  range_too_large: 'Rentang terlalu besar. Perkecil rentangnya.',
  invalid_cursor: 'Halaman berikutnya tidak valid. Muat ulang daftar.',
  export_too_large: 'Data terlalu banyak untuk satu berkas. Perkecil rentang tanggal.',
  subject_unavailable: 'Hanya hasil energi (30 hari) atau penukaran (90 hari) milik Anda yang bisa diajukan.',
  case_open: 'Sudah ada pengajuan yang belum diputus untuk hal ini.',
  case_unavailable: 'Pengajuan tidak ditemukan.',
  state_conflict: 'Status sudah berubah. Muat ulang lalu coba lagi.',
  self_review: 'Anda tidak boleh memutus perkara yang melibatkan akun Anda sendiri.',
  already_owner: 'Produk ini sudah milik Anda.',
  product_unavailable: 'Produk tidak terdaftar atau sudah dicabut.',
  unit_mismatch: 'Perangkat ditempatkan di unit lain.',
  invalid_label: 'Nama unit harus 1–120 karakter.',
  unit_limit: 'Batas unit untuk produk ini sudah tercapai. Arsipkan unit lain dulu.',
  device_unavailable: 'Perangkat tidak aktif atau bukan milik Anda.',
  invalid_manifest: 'Manifest tidak sesuai format resmi.',
  manifest_unverified: 'Manifest harus dikirim lewat layanan provisioning agar tanda tangannya diperiksa.',
  unknown_issuer: 'Kunci penerbit pada manifest tidak dikenal.',
  invalid_signature: 'Tanda tangan tidak sah.',
  serial_taken: 'Serial sudah terdaftar.',
  key_in_use: 'Salah satu kunci perangkat sudah terdaftar.',
  invalid_code: 'Kode tidak cocok.',
  email_exists: 'Email ini sudah terdaftar.',
  security_hold: 'Ditahan 24 jam setelah kata sandi atau 2FA diubah, untuk melindungi akun dan produk Anda.',
  reauth_required: 'Verifikasi ulang dulu: masukkan kata sandi, atau masuk ulang dengan Google.',
  no_pending_deletion: 'Tidak ada penghapusan akun yang menunggu.',
  invalid_image: 'Foto harus berupa gambar WebP, JPEG, atau PNG.',
  avatar_too_large: 'Foto terlalu besar. Pilih foto lain.',
}
/** One wording for every failed account call: a known code gets the app's text, otherwise the server's message. */
function accountError(value: unknown) {
  const v = record(value) ? value : {}
  const code = typeof v.code === 'string' ? v.code : undefined
  const text = code && Object.hasOwn(GATE_TEXT, code) ? GATE_TEXT[code] : typeof v.message === 'string' ? v.message : typeof v.msg === 'string' ? v.msg : typeof v.error_description === 'string' ? v.error_description : 'Permintaan akun gagal. Coba kembali.'
  return Object.assign(new Error(text), { code })
}
/** The RPCs the app calls (Supabase migrations define them). */
type RpcName = 'append_my_care_journal' | 'read_my_care_journal' | 'read_my_measurement_history' |'compare_my_measurement_history' | 'open_reward_appeal' | 'my_reward_cases' | 'operator_reward_cases' | 'operator_take_reward_case' | 'operator_decide_reward_case' | 'open_ownership_recovery' | 'withdraw_ownership_recovery' | 'my_ownership_recoveries' | 'operator_recovery_cases' | 'operator_take_recovery_case' | 'operator_decide_recovery_case' | 'rename_my_unit' | 'archive_my_unit' | 'restore_my_unit' | 'place_my_device' | 'my_units' | 'my_unit_history' | 'my_unit_overview' | 'create_my_recovery_codes' | 'my_recovery_codes_status' | 'my_chain_proofs' | 'operator_outbox_status' | 'operator_rotate_device_key' | 'operator_revoke_device' | 'operator_revoke_product' | 'operator_registry_history' | 'ensure_my_account' | 'my_products' | 'issue_activation_nonce' | 'my_device_units' | 'unit_measurements' | 'create_my_unit' | 'published_profile_versions' | 'unit_explanations' | 'knowledge_workspace' | 'submit_profile_contribution' | 'revise_profile_contribution' | 'review_profile_contribution' | 'published_profile_details' | 'assign_unit_profile' | 'energy_workspace' | 'operator_register_energy_meter' | 'operator_revoke_energy_meter' | 'operator_set_reward_policy' | 'operator_upsert_catalog' | 'reserve_my_reward' | 'cancel_my_redemption' | 'operator_fulfill_redemption' | 'operator_compensate_redemption' | 'reward_workspace' | 'create_transfer_offer' | 'cancel_transfer_offer' | 'accept_transfer' | 'security_workspace' | 'my_garden' | 'add_my_site' | 'plant_in_my_slot' | 'switch_my_plant' | 'my_account_deletion' | 'request_account_deletion' | 'cancel_account_deletion' | 'my_avatar' | 'set_my_avatar' | 'clear_my_avatar'
export interface TotpEnrollment { id: string; secret: string; uri: string }
/** The first pot, asked once after sign-up. `crop` is a curated species id (src/lib/species.ts), which names the
 * simulator profile it opens; `device` says whether a Smart Agro unit is on hand to activate.
 * ponytail: learning species (anggrek, peoni) are refused until Fase 4 gives them an "observe" journey to open. */
export interface PotSetup { name: string; crop: CuratedId; device: boolean }
/** Metadata comes back from the token, which its owner can write: validate it like any other input. */
export function parsePot(value: unknown): PotSetup | null {
  if (!record(value) || typeof value.name !== 'string' || typeof value.device !== 'boolean' || !isCuratedId(value.crop)) return null
  const name = value.name.trim().replace(/\s+/g, ' ')
  const clean = name.length > 0 && name.length <= 40 && !/[<>]/.test(name) && ![...name].some(c => c.charCodeAt(0) < 32)
  return clean ? { name, crop: value.crop, device: value.device } : null
}
const totpCode = (code: string) => { const value = code.replace(/\s/g, ''); if (!/^\d{6}$/.test(value)) throw new Error('Kode autentikator harus 6 angka.'); return value }
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
const runtime = (globalThis as typeof globalThis & { SMART_AGRO_CONFIG?: Record<string, unknown> }).SMART_AGRO_CONFIG
const endpoint = (typeof runtime?.url === 'string' ? runtime.url : env?.VITE_SUPABASE_URL)?.replace(/\/$/, '') ?? ''
const anonKey = (typeof runtime?.anonKey === 'string' ? runtime.anonKey : env?.VITE_SUPABASE_ANON_KEY) ?? ''
const storageKey = `smart-agro.account:${endpoint}`
const pkceKey = `smart-agro.pkce:${endpoint}`
// The sign-up verifier outlives the tab: the confirmation link usually opens in a new one.
const signupPkceKey = `smart-agro.pkce-signup:${endpoint}`
// Password reset (APP-01) uses PKCE like sign-up: the email link returns with ?code= in this browser.
const resetPkceKey = `smart-agro.pkce-reset:${endpoint}`
const local = { get: (key: string) => { try { return localStorage.getItem(key) } catch { return null } }, drop: (key: string) => { try { localStorage.removeItem(key) } catch { /* storage blocked */ } } }
export const productAccountConfigured = Boolean(endpoint && anonKey && (() => {
  try { const u = new URL(endpoint); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) } catch { return false }
})())
/** Set `VITE_SIGN_IN_REQUIRED=true` to make every visitor sign in (the gate then offers no guest visit). The hosted
 * demo leaves it off since 2026-11-14, so visitors can try the simulator first. */
export const signInRequired = productAccountConfigured && (env?.VITE_SIGN_IN_REQUIRED === 'true' || !features.guest)

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
    // Only an explicit session verdict signs out; an error of unknown shape must not cost the visitor their session.
    if (record(value) && value.ok === false && token === this.session?.access_token && (value.code === 'unauthorized' || value.code === 'invalid_session')) this.clear()
    if (!response.ok || !record(value) || value.ok === false) throw accountError(value)
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

  /** Sign-up runs PKCE, so the confirmation link returns to `returnTo` with ?code= and never puts tokens in the URL. */
  async authenticate(email: string, password: string, signup: boolean, returnTo?: string, name?: string): Promise<'ok' | 'mfa' | 'confirm'> {
    this.pending = null
    if (!signup) {
      const value = await this.request('/auth/v1/token?grant_type=password', { email, password })
      return value.access_token ? this.begin(value) : 'confirm'
    }
    const verifier = pkceVerifier()
    try { localStorage.setItem(signupPkceKey, verifier) } catch { /* storage blocked: the link still confirms, then sign in by password */ }
    const query = returnTo ? `?${new URLSearchParams({ redirect_to: returnTo })}` : ''
    const display = normalizeDisplayName(name)
    let value: Record<string, unknown>
    try { value = await this.request(`/auth/v1/signup${query}`, { email, password, ...(display ? { data: { display_name: display } } : {}), code_challenge: await pkceChallenge(verifier), code_challenge_method: 's256' }) } catch (err) {
      // Local Auth (auto-confirm) refuses a repeated sign-up outright; hosted Auth answers it with an empty user, below.
      if (err instanceof Error && /already (been )?registered/i.test(err.message)) throw accountError({ code: 'email_exists' })
      throw err
    }
    // Hosted Auth hides whether an address is taken: for a confirmed one it answers 200 with a user without identities and
    // sends no email, so the person would wait for a code that never comes. Say so instead (ponytail: this reveals
    // that the address has an account, which the request asked for; Auth's own rate limits bound guessing).
    if (!value.access_token && Array.isArray(value.identities) && value.identities.length === 0) throw accountError({ code: 'email_exists' })
    if (!value.access_token) return 'confirm'
    local.drop(signupPkceKey)
    return this.begin(value)
  }

  /** Finishes a sign-up with the six-digit code from the confirmation email (Auth /verify, type signup). */
  async verifySignupCode(email: string, code: string): Promise<'ok' | 'mfa'> {
    const token = normalizeEmailCode(code)
    if (token.length !== 6) throw new Error('Kode verifikasi harus 6 angka.')
    this.pending = null
    const value = await this.request('/auth/v1/verify', { type: 'signup', email, token })
    local.drop(signupPkceKey)
    return this.begin(value)
  }

  /** Sends the signup confirmation email again (Auth also enforces its own minimum gap between emails). */
  async resendSignupCode(email: string): Promise<void> {
    await this.request('/auth/v1/resend', { type: 'signup', email })
  }

  /** Auth user metadata is the owner's own preferences, never used for access decisions; the refreshed token carries it. */
  private async saveMetadata(data: Record<string, unknown>) {
    await this.refreshIfNeeded()
    await this.request('/auth/v1/user', { data }, this.session!.access_token, 'PUT')
    this.store(await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: this.session!.refresh_token }))
  }

  /** The name shown in the app; returns it as stored. Not unique and not an identifier (ponytail: a unique handle needs its own table). */
  async updateDisplayName(name: string): Promise<string> {
    const clean = normalizeDisplayName(name)
    if (!clean) throw new Error('Nama harus 1–40 karakter.')
    await this.saveMetadata({ display_name: clean })
    return clean
  }

  /** Saves the first pot's setup on the account (Auth user metadata: the owner's own preferences, never used for
   * access decisions), then refreshes the session so its token carries it. */
  async savePot(pot: PotSetup) {
    const clean = parsePot(pot)
    if (!clean) throw new Error('Data pot tidak valid.')
    await this.saveMetadata({ pot: clean })
  }

  /** Whether this Auth server has Google sign-in configured (public settings, no session needed). */
  private googleSetting: Promise<boolean> | null = null
  /** What the server said about Google sign-in; null until it has answered. The gate reads it when it is drawn, so it opens in its final shape. */
  googleKnown: boolean | null = null
  /** One request for the life of the page, started when the app starts (AccountProvider), so the gate usually knows already. */
  googleEnabled(): Promise<boolean> {
    this.googleSetting ??= this.request('/auth/v1/settings', undefined, undefined, 'GET').then(
      settings => (this.googleKnown = record(settings.external) && settings.external.google === true),
      err => { this.googleSetting = null; throw err })
    return this.googleSetting
  }

  /** Google through Auth's PKCE flow: the browser leaves for Google and comes back to `returnTo` with ?code=. */
  async startGoogle(returnTo: string) {
    const verifier = pkceVerifier()
    sessionStorage.setItem(pkceKey, verifier)
    const query = new URLSearchParams({ provider: 'google', redirect_to: returnTo, code_challenge: await pkceChallenge(verifier), code_challenge_method: 's256' })
    location.assign(`${endpoint}/auth/v1/authorize?${query}`)
  }

  /** Finishes a PKCE return: Google (verifier in this tab) or an email confirmation link (verifier in this browser). Single-use. */
  async completeReturn(code: string): Promise<'ok' | 'mfa'> {
    const reset = local.get(resetPkceKey)
    const verifier = sessionStorage.getItem(pkceKey) ?? local.get(signupPkceKey) ?? reset
    sessionStorage.removeItem(pkceKey)
    local.drop(signupPkceKey)
    local.drop(resetPkceKey)
    this.resetting = Boolean(reset) && verifier === reset
    if (!verifier) throw new Error('Proses masuk tidak dimulai di browser ini. Jika Anda baru mengonfirmasi email, silakan masuk dengan email dan kata sandi.')
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

  /** Asks the person for an authenticator code (null when they cancel). Set by AccountProvider. */
  stepUp: (() => Promise<string | null>) | null = null

  /** Operator and curator writes need a code from the last five minutes (privileged_write_gate); when the server asks,
   * the app collects one, verifies it, and repeats the call once. Other calls keep their own handling. */
  async rpc(name: RpcName, body?: unknown) {
    await this.refreshIfNeeded()
    try { return await this.request(`/rest/v1/rpc/${name}`, body, this.session!.access_token) }
    catch (err) {
      if ((err as { code?: string }).code !== 'step_up_required' || !/^(operator_|review_profile_contribution$|create_my_recovery_codes$)/.test(name) || !this.stepUp) throw err
      const code = await this.stepUp()
      if (!code) throw err
      await this.verifyMfa(code)
      return this.request(`/rest/v1/rpc/${name}`, body, this.session!.access_token)
    }
  }

  async claim(nonceId: string, sealedCode: string, signature: string) {
    await this.refreshIfNeeded()
    return this.request('/functions/v1/product-claim', { nonce_id: nonceId, sealed_code: sealedCode, signature }, this.session!.access_token)
  }

  /** The owner's sensor history for [from,to) as CSV (history-export, see docs/care-history-api.md). */
  async exportHistory(unitId: string, from: string, to: string) {
    await this.refreshIfNeeded()
    const token = this.session!.access_token
    const response = await fetch(`${endpoint}/functions/v1/history-export`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ unit_id: unitId, from, to }), signal: AbortSignal.timeout(30000),
    })
    if (response.status === 401 && token === this.session?.access_token) this.clear()
    if (!response.ok) throw accountError(await response.json().catch(() => null))
    if (!response.headers.get('content-type')?.startsWith('text/csv')) throw new Error('Berkas histori tidak valid.')
    return { csv: await response.blob(), rows: Number(response.headers.get('x-history-row-count')) || 0 }
  }

  /** True after a password-reset link signed the person in: the app asks for a new password before anything else. */
  resetting = false

  /** Sends the reset email (Auth answers the same whether or not the address exists). */
  async requestPasswordReset(email: string, returnTo: string) {
    const verifier = pkceVerifier()
    try { localStorage.setItem(resetPkceKey, verifier) } catch { throw new Error('Browser menolak penyimpanan lokal, jadi tautan reset tidak bisa diselesaikan di sini.') }
    await this.request(`/auth/v1/recover?${new URLSearchParams({ redirect_to: returnTo })}`, { email: email.trim(), code_challenge: await pkceChallenge(verifier), code_challenge_method: 's256' })
  }

  async setPassword(password: string) {
    if (password.length < 10) throw new Error('Kata sandi minimal 10 karakter.')
    await this.refreshIfNeeded()
    await this.request('/auth/v1/user', { password }, this.session!.access_token, 'PUT')
    this.resetting = false
  }

  /** APP-01, lost authenticator: spends a recovery code for the password sign-in that waits for its second factor. */
  async recoverMfa(code: string) {
    if (!this.pending) throw new Error('Masuk dengan email dan kata sandi dulu.')
    const value = this.pending
    await this.request('/functions/v1/mfa-recovery', { code: code.trim() }, String(value.access_token))
    // The factor is gone, so this session now reaches data; refresh so the token reflects it.
    this.pending = null
    this.store(await this.request('/auth/v1/token?grant_type=refresh_token', { refresh_token: value.refresh_token }))
  }

  /** ID-04: registers a product from an issuer-signed manifest; asks for a fresh code when the server wants one. */
  async provision(body: { request_id: string; manifest: string; signature: string; activation_secret_hash: string }) {
    await this.refreshIfNeeded()
    try { return await this.request('/functions/v1/product-provision', body, this.session!.access_token) }
    catch (err) {
      if ((err as { code?: string }).code !== 'step_up_required' || !this.stepUp) throw err
      const code = await this.stepUp()
      if (!code) throw err
      await this.verifyMfa(code)
      return this.request('/functions/v1/product-provision', body, this.session!.access_token)
    }
  }

  /** The weather now at an outdoor place, from Open-Meteo through the server (which rounds the place first). */
  async weather(place: { lat: number; lon: number }): Promise<WeatherSnapshot> {
    await this.refreshIfNeeded()
    return parseSnapshot((await this.request('/functions/v1/weather-forecast', { lat: place.lat, lon: place.lon }, this.session!.access_token, 'POST', 10000)).weather)
  }

  /** ID-01: registry status of a public serial; needs no account. */
  publicStatus(serial: string) { return this.request('/rest/v1/rpc/product_public_status', { p_serial: serial }) }

  async explain(unitId: string, deviceId: string, requestId: string, question: string) {
    await this.refreshIfNeeded()
    // The server may wait up to 20 s for the optional AI wording before it saves the snapshot.
    return this.request('/functions/v1/unit-explanation', { unit_id: unitId, device_id: deviceId, request_id: requestId, question }, this.session!.access_token, 'POST', 45000)
  }

  /** The server signs every session out when it accepts the request, so the local copy goes too. */
  async requestDeletion(): Promise<AccountDeletion> {
    const value = await this.rpc('request_account_deletion')
    this.pending = null; this.clear()
    const deletion = parseDeletion(record(value.deletion) ? value.deletion : null)
    if (!deletion) throw new Error('Status penghapusan akun tidak valid.')
    return deletion
  }

  async logout() {
    const token = this.session?.access_token
    this.pending = null
    this.clear()
    if (token) await this.request('/auth/v1/logout?scope=local', {}, token)
  }
}

/** Public registry status; manifest fields are null for products registered before signed manifests (ID-01). */
export interface PublicStatus { serial_public: string; variant: 'single_pot' | 'garden'; registry_status: 'active' | 'revoked' | 'pending'; claimed: boolean
  manifest: string | null; issuer_key_id: string | null; issuer_signature: string | null; issuer_verified: boolean }
const optional = (v: unknown, max: number) => v === null || v === undefined ? null : typeof v === 'string' && v.length <= max ? v : (() => { throw new Error('Status produk tidak valid.') })()
export function parsePublicStatus(value: unknown): PublicStatus {
  if (!record(value) || typeof value.serial_public !== 'string' || !['single_pot', 'garden'].includes(String(value.variant)) || !['active', 'revoked', 'pending'].includes(String(value.registry_status)) || typeof value.claimed !== 'boolean') throw new Error('Status produk tidak valid.')
  return { serial_public: value.serial_public, variant: value.variant as PublicStatus['variant'], registry_status: value.registry_status as PublicStatus['registry_status'], claimed: value.claimed,
    manifest: optional(value.manifest, 8192), issuer_key_id: optional(value.issuer_key_id, 64), issuer_signature: optional(value.issuer_signature, 88), issuer_verified: value.issuer_verified === true }
}

/** Issuer public keys pinned in this build ({"key-id": "<base64 Ed25519>"}); the trust anchor for A04's check. */
export const pinnedIssuerKeys: Record<string, string> = (() => {
  try { const v: unknown = JSON.parse(String((typeof runtime?.issuerKeys === 'string' ? runtime.issuerKeys : env?.VITE_ISSUER_PUBLIC_KEYS) ?? '{}')); return record(v) ? Object.fromEntries(Object.entries(v).filter(([, k]) => typeof k === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(k))) as Record<string, string> : {} } catch { return {} }
})()

/** A04 "Tanda tangan penerbit sah?" checked in this browser against the pinned key, not taken from the server's word.
 * 'unavailable': no manifest, key not pinned, or the browser lacks Ed25519 (then only the server attestation remains). */
export async function verifyIssuerManifest(status: PublicStatus, keys = pinnedIssuerKeys): Promise<'valid' | 'invalid' | 'unavailable'> {
  if (!status.manifest || !status.issuer_signature || !status.issuer_key_id || !Object.hasOwn(keys, status.issuer_key_id)) return 'unavailable'
  let manifest: unknown
  try { manifest = JSON.parse(status.manifest) } catch { return 'invalid' }
  // The signed bytes must describe this very product.
  if (!record(manifest) || manifest.serial_public !== status.serial_public || manifest.variant !== status.variant || manifest.issuer_key_id !== status.issuer_key_id) return 'invalid'
  const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  try {
    const key = await crypto.subtle.importKey('raw', bytes(keys[status.issuer_key_id]), 'Ed25519', false, ['verify'])
    return await crypto.subtle.verify('Ed25519', key, bytes(status.issuer_signature), new TextEncoder().encode(status.manifest)) ? 'valid' : 'invalid'
  } catch { return 'unavailable' }
}
