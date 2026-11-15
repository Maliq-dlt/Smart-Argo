# Fase 0: Akun, Verifikasi Kode, dan Email — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Daftar dengan nama dan konfirmasi sandi, verifikasi email lewat kode 6 angka sebelum "Siapkan pot", nama tampilan yang bisa diubah di Profil, dan email konfirmasi/reset sandi berbahasa Indonesia yang bermerek.

**Architecture:** Logika murni (validasi form, normalisasi kode, identitas dari token) dipisah ke `src/lib/` supaya bisa diuji dengan `node --test`. `ProductAccountClient` mendapat tiga panggilan Auth baru (`verify`, `resend`, simpan nama). UI menambah satu komponen layar kode dan satu editor nama. Email berupa templat HTML di repo yang diterapkan ke Supabase Auth cloud lewat skrip bercadangan; tautan konfirmasi tetap ada di email sebagai cadangan, jadi frontend lama tetap berfungsi selama transisi.

**Tech Stack:** React 19 + TypeScript, Vite, `node --test` (strip-types), Playwright (Chrome) dengan Auth tiruan, Supabase Auth (GoTrue) dan Management API.

**Spec:** `docs/superpowers/specs/2026-11-15-panggung-pot-kebun-cuaca-design.md`, bagian "Fase 0".

## Global Constraints

- Semua teks UI dan email berbahasa Indonesia, singkat, tanpa label kecil di atas judul. Font Fraunces Soft (judul) dan General Sans (lainnya); warna di komponen hanya lewat token CSS. Email memakai hex inline karena klien email tidak membaca token: `#ecefe7` bg, `#f6f7f2` surface, `#fbfcf9` raised, `#18211b` ink, `#55615a` muted, `#2f5a3c` primary, `#c3df95` accent, `#1c2f12` accent-ink.
- Kode verifikasi 6 angka, berlaku 10 menit (`mailer_otp_length` 6, `mailer_otp_exp` 600). Jeda kirim ulang 60 detik (sama dengan `smtp_max_frequency`). Sandi baru minimal 10 karakter (`NEW_PASSWORD_MIN`). Nama tampilan 1–40 karakter.
- Reduced motion dihormati; teks 200% tidak meluap di 375 dan 320 px; screenshot 1440/768/390/320 px, terang dan gelap.
- Pemeriksaan wajib per tugas yang menyentuh kode: `npm run typecheck`, `npm run lint`, `npm test`; sebelum selesai fase: `npm run build` dan `git diff --check`.
- Tes browser: `PLAYWRIGHT_MODULE=C:/Users/malik/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright`; sajikan build dengan `node node_modules/vite/bin/vite.js preview --port 4173 --strictPort` setelah memastikan port bebas; matikan server setelah selesai.
- **Commit, push, deploy, dan perubahan konfigurasi Auth cloud hanya atas permintaan pengguna.** Langkah "Commit" di bawah dijalankan hanya bila pengguna sudah meminta commit pada sesi ini; bila belum, biarkan perubahan di working tree. Pesan commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tidak ada rahasia di repo atau di output: `.tmp/cloud/*.env` tidak dicetak, tidak di-commit.
- `ponytail:` tandai penyederhanaan sengaja (nama tampilan tidak unik; jeda kirim ulang hanya di klien, server tetap membatasi lewat `smtp_max_frequency`).

## Review Focus

Masukan yang tersirat dari spec tetapi mudah luput; tiap baris punya tes di tugas pemiliknya.

1. **Kode ditempel dengan spasi/strip/baris baru** ("482 915", "482-915", "482915\n") atau lebih dari 6 digit → dinormalisasi jadi 6 digit (Tugas 1; Tugas 4 lewat tempel di input).
2. **Kirim ganda**: submit otomatis pada digit ke-6 ditambah Enter atau klik tidak boleh memanggil `/verify` dua kali (panggilan kedua akan gagal "kedaluwarsa" setelah yang pertama berhasil) (Tugas 4).
3. **Metadata token dipalsukan**: `display_name` sepanjang 10.000 karakter, bukan string, atau berisi karakter kontrol/bidi → identitas jatuh ke `full_name`, `name`, lalu bagian depan email; tidak pernah merender teks raksasa (Tugas 2).
4. **Kode salah/kedaluwarsa dan masuk sebelum terverifikasi**: pesan jelas, input dikosongkan dan difokuskan; masuk dengan email belum terkonfirmasi membuka layar kode dengan tombol kirim ulang yang langsung aktif (Tugas 4).
5. **Nama aneh**: hanya spasi, 41 karakter, emoji (dihitung per titik kode), `\u0000`, dan pengendali arah (`\u202e`) → ditolak/dinormalisasi dengan benar (Tugas 1).

## File Structure

