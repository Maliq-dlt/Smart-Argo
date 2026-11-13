# Fase 1: pintu masuk, profil, Ekosistem ringkas — rencana kerja

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, langsung di sesi ini; pengguna tidak meminta subagent). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Login pindah ke pintu masuk simulator (dengan opsi tamu); profil dan Keluar di menu avatar; panel akun keluar dari Ekosistem sehingga ringkasan dan tab langsung di atas.

**Architecture:**
- Satu `ProductAccountClient` bersama dan state akun di `AccountProvider` (context) yang dibungkus di `App`. Isinya: restore, serah-terima Google, refresh, produk.
- `entryView()` (murni) memutuskan apakah yang tampil loading, pintu, atau aplikasi.
- Komponen `Product*.tsx` yang ada dipakai ulang: produk, keamanan, dan transfer pindah ke `#profil`; telemetri, pengetahuan, energi, dan reward pindah ke tab Ekosistem.

**Tech Stack:** React 18, TypeScript, Radix Popover (`ui/popover`), framer-motion, Phosphor, CSS token di `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-13-akun-pot-design.md` (bagian 1–4, ditambah pemetaan panel ke tab dari Fase 3 karena memindahkannya dua kali adalah kerja sia-sia).

## Global Constraints

- Hanya token warna, Fraunces Soft untuk judul, General Sans untuk teks, Phosphor 2.1.10, dan dukungan reduced motion.
- Teks Bahasa Indonesia, sedikit kata.
- Tanpa backend (`productAccountConfigured` false), pintu dilewati dan pengguna langsung menjadi tamu.
- Kunci tamu `smart-agro.guest` = `'1'` di localStorage, dibungkus try/catch.
- Hash baru: `#masuk` (pintu) dan `#profil` (tidak tampil di rail).
- Google kembali ke `#statistik`. Re-auth transfer kembali ke `#profil`.
- Commit hanya jika diminta.

## Review Focus

1. Tautan langsung ke `#ekosistem` saat belum masuk dan belum memilih tamu harus menampilkan pintu, lalu lanjut ke `#ekosistem` setelah masuk. Diuji di `account-browser`.
2. Kembali dari Google (`?code=`) dalam kondisi apa pun harus selesai masuk dan membuka `#statistik`. Diuji di `google-browser`.
3. Keluar dari halaman mana pun harus kembali ke pintu, dan data akun hilang dari Ekosistem. Diuji di `account-browser`.
4. Tamu yang membuka `#profil` melihat ajakan masuk, bukan error. Diuji di unit `entryView` dan di `account-browser`.
5. Sesi yang dicabut server saat aplikasi terbuka harus kembali ke pintu. Ini perilaku lama `onSessionExpired`. Diuji di `account-browser` ("server-revoked").

---

### Task 1: `entryView` dan hash baru

**Files:** Modify `src/lib/siteRoute.ts`. Test `tests/entry.test.ts`.

- [ ] Test `entryView({ configured, ready, signedIn, guest, hash })`:
  - tidak terkonfigurasi → `'app'`;
  - belum siap → `'loading'`;
  - sudah masuk → `'app'`;
  - tamu dengan hash `#statistik` → `'app'`;
  - tamu dengan `#masuk` → `'gate'`;
  - belum memilih apa pun → `'gate'`.
- [ ] Implementasikan, lalu tambahkan `#masuk` dan `#profil` ke `isSimulatorHash`.
- [ ] Jalankan `node --experimental-strip-types --test tests/entry.test.ts` → PASS.

### Task 2: `AccountProvider`

**Files:** Create `src/components/AccountProvider.tsx`. Modify `ProductAccount.tsx` (pindahkan `googleHandoff`, restore, timer refresh, `loadProducts`).

**Interfaces (Produces):**
- `useAccount(): { client: ProductAccountClient | null; ready: boolean; signedIn: boolean; identity: { name: string; email: string; google: boolean } | null; products: OwnedProduct[]; mfaPending: boolean; notice: { error: boolean; text: string } | null; loadProducts(): Promise<void>; sync(): void; signOut(): Promise<void>; expire(message?: string): void }`
- Aturan identitas: nama dari `user_metadata.full_name ?? name`, cadangannya bagian depan email.

### Task 3: Pintu masuk

**Files:** Create `src/components/AccountGate.tsx`. Modify `AccountSignIn.tsx` (prop `onGuest?`, langkah ke-2 bernama "Siapkan pot", kalimat kaki kartu). Modify `App.tsx` (render pintu sesuai `entryView`). CSS `.entry-gate`.

- Pintu: `<main className="entry-gate" aria-label="Masuk ke Smart Agro">`.
- Tombol `Coba tanpa akun` menyimpan kunci tamu, lalu membuka hash yang diminta (`#masuk` diganti `#statistik`).

### Task 4: Menu avatar dan maskot di pil

**Files:** Create `src/components/AccountMenu.tsx`. Modify `App.tsx` topbar. CSS `.account-menu*`.

- Pemicu: `button` dengan aria-label `Akun: {nama}` atau `Akun: Tamu`.
- Isi menu:
  - header (inisial, nama, email);
  - `Profil & keamanan` (`#profil`);
  - `Keluar` (`signOut`, lalu `#masuk`);
  - untuk tamu: `Masuk` (`#masuk`);
  - tanpa backend: catatan "Akun belum tersedia di demo ini".
- `PlantMood` pindah ke dalam `.session-pill`, menggantikan ikon daun.

### Task 5: Halaman `#profil`

**Files:** Create `src/components/ProfilePage.tsx`. `ProductAccount.tsx` menjadi bagian produk saja (cek seri/QR, daftar, klaim, transfer). `App.tsx`: entri `pages` dengan `hidden: true`, dan rail memfilternya.

- Navigasi bagian: Akun · Keamanan · Produk.
- Region produk tetap bernama `Akun & kepemilikan produk online` agar locator lama tetap berlaku.
- Tamu melihat ajakan "Masuk untuk melihat profil".

### Task 6: Ekosistem ringkas

**Files:** Modify `MiroEcosystemWorkspace.tsx`.

- Hapus `<ProductAccount/>`.
- Saat masuk, panel online tampil di awal tab:
  - Unit & sensor → `ProductTelemetry`;
  - Energi & reward → `ProductEnergy`, `ProductRewards`;
  - Kurasi & blockchain → `ProductKnowledge`.
- Judul statusbar demo menjadi "Akun demo (simulasi rancangan)".

### Task 7: Tes, dokumen, verifikasi

- Helper `tests/entry-helpers.mjs`:
  - `asGuest(browser)`;
  - `signIn(page, email, password)` (lewat pintu);
  - `signOut(page)`;
  - `ecosystemTab(page, label)`.
- Tes non-akun memakai `asGuest`.
- Tes akun lewat pintu, `#profil`, dan tab.
- Perbarui README, CHANGELOG, CLAUDE.md, dan Obsidian.
- Pemeriksaan wajib, semua tes browser, dan screenshot di 1440/768/390/320, terang dan gelap.