| Berkas | Tanggung jawab |
| --- | --- |
| `src/lib/signupForm.ts` (baru) | `normalizeDisplayName`, `normalizeEmailCode`, `checkSignup`; murni |
| `src/lib/identity.ts` (baru) | `identityFromClaims`: nama/email/google/pot dari klaim token; murni |
| `src/lib/productAccountClient.ts` | `authenticate(..., name?)`, `verifySignupCode`, `resendSignupCode`, `updateDisplayName`, `accountError` membaca `msg` |
| `src/components/EmailCodeStep.tsx` (baru) | Layar kode: input, kirim ulang bercooldown, ganti email |
| `src/components/DisplayNameEditor.tsx` (baru) | Baris "Nama" di Profil dengan ubah/simpan |
| `src/components/AccountSignIn.tsx`, `AccountGate.tsx`, `AccountProvider.tsx`, `ProfilePage.tsx`, `src/styles.css` | Form Daftar baru, status langkah kode, pemakaian identitas baru, gaya |
| `supabase/templates/confirmation.html`, `recovery.html` (baru) | Templat email |
| `public/mail/header.png` (baru) | Gambar kepala email (PNG, bukan SVG, karena Gmail) |
| `scripts/build-mail-assets.mjs`, `preview-email.mjs`, `apply-auth-email.mjs` (baru) | Membuat gambar, pratinjau PNG, menerapkan ke cloud dengan cadangan |
| `tests/*` | Lihat tiap tugas |

---

### Task 1: Pembantu form pendaftaran

**Files:**
- Create: `src/lib/signupForm.ts`
- Test: `tests/signupForm.test.ts`

**Interfaces:**
- Produces:
  - `export const DISPLAY_NAME_MAX = 40`
  - `export function normalizeDisplayName(raw: unknown): string | null`: dipangkas, spasi dalam dilipat jadi satu; `null` kecuali 1–40 titik kode tanpa karakter kontrol (`\p{Cc}`) dan tanpa pengendali arah `\u202a-\u202e\u2066-\u2069`.
  - `export function normalizeEmailCode(raw: string): string`: hanya angka ASCII, maksimal 6.
  - `export type SignupCheck = { ok: true; name: string } | { ok: false; field: 'name' | 'confirm'; message: string }`
  - `export function checkSignup(input: { name: string; password: string; confirm: string }): SignupCheck`: nama diperiksa lebih dulu; konfirmasi harus sama persis dengan sandi (selisih spasi akhir = beda).

- [ ] **Step 1: Tulis tes yang gagal** di `tests/signupForm.test.ts` (gaya `node:test` + `assert/strict`, impor `../src/lib/signupForm.ts`):

```ts
test('display name is trimmed and collapsed', () => assert.equal(normalizeDisplayName('  Maliq   Athaya '), 'Maliq Athaya'))
test('display name rejects blank, non-strings, and 41 characters; accepts 40', () => {
  for (const bad of ['', '   ', 42, null, 'x'.repeat(41)]) assert.equal(normalizeDisplayName(bad), null)
  assert.equal(normalizeDisplayName('x'.repeat(40)), 'x'.repeat(40))
})
test('display name counts code points, so 40 emoji pass and 41 do not', () => {
  assert.equal(normalizeDisplayName('🌱'.repeat(40)), '🌱'.repeat(40))
  assert.equal(normalizeDisplayName('🌱'.repeat(41)), null)
})
test('display name rejects control and bidi-override characters', () => {
  assert.equal(normalizeDisplayName('Tani\u0000'), null)
  assert.equal(normalizeDisplayName('Tani\u202egnos'), null)
})
test('email code keeps six ASCII digits however it was pasted', () => {
  for (const [raw, want] of [['482 915', '482915'], ['482-915', '482915'], ['482915\n', '482915'], ['4829151234', '482915'], ['abc', ''], ['12', '12']]) assert.equal(normalizeEmailCode(raw), want)
})
test('checkSignup checks the name first, then the exact password match', () => {
  assert.deepEqual(checkSignup({ name: ' ', password: 'a', confirm: 'b' }), { ok: false, field: 'name', message: 'Isi nama Anda, 1–40 karakter.' })
  assert.deepEqual(checkSignup({ name: 'Maliq', password: 'cukup-panjang-12', confirm: 'cukup-panjang-12 ' }), { ok: false, field: 'confirm', message: 'Konfirmasi kata sandi belum sama.' })
  assert.deepEqual(checkSignup({ name: ' Maliq ', password: 'cukup-panjang-12', confirm: 'cukup-panjang-12' }), { ok: true, name: 'Maliq' })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal.** `node --experimental-strip-types --test tests/signupForm.test.ts` → FAIL (modul tidak ada).
- [ ] **Step 3: Implementasi** `src/lib/signupForm.ts` sesuai Interfaces. Pakai regex unicode (`/\p{Cc}/u`) dan `[...text].length` untuk hitung titik kode.
- [ ] **Step 4: Jalankan tes** → PASS (6 tes).
- [ ] **Step 5: Commit** (lihat Global Constraints): `feat(account): signup form helpers`.

---

### Task 2: Klien Auth: nama, verifikasi kode, kirim ulang; identitas dari token

**Files:**
- Create: `src/lib/identity.ts`; Test: `tests/identity.test.ts`, `tests/signupCode.test.ts`
- Modify: `src/lib/productAccountClient.ts` (`authenticate` ~baris 157, `savePot` ~174, `accountError` ~72), `src/components/AccountProvider.tsx` (`identityOf` ~baris 30)

**Interfaces:**
- Consumes: `normalizeDisplayName`, `normalizeEmailCode` (Tugas 1); `parsePot` dan `tokenClaims` yang sudah ada di `productAccountClient.ts`.
- Produces:
  - `identityFromClaims(claims: Record<string, unknown>): { email: string; name: string; google: boolean; pot: PotSetup | null }` di `src/lib/identity.ts`. Urutan nama: `user_metadata.display_name` (lewat `normalizeDisplayName`), `full_name`, `name`, bagian depan email, `'Akun'`. `AccountProvider.identityOf` memanggilnya dan tipe `Identity` tidak berubah.
  - `ProductAccountClient.authenticate(email: string, password: string, signup: boolean, returnTo?: string, name?: string): Promise<'ok' | 'mfa' | 'confirm'>`: pada pendaftaran, bila `normalizeDisplayName(name)` bukan null, body signup memuat `data: { display_name }`; selain itu tanpa `data`.
  - `verifySignupCode(email: string, code: string): Promise<'ok' | 'mfa'>`: `normalizeEmailCode(code)` harus 6 digit, jika tidak lempar `Error('Kode verifikasi harus 6 angka.')` tanpa memanggil jaringan; POST `/auth/v1/verify` body `{ type: 'signup', email, token }`; hapus `signupPkceKey`; hasilnya lewat `this.begin(value)`.
  - `resendSignupCode(email: string): Promise<void>`: POST `/auth/v1/resend` body `{ type: 'signup', email }`.
  - `updateDisplayName(name: string): Promise<string>`: nama dinormalisasi atau lempar `Error('Nama harus 1–40 karakter.')` tanpa jaringan; PUT `/auth/v1/user` `{ data: { display_name } }` lalu segarkan token seperti `savePot`; kembalikan nama bersih. `savePot` dan `updateDisplayName` berbagi satu pembantu privat `saveMetadata(data: Record<string, unknown>)`.
  - `accountError` membaca `msg` (kunci galat GoTrue) sesudah `message` dan `error_description`.

- [ ] **Step 1: Tes identitas yang gagal** (`tests/identity.test.ts`): dengan `identityFromClaims`:
  - `{ email: 'a@x.test', user_metadata: { display_name: 'Nama Saya', full_name: 'Nama Google' } }` → `name === 'Nama Saya'`.
  - `display_name` 10.000 karakter, `42`, dan `'Tani\u202egnos'` masing-masing → jatuh ke `full_name` ('Nama Google'); tanpa `full_name` dan `name` → `'a'`.
  - `app_metadata.providers: ['google']` → `google === true`; `user_metadata.pot` valid (`{ name: 'P', crop: 'cabai', device: false }`) → `pot` terisi, `crop: 'x'` → `pot === null`.
- [ ] **Step 2: Tes klien yang gagal** (`tests/signupCode.test.ts`), stub `fetch` dan `sessionStorage` seperti `tests/stepUp.test.ts` (`fresh()` untuk sesi `{ access_token: 'a.<acak>.s', refresh_token: 'r1', expires_in: 3600 }`):
  - sign-up `authenticate('tani@example.test', 'x'.repeat(12), true, undefined, '  Maliq  Athaya ')` mengirim `body.data` sama dengan `{ display_name: 'Maliq Athaya' }`; tanpa `name` atau `'  '`, `body.data` tidak ada.
  - `verifySignupCode('tani@example.test', '482 915')` memanggil path `/auth/v1/verify` dengan `{ type: 'signup', email: 'tani@example.test', token: '482915' }` dan, bila jawabannya sesi tanpa faktor, mengembalikan `'ok'`; bila `user.factors` berisi `{ status: 'verified' }`, `'mfa'`.
  - `verifySignupCode(..., '12345')` menolak dengan `/6 angka/` dan jumlah panggilan fetch 0.
  - jawaban 403 `{ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }` → menolak dengan pesan cocok `/expired or is invalid/`.
  - `resendSignupCode('tani@example.test')` memanggil `/auth/v1/resend` dengan `{ type: 'signup', email: 'tani@example.test' }`.
  - `updateDisplayName('  ')` menolak tanpa fetch; `updateDisplayName(' Maliq ')` dengan `client.session` terisi memanggil `PUT /auth/v1/user` `{ data: { display_name: 'Maliq' } }` lalu `POST /auth/v1/token?grant_type=refresh_token`, dan mengembalikan `'Maliq'`.
- [ ] **Step 3: Jalankan keduanya**, pastikan gagal (`node --experimental-strip-types --test tests/identity.test.ts tests/signupCode.test.ts`).
- [ ] **Step 4: Implementasi** `identity.ts`, metode klien, dan `accountError` sesuai Interfaces; ganti isi `identityOf` di `AccountProvider.tsx` dengan pemanggilan `identityFromClaims(tokenClaims(...))`.
- [ ] **Step 5: Jalankan tes** → PASS; lalu `npm test` penuh (130 tes lama + baru) dan `npm run typecheck`.
- [ ] **Step 6: Commit**: `feat(account): signup name, email code verification and display name in the client`.

---

### Task 3: Form Daftar: Nama dan Konfirmasi kata sandi

**Files:**
- Modify: `src/components/AccountSignIn.tsx`, `src/components/AccountGate.tsx`, `src/styles.css`, `tests/entry-helpers.mjs`, `tests/pot-setup-browser.mjs`

**Interfaces:**
- Consumes: `checkSignup`, `DISPLAY_NAME_MAX` (Tugas 1); `authenticate(..., name)` (Tugas 2).
- Produces: `AccountSignIn` prop `onPassword(email: string, password: string, signup: boolean, name?: string): Promise<void>`; `signIn(page, email, password, { signup })` di `entry-helpers.mjs` mengisi Nama dan Konfirmasi bila `signup`.

- [ ] **Step 1: Ubah tes lebih dulu** (merah):
  - `tests/entry-helpers.mjs` `signIn`: bila `signup`, isi `gate(page).getByLabel('Nama', { exact: true })` dengan `'Penguji Smart Agro'` dan `getByLabel('Konfirmasi kata sandi', { exact: true })` dengan sandi yang sama sebelum klik "Buat akun".
  - `tests/pot-setup-browser.mjs` blok Daftar: isi Nama dan Konfirmasi; tambah dua pemeriksaan: konfirmasi `'cukup-panjang-13'` menampilkan `.signin-hint` bertuliskan "Konfirmasi kata sandi belum sama." dan tombol "Buat akun" `aria-disabled="true"` sehingga `signups` tetap 0; setelah diperbaiki, `signups === 1` dan body signup memuat `data.display_name === 'Penguji Smart Agro'` (tangkap lewat `request.postDataJSON()` di mock `/auth/v1/signup`).
- [ ] **Step 2: Jalankan** `npm run build` lalu `node tests/pot-setup-browser.mjs` → FAIL (kolom belum ada).
- [ ] **Step 3: Implementasi** di `AccountSignIn`: pada mode `signup` tambahkan `<label class="miro-field">` "Nama" (`autoComplete="name"`, `maxLength={DISPLAY_NAME_MAX}`, `required`) sebagai kolom pertama dan "Konfirmasi kata sandi" (`type="password"`, `autoComplete="new-password"`, `required`) sesudah "Kata sandi". Petunjuk `signin-hint` menampilkan ketidakcocokan (`checkSignup`) segera setelah kolom konfirmasi terisi; submit diblokir dengan `aria-disabled` bila sandi pendek atau tidak cocok. Kolom konfirmasi dikosongkan bersama sandi sesudah submit. Ganti kalimat petunjuk "Setelah daftar, buka tautan konfirmasi di email Anda." menjadi "Kami kirim kode 6 angka ke email Anda." `AccountGate` meneruskan `name` ke `client.authenticate(email, password, signup, back(), name)`. Daftar langkah `signin-steps` saat Daftar: `Daftar, Verifikasi, Siapkan pot, Amankan akun dengan 2FA` (saat Masuk tetap tiga langkah). Gaya baru hanya memakai token dan kelas `signin-*` yang ada.
- [ ] **Step 4: Jalankan** `node tests/pot-setup-browser.mjs` (preview 4173, `#masuk`) → PASS; `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit**: `feat(account): sign-up asks for a name and a password confirmation`.

---

### Task 4: Layar kode verifikasi email

**Files:**
- Create: `src/components/EmailCodeStep.tsx`, `tests/mock-auth.mjs`, `tests/signup-code-browser.mjs`
- Modify: `src/components/AccountSignIn.tsx`, `src/components/AccountGate.tsx`, `src/styles.css`, `tests/pot-setup-browser.mjs`

**Interfaces:**
- Consumes: `verifySignupCode`, `resendSignupCode` (Tugas 2); `normalizeEmailCode` (Tugas 1).
- Produces:
  - `EmailCodeStep({ email, busy, waitSeconds, onVerify, onResend, onBack }: { email: string; busy: boolean; waitSeconds: number; onVerify(code: string): Promise<void>; onResend(): Promise<void>; onBack(): void })`.
  - `AccountSignIn` props tambahan: `codeEmail: string | null`, `codeWait: number`, `onVerifyEmail(code: string): Promise<void>`, `onResendEmail(): Promise<void>`, `onChangeEmail(): void`. Bila `codeEmail` terisi, layar kode menggantikan form; langkah aktif "Verifikasi".
  - `tests/mock-auth.mjs`: `export const USER_ID`, `export function mockSession(meta?: object, opts?: { providers?: string[]; email?: string }): object`, `export async function mockAuth(page, routes: Record<string, (request, url) => object | { status: number; body: object }>): Promise<void>` yang memasang `page.route('http://127.0.0.1:54321/**')` dengan CORS terbuka, `OPTIONS` 204, bawaan `/auth/v1/settings` (`{ external: { google: false, email: true } }`), `…/my_products` (`{ products: [] }`), dan `{}` untuk jalur lain; kunci rute berbentuk `'POST /auth/v1/verify'`. Salin cara pembuatan JWT dari `tests/pot-setup-browser.mjs` baris 14–16.

Teks (tetap, dipakai tes): judul "Masukkan kode dari email"; kalimat "Kami kirim kode 6 angka ke {email}. Berlaku 10 menit."; kolom berlabel "Kode verifikasi"; tombol utama "Verifikasi email"; tombol "Kirim ulang kode" (aktif) atau "Kirim ulang dalam {n} dtk" (nonaktif); tautan "Ganti email"; galat "Kode salah atau sudah kedaluwarsa. Periksa kodenya, atau pilih Kirim ulang."; sesudah daftar, catatan status "Kode sudah dikirim ke email Anda."

- [ ] **Step 1: Tulis `tests/signup-code-browser.mjs`** (merah; memakai `mockAuth`, preview 4173, `#masuk`, viewport 1280×860). Skenario dan pernyataan:
  - **Happy path:** tab Daftar, isi Nama "Maliq Athaya", Email, Sandi dan Konfirmasi `cukup-panjang-12`, klik "Buat akun" (mock signup → `{ id: 'x', email }` tanpa sesi). Layar kode muncul: heading "Masukkan kode dari email", teks memuat email, tombol "Kirim ulang dalam" nonaktif. Isi "482 915" lewat `fill` pada kolom "Kode verifikasi": **tepat satu** panggilan `POST /auth/v1/verify` dengan body `{ type: 'signup', email, token: '482915' }` (submit otomatis di digit ke-6, lalu klik "Verifikasi email" ditolak karena sibuk/terkirim), lalu `main[aria-label="Siapkan pot"]` terlihat.
  - **Kode salah:** mock verify → status 403 `{ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }`: muncul `role=alert` berisi galat di atas; kolom kode kosong dan terfokus; masukan kode kedua ke jalur sukses lolos.
  - **Masuk sebelum terverifikasi:** tab Masuk, mock `POST /auth/v1/token` → 400 `{ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }`: layar kode muncul, "Kirim ulang kode" langsung aktif; klik → tepat satu `POST /auth/v1/resend` dengan `{ type: 'signup', email }` dan tombol berubah nonaktif ("Kirim ulang dalam").
  - **Ganti email:** klik "Ganti email" → form Daftar kembali dan kolom Email masih berisi alamat sebelumnya.
  - **Kirim ulang beruntun:** klik cepat dua kali pada tombol yang sudah nonaktif tidak menambah panggilan `/resend`.
- [ ] **Step 2: Ubah `tests/pot-setup-browser.mjs`**: sesudah "Buat akun" bukan lagi `getByText('Periksa email untuk konfirmasi akun…')` melainkan heading "Masukkan kode dari email"; lanjutkan ke "Ganti email" lalu tab Masuk seperti sebelumnya.
- [ ] **Step 3: Jalankan** `npm run build` lalu kedua tes → FAIL.
- [ ] **Step 4: Implementasi.** `EmailCodeStep`: satu `<input inputMode="numeric" autoComplete="one-time-code">` yang menormalisasi dengan `normalizeEmailCode`, mengirim otomatis tepat sekali begitu 6 digit (jaga dengan `busy` dan penanda terkirim), dikosongkan dan difokuskan lagi bila gagal; hitung mundur `waitSeconds` per detik; hormati reduced motion (tanpa animasi masuk). `AccountGate`: state `codeEmail` dan `codeWait`; setelah `authenticate` mengembalikan `'confirm'` saat daftar → `setCodeEmail(email)`, `setCodeWait(60)`, catatan status; bila masuk gagal dengan pesan cocok `/email not confirmed/i` → `setCodeEmail(email)`, `setCodeWait(0)` lalu lempar ulang galatnya; `onVerifyEmail` memanggil `verifySignupCode` lalu (`'mfa'` → langkah autentikator, `'ok'` → `opened('Email terverifikasi. Selamat datang!')`); `onResendEmail` memanggil `resendSignupCode` dan mereset `codeWait` ke 60; `onChangeEmail` mengosongkan `codeEmail`. Tambahkan ke `plain` di `AccountGate`: `[/token has expired or is invalid|otp_expired/i, <galat di atas>]`. Teks maskot saat layar kode: "Hampir selesai! Cek email Anda, ya." Gaya: kolom kode besar, rata tengah, `letter-spacing`, `font-variant-numeric: tabular-nums`; tidak meluap pada teks 200% di 320 px.
- [ ] **Step 5: Jalankan** kedua tes → PASS; `node tests/google-browser.mjs` (lihat header berkas untuk URL dan prasyarat; Docker backend hidup) → PASS (akun Google baru tetap mendarat di "Siapkan pot", `passPotSetup` baris 44); `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 6: Commit**: `feat(account): verify sign-up with a six-digit email code`.

---

### Task 5: Nama tampilan di Profil

**Files:**
- Create: `src/components/DisplayNameEditor.tsx`, `tests/profile-name-browser.mjs`
- Modify: `src/components/ProfilePage.tsx` (bagian `profile-account`), `src/styles.css`

**Interfaces:**
- Consumes: `updateDisplayName` (Tugas 2); `mockAuth`, `mockSession` (Tugas 4); `account.refresh()`.
- Produces: `DisplayNameEditor({ name, onSave }: { name: string; onSave(next: string): Promise<void> })` menampilkan nama dengan tombol "Ubah nama"; di mode ubah: kolom "Nama" (maks 40), tombol "Simpan" dan "Batal"; galat `role="alert"`: "Nama harus 1–40 karakter."

- [ ] **Step 1: Tulis `tests/profile-name-browser.mjs`** (merah; sesi tiruan dengan `pot` valid di metadata supaya "Siapkan pot" dilewati; mock `PUT /auth/v1/user` menyimpan `data.display_name` dan token refresh membawa metadata itu):
  - Metadata `{ full_name: 'Nama Google', pot }` → bagian Akun di `#profil` menampilkan "Nama Google"; tombol menu `Akun: Nama Google`.
  - Klik "Ubah nama", isi `'  Maliq   A '`, "Simpan" → body PUT `data.display_name === 'Maliq A'`; Profil dan tombol menu kini "Maliq A".
  - Isi 41 karakter → alert "Nama harus 1–40 karakter." dan tidak ada PUT kedua.
  - Metadata `{ display_name: 'x'.repeat(10000), full_name: 'Nama Google', pot }` → tampil "Nama Google".
- [ ] **Step 2: Jalankan** build + tes → FAIL.
- [ ] **Step 3: Implementasi** `DisplayNameEditor` dan pasang di `ProfilePage` sebagai baris "Nama" (menggantikan `<dd>{identity.name}</dd>`); `onSave` memanggil `client.updateDisplayName(next)` lalu `account.refresh()`.
- [ ] **Step 4: Jalankan** tes → PASS; `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 5: Commit**: `feat(account): editable display name in the profile`.

---

### Task 6: Templat email dan gambar kepala (berakhir dengan persetujuan pengguna)

**Files:**
- Create: `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`, `public/mail/header.png`, `scripts/build-mail-assets.mjs`, `scripts/preview-email.mjs`, `tests/mailTemplates.test.ts`
- Output tak dilacak git: `design-previews/email-2026-11-15/*.png`

**Interfaces:**
- Produces: dua berkas templat Go-template HTML; aksi yang boleh dipakai hanya `{{ .Token }}`, `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .SiteURL }}`. Gambar dirujuk dari `https://smart-agro-demo.pages.dev/mail/header.png`. `scripts/preview-email.mjs <confirmation|recovery> [--dark] [--width 600|375]` menulis PNG ke `design-previews/email-2026-11-15/` dengan mengganti aksi memakai contoh (`Token` "482915", URL contoh) dan alamat gambar dengan berkas lokal `public/mail/header.png`.

- [ ] **Step 1: Tulis `tests/mailTemplates.test.ts`** (merah): untuk kedua berkas — tidak ada `<script`, tidak ada `<link` atau `@import` (CSS eksternal), ukuran < 100.000 byte (Gmail memotong sesudah ±102 KB), setiap `<img` punya `alt` dan `width`, hanya alamat gambar `https://smart-agro-demo.pages.dev/mail/`, semua `{{ … }}` termasuk empat aksi yang diizinkan, ada `<meta name="color-scheme"`, ada teks pratinjau tersembunyi (`display:none`). Khusus konfirmasi: memuat `{{ .Token }}`, `{{ .ConfirmationURL }}`, dan kalimat "Berlaku 10 menit". Khusus reset: memuat `{{ .ConfirmationURL }}` dan **tidak** memuat `{{ .Token }}`.
- [ ] **Step 2: Jalankan** → FAIL (berkas belum ada).
- [ ] **Step 3: Buat gambar.** `scripts/build-mail-assets.mjs` merender HTML kecil (pita `#2f5a3c`, tanda AgroMark berwarna `#c3df95`, kata "Smart Agro" dengan `public/fonts/fraunces-soft.woff2`, motif daun halus) lewat Playwright pada 600×150 CSS px dengan `deviceScaleFactor: 2`, menyimpan `public/mail/header.png` (1200×300; ukuran < 80 KB). Jalankan sekali dan periksa hasilnya dengan Read pada PNG.
- [ ] **Step 4: Tulis templat** berbasis tabel lebar 600 (cair di ponsel), gaya inline, latar `#ecefe7`, kartu `#fbfcf9`, gambar kepala, lalu teks (tetap):
  - Konfirmasi — preheader "Kode verifikasi Anda: {{ .Token }}. Berlaku 10 menit."; judul "Verifikasi email Anda"; isi "Masukkan kode ini di halaman pendaftaran Smart Agro untuk menyelesaikan akun Anda."; kode `{{ .Token }}` besar (≥ 32 px, `letter-spacing`, latar `#f6f7f2`, bingkai `#e2e7da`); "Berlaku 10 menit. Jangan bagikan kode ini kepada siapa pun, termasuk tim Smart Agro."; pemisah "atau"; tombol `#2f5a3c` teks putih "Konfirmasi lewat tautan" → `{{ .ConfirmationURL }}`; kaki: "Email ini dikirim karena ada yang mendaftar di Smart Agro dengan alamat {{ .Email }}. Jika bukan Anda, abaikan email ini."
  - Reset — preheader "Buat kata sandi baru untuk akun Smart Agro Anda."; judul "Buat kata sandi baru"; isi "Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda."; tombol "Buat kata sandi baru" → `{{ .ConfirmationURL }}`; "Tautan berlaku satu kali dan harus dibuka di browser tempat Anda memintanya. Jika bukan Anda, abaikan email ini; kata sandi Anda tidak berubah."
  Mode gelap: `color-scheme` terang+gelap; warna tidak bergantung pada latar putih murni.
- [ ] **Step 5: Jalankan tes** → PASS.
- [ ] **Step 6: Pratinjau.** Jalankan `scripts/preview-email.mjs` untuk konfirmasi dan reset pada lebar 600 dan 375, terang dan gelap (8 PNG). Periksa sendiri dengan Read, perbaiki hal yang janggal.
- [ ] **Step 7 (BLOKIR): tunjukkan PNG kepada pengguna dan tunggu persetujuan** sebelum Tugas 7 diterapkan ke cloud. Perubahan yang diminta dikerjakan di tugas ini.
- [ ] **Step 8: Commit**: `feat(email): Indonesian branded confirmation and reset templates`.

---

### Task 7: Skrip penerapan ke Auth cloud dan dokumen

**Files:**
- Create: `scripts/apply-auth-email.mjs`, `tests/authEmailPayload.test.ts`
- Modify: `docs/panduan-smtp.md`, `CHANGELOG.md`, `.tmp/cloud/apply-smtp.mjs` (tak dilacak git)

**Interfaces:**
- Consumes: templat Tugas 6.
- Produces:
  - `export function authEmailPayload(read: (path: string) => string): Record<string, string | number>` dari `scripts/apply-auth-email.mjs`, berisi persis: `mailer_templates_confirmation_content` (isi `supabase/templates/confirmation.html`), `mailer_templates_recovery_content`, `mailer_subjects_confirmation: 'Kode verifikasi akun Smart Agro'`, `mailer_subjects_recovery: 'Buat kata sandi baru untuk Smart Agro'`, `mailer_otp_length: 6`, `mailer_otp_exp: 600`.
  - CLI: `node scripts/apply-auth-email.mjs` (bawaan: **simulasi**, hanya GET, mencetak nama kolom yang akan berubah), `--apply` (GET → simpan cadangan nilai lama ke `.tmp/cloud/backups/auth-email-<ISO>.json` → PATCH → GET ulang dan verifikasi), `--restore <berkas>` (PATCH nilai cadangan). Token dari `.tmp/cloud/supabase.env`; ref proyek `ihgqormeicusyqfphuub`; tidak mencetak token atau isi templat.

- [ ] **Step 1: Tes yang gagal** (`tests/authEmailPayload.test.ts`): `authEmailPayload` dengan `read` palsu mengembalikan tepat enam kunci di atas; `mailer_otp_length === 6` dan `mailer_otp_exp === 600`; isi konfirmasi berasal dari jalur `supabase/templates/confirmation.html`.
- [ ] **Step 2: Jalankan** → FAIL. **Step 3: Implementasi** skrip (fungsi murni diekspor; bagian CLI hanya jalan bila berkas dijalankan langsung). **Step 4: Tes** → PASS.
- [ ] **Step 5: Mode simulasi nyata:** jalankan `node scripts/apply-auth-email.mjs`; hasil harus menyebut kolom yang berubah tanpa mencetak rahasia atau isi templat.
- [ ] **Step 6: Rapikan yang lama.** Hapus kolom `mailer_subjects_confirmation` dan `mailer_templates_confirmation_content` dari `.tmp/cloud/apply-smtp.mjs` (agar menjalankannya lagi tidak mengembalikan templat lama). Perbarui `docs/panduan-smtp.md`: bagian "Templat email" menunjuk `supabase/templates/` dan skrip baru; catatan "saya" (Gmail menamai email dari akun yang sama dengan penerimanya "saya"; nama pengirim sudah "Smart Agro"; uji dengan penerima lain; alamat pengirim tetap Gmail sampai memakai domain sendiri); kode 6 angka berlaku 10 menit. Tambah baris di `CHANGELOG.md`.
- [ ] **Step 7: Commit**: `chore(email): script to apply Auth email templates and OTP settings`.

---

### Task 8: Verifikasi akhir dan rilis (diatur pengguna)

**Files:** tidak ada kode baru; memperbarui `CLAUDE.md` (Progres, tak dilacak), `HANDOFF.md`, catatan Obsidian.

- [ ] **Step 1: Pemeriksaan penuh:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `git diff --check` — semua hijau.
- [ ] **Step 2: Tes browser** dengan preview 4173/4174/4178 sesuai bawaan masing-masing: `pot-setup-browser`, `signup-code-browser`, `profile-name-browser`, `google-browser` (4178), `account-browser` (5173, Docker backend hidup), `ui-browser`, `dashboard-browser` — semua lolos; matikan server.
- [ ] **Step 3: Screenshot** Daftar (empat kolom), layar kode, dan Profil › Nama pada 1440/768/390/320 px, terang dan gelap, plus teks 200% pada 320 px; periksa tidak ada luapan horizontal.
- [ ] **Step 4 (BLOKIR, persetujuan pengguna): terapkan ke cloud.** Sesudah pratinjau email disetujui: `node scripts/apply-auth-email.mjs --apply`; periksa keluaran verifikasinya. Lakukan **sesudah** deploy frontend hijau supaya gambar kepala sudah tersedia di `smart-agro-demo.pages.dev/mail/header.png` (urutan: push → Checks/Deploy hijau → apply, dalam hitungan menit; tautan konfirmasi tetap berfungsi di semua urutan).
- [ ] **Step 5 (BLOKIR, persetujuan pengguna): push.** Pengguna meminta commit/push; ikuti kebiasaan sesi lalu (Checks → Deploy → smoke `tests/cloud-smoke.mjs` hijau).
- [ ] **Step 6: Uji manual di cloud oleh pengguna** (butuh alamat email yang **berbeda** dari akun Gmail pengirim SMTP, agar Gmail tidak menampilkan "saya"): daftar dengan nama, sandi, konfirmasi; email tiba dengan nama pengirim "Smart Agro" dan gambar kepala; masukkan kode → "Siapkan pot"; coba juga tautan "Konfirmasi lewat tautan" dari email kedua. **Risiko yang harus dicatat hasilnya:** pendaftaran memakai PKCE; bila `POST /auth/v1/verify` menolak kode pada pendaftaran PKCE, jangan mengirim `code_challenge` saat pendaftaran dan biarkan tautan cadangan mendarat sebagai "masuk dengan sandi" (email sudah terkonfirmasi); putuskan bersama pengguna. Tautan sesudah "Kirim ulang" tidak membawa PKCE, jadi kode adalah jalur yang dianjurkan.
- [ ] **Step 7: Catatan.** Perbarui `CLAUDE.md`, `HANDOFF.md`, dan catatan Obsidian `Agent Brain/Projects/Smart Agro.md` (bagian "For future agent"): hasil, perintah penerapan/pemulihan email, batas pengujian (server lokal auto-confirm, jadi pengiriman dan verifikasi kode nyata hanya diuji manual di cloud).

---

## Self-Review

- **Cakupan spec:** form (Tugas 3), layar kode + tautan cadangan (4), nama tampilan dan `display_name` didahulukan (2, 5), email profesional (6), OTP 6 angka/10 menit dan penerapan aman (7, 8), tes akun Google baru (sudah ada di `google-browser.mjs:44`, dijalankan di Tugas 4 dan 8), batas pengujian lokal (8). Tidak ada celah.
- **Konsistensi tipe:** `normalizeDisplayName`, `normalizeEmailCode`, `checkSignup`, `identityFromClaims`, `verifySignupCode`, `resendSignupCode`, `updateDisplayName`, `onPassword(..., name?)`, `EmailCodeStep` diberi nama sama di semua tugas.
- **Proporsi:** rencana memuat tanda tangan, nilai, teks tetap, dan pernyataan tes; badan fungsi diserahkan kepada pelaksana.
