# Fitur web A–F (perawatan berbasis sensor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enam fitur perawatan yang hanya memakai kemampuan perangkat di RAB: perkiraan siram (A), siram terdeteksi (B), kesehatan perangkat (C), peringatan email (D), kalibrasi terpandu (E), dan kesetaraan web dengan Android (F).

**Architecture:** Perhitungan berupa fungsi murni di `src/lib/` (deterministik, tanpa AI) yang diuji dengan seri sintetis. Data baru dari server lewat RPC `SECURITY DEFINER` di migrasi baru (lokal dulu; cloud hanya dengan persetujuan). Tampilan mengikuti mock dashboard yang disetujui di Fase 0. Kalibrasi berjalan di portal Wi-Fi firmware, tanpa server.

**Tech Stack:** React 19 + TypeScript (Vite), Postgres/PostgREST + edge function Deno (Supabase), ESP32 Arduino (firmware `smart_agro.ino`), `node --test`, Playwright (Chrome).

**Spec:** Usulan dan persetujuan pengguna 22 Nov 2026 (HANDOFF "SEKARANG 18:52" dan jawaban "saya setuju dari A sampai F"); batas perangkat di `design-previews/reference-web-upgrade-2026-11-22/NOTES.md` § Batas perangkat.

## Global Constraints

- Perangkat hanya punya: indeks kelembapan 0–100, suhu tanah (−20 sampai 60 °C), pH 0–14, tegangan baterai (opsional, pembagi 47k/47k), Wh surya/beban per 15 menit (opsional, INA228 ×2). Tidak ada aktuator, sensor udara/cahaya, EC, NPK. Server menolak EC/NPK/drip.
- Satu sampel per 30 menit. Usia data "segar" sama dengan server: 75 menit.
- Ambang baterai lemah 3,4 V (sama dengan `battery_low` di `20261121010000_unit_overview_battery.sql`).
- Semua teks UI berbahasa Indonesia, tanpa label kecil di atas judul. Galat backend wajib punya `code`; teksnya di `GATE_TEXT`.
- Warna hanya lewat token; font Fraunces Soft (judul) + General Sans.
- Gerak: tanpa kedip, denyut, atau pantulan; tanpa crossfade yang meredupkan; transisi pendek dan dihentikan saat `prefers-reduced-motion`.
- Panggilan server hanya setelah `account.loaded` (perbaikan 22 Nov).
- Lolos di 1440/768/390/320 px, terang dan gelap, teks 200% di 375/320 px, tanpa luapan horizontal.
- Migrasi, fungsi, secret, dan jadwal di cloud **hanya dengan persetujuan pengguna**. Commit/push hanya bila diminta.
- Semua seri data di tes ditandai SINTETIS di komentar.

## Pembagian kerja (pengguna, 22 Nov 19.51)

- **Codex (GPT 6.2 Astra): backend saja.** Migrasi, RPC, edge function, penjadwal, validasi ingest, firmware. Tidak membuat UI web maupun Android.
- **Claude: UI.** Mock HTML dulu (`design-previews/dashboard-apple-2026-11-22/`), lalu memeriksa hasil Codex (kontrak, tes, keamanan, bug) sebelum membangun UI web dan Android di atasnya. Perbaikan bug dari Claude tetap berlaku bila bertentangan.
- Karena backend dikerjakan Codex, perhitungan A dan B **pindah ke server**: web dan Android membaca angka yang sama dari satu RPC, tidak menghitung ulang di TypeScript dan Kotlin. Rumus di Task 2 dan 3 tetap berlaku, hanya tempatnya di SQL. Versi TypeScript hanya dibuat Claude bila mode tamu/simulator membutuhkannya.

| Task | Codex (backend) | Claude (UI, sesudah tinjauan) |
|---|---|---|
| B0 Ringkasan | RPC `my_overview()` (di bawah) | Halaman Ringkasan v2 |
| 1 F | (RPC sudah ada) | Ganti nama, arsip, pindah perangkat, berbagi, catat siram + Urungkan |
| 2 A | RPC `my_watering_outlook(p_unit_id)` | Kotak perkiraan, "Siram hari ini" |
| 3 B | RPC `my_unlogged_rises(p_unit_id, p_days)` + `dismiss_my_rise(p_unit_id, p_at)` | Kotak "Catat sebagai siram?", penanda di grafik |
| 4 C | Migrasi + RPC `my_unit_health` | Kartu Perangkat, ringkasan perangkat |
| 5 D | Migrasi, `alert-dispatch`, penjadwal | Lembar Peringatan email |
| 6 E | Firmware portal + kontrak paket `calibration` | Tanggal kalibrasi, lembar cara kalibrasi |

**Kontrak RPC tambahan untuk Codex** (semua `SECURITY DEFINER`, hanya pemilik, galat dengan `code`, `unauthorized` hanya untuk sesi, bukan untuk "baris akun belum ada"; lihat bug 22 Nov di HANDOFF):
- `my_overview()` → `{ ok, plants: [{ slot_id, unit_id|null, name, tag, species_id, place, moisture|null, measured_at|null, band:[lo,hi]|null, state: 'below'|'ok'|'above'|'learning'|'no_device', outlook: <sama dengan my_watering_outlook>|null }], devices: { total, issues: [{ unit_id, kind: 'gap'|'battery_low'|'silent', since, detail }] } }`. Satu panggilan untuk seluruh Ringkasan; target di bawah 300 ms untuk 30 tanaman.
- `my_watering_outlook(p_unit_id uuid)` → `{ ok, outlook: { state: 'below'|'window'|'waiting'|'learning', since|null, from|null, to|null, rate_per_hour|null, band:[lo,hi]|null } }`. `waiting` = belum ada 6 bacaan turun sejak kenaikan terakhir atau ada jeda lebih dari 2 jam.
- `my_unlogged_rises(p_unit_id uuid, p_days int DEFAULT 3)` → `{ ok, rises: [{ from, to, delta }] }`: kenaikan ≥5 poin berturut, tanpa siram tercatat ±2 jam, tanpa yang sudah diabaikan. `dismiss_my_rise(p_unit_id uuid, p_at timestamptz)` menyimpan "bukan siram" di server (menggantikan localStorage pada Task 3, jadi ikut ke Android).

## Review Focus

1. **Data berlubang atau tidak valid** (sampel `valid:false`, jeda >2 jam, perangkat baru <24 jam): A dan C tidak menampilkan angka, bukan angka yang salah. Tes: `forecast returns null across a 3-hour gap`, `daysLeft is null with fewer than 12 points`.
2. **Hujan pada pot luar ruangan** menaikkan kelembapan seperti siram: B tidak pernah menulis jurnal sendiri; teksnya "Kelembapan naik" dan butuh konfirmasi. Tes: `detection never appends to the journal without a click`.
3. **Baterai sedang diisi matahari** (tegangan naik): C tidak menampilkan sisa hari negatif atau tak hingga. Tes: `daysLeft is null when voltage rises`.
4. **Nilai berkedip di sekitar ambang** (kelembapan 29↔31 di ambang 30): D mengirim satu email per episode. Tes: `one email per episode; closes after 2 readings back in band`.
5. **Akun tanpa perangkat atau tamu:** A–D diam (tanpa kartu kosong atau galat). Tes: browser `guest sees no device health or alerts`.

---

### Task 0 (gerbang): Mock dashboard disetujui

**Files:** `design-previews/dashboard-apple-2026-11-22/` (mock HTML, dikerjakan terpisah).

- [ ] **Step 1:** Pengguna menyetujui mock. Tempat kartu A (perkiraan), baris B (terdeteksi), panel C (kesehatan), dan pengaturan D mengikuti mock itu.
- [ ] **Step 2:** Catat keputusan mock di `NOTES.md` mock dan di HANDOFF.

Tugas 1–6 tidak memulai UI sebelum gerbang ini. Logika murni (`src/lib/*`) dan migrasi boleh dikerjakan lebih dulu.

### Task 1 (F): Kesetaraan web dengan Android

RPC sudah ada di server dan dipakai Android: `rename_my_unit`, `archive_my_unit`, `restore_my_unit`, `place_my_device`, `set_slot_sharing`, `share_my_cycle`, `unshare_my_cycle`, `community_knowledge`.

**Files:**
- Modify: `src/lib/productAccountClient.ts` (tambahkan nama di `RpcName`)
- Modify: `src/components/ProductUnits.tsx` (ganti nama, arsip/pulihkan, pindah perangkat dengan peringatan)
- Create: `src/components/garden/CommunityShare.tsx` (sakelar berbagi per slot + kartu pengetahuan komunitas)
- Create: `src/lib/careLog.ts` (catat siram dengan urungkan 5 detik)
- Test: `tests/careLog.test.ts`, `tests/parity-browser.mjs` (port 4173, backend lokal)

**Interfaces:**
- Produces: `scheduleCareLog(send: () => Promise<void>, ms = 5000): { undo(): boolean; flush(): Promise<void> }` dipakai Task 3.
- Pindah perangkat mengikuti keputusan "peringatan, bukan blokir": simpan, lalu peringatkan bila tidak ada bacaan segar.

- [ ] **Step 1: Tes gagal** `tests/careLog.test.ts`: `undo within 5 s sends nothing`, `flush sends once`, `undo after send returns false`.
- [ ] **Step 2:** `node --experimental-strip-types --test tests/careLog.test.ts`. Harus FAIL (modul belum ada).
- [ ] **Step 3:** Tulis `scheduleCareLog` dengan `setTimeout`. `flush` dipanggil saat `pagehide`. Ponytail: catatan yang tertunda hilang bila tab ditutup paksa (sama dengan Android).
- [ ] **Step 4:** Tes unit lolos.
- [ ] **Step 5: Tes browser gagal** `tests/parity-browser.mjs` (akun via `signIn`). Asersi: ganti nama terlihat di `my_units` (cek DB), arsip lalu pulihkan, pindah perangkat menampilkan "Bacaan berikutnya masuk ke …", sakelar berbagi mengubah `garden_slot.community_share`, siram lalu Urungkan tidak menulis jurnal.
- [ ] **Step 6:** Implementasi UI; jalankan tes browser sampai lolos, ditambah `garden-sync-browser` dan `account-browser`.
- [ ] **Step 7:** Commit `feat(web): unit rename/archive/move, community sharing, undoable watering (parity with Android)`.

### Task 2 (A): Perkiraan siram berikutnya

**Files:**
- Create: `src/lib/forecast.ts`
- Modify: `src/components/dashboard/AnswerCard.tsx` (atau tempat yang ditetapkan mock)
- Test: `tests/forecast.test.ts`

**Interfaces:**
- Consumes: `dryingRate(samples: ReadingPoint[], hourOf?)` dan `ReadingPoint` dari `src/lib/observation.ts`.
- Produces: `nextWateringWindow(samples: ReadingPoint[], lowerBand: number, nowH: number): { fromH: number; toH: number; basis: 'rate' } | null`.
- Batas bawah pita: profil kurasi bila ada, `healthyMoistureRange(...)[0]` untuk spesies belajar, selain itu `null` (tanpa perkiraan).

- [ ] **Step 1: Tes gagal** (seri SINTETIS):
  - `steady drying of 1 point/h from 60 with band 40 → window around now+20 h (±25 %)`
  - `already below band → fromH === nowH`
  - `forecast returns null across a 3-hour gap` (Review Focus 1)
  - `rising series (just watered) → null until 2 falling readings`
  - `fewer than 6 valid readings since the last watering → null`
- [ ] **Step 2:** Jalankan; harus FAIL.
- [ ] **Step 3:** Laju dari `dryingRate` pada sampel sejak siraman terakhir. Jendela = jam sampai pita bawah dikali laju ±25 %, dibulatkan ke 30 menit. Teks: "Perlu disiram sekitar Kamis 14.00–20.00" (zona waktu peramban).
- [ ] **Step 4:** Tes lolos; tambahkan `dashboard-browser` cek kartu tampil untuk sesi simulator yang mengering.
- [ ] **Step 5:** Commit `feat(web): next-watering window from the measured drying rate`.

### Task 3 (B): Siram terdeteksi dari sensor

**Files:**
- Create: `src/lib/wateringDetect.ts`
- Modify: `src/components/ProductCareHistory.tsx` (usulan di atas jurnal)
- Test: `tests/wateringDetect.test.ts`, tambahan di `tests/care-history-browser.mjs`

**Interfaces:**
- Produces: `detectRises(samples: ReadingPoint[], minRise = 5): { fromH: number; toH: number; delta: number }[]` (aturan sama dengan `moistureRises` Android, `Models.kt:186`: naik berturut-turut ≥5 poin).
- Produces: `unloggedRises(rises, journalWateringH: number[], windowH = 2)` membuang kenaikan yang sudah dekat dengan siram tercatat.
- Consumes: `scheduleCareLog` (Task 1) untuk "Catat" dengan Urungkan.
- Abaikan disimpan per unit di `localStorage` (`smart-agro.rise-dismissed.<unitId>`). Ponytail: tidak ikut ke perangkat lain.

- [ ] **Step 1: Tes gagal:** `5-point rise over 2 readings is one event`, `4-point rise is ignored`, `invalid readings break a rise`, `rise within 2 h of a logged watering is dropped`.
- [ ] **Step 2:** Jalankan; FAIL.
- [ ] **Step 3:** Implementasi. Baris UI: "Kelembapan naik 18 poin pukul 07.30. Catat sebagai siram?" dengan [Catat] [Abaikan]. Catat → `append_my_care_journal` kind `watering`, catatan "Terdeteksi dari sensor".
- [ ] **Step 4:** Tes browser: `detection never appends to the journal without a click` (Review Focus 2), Catat → Urungkan tidak menulis apa pun.
- [ ] **Step 5:** Commit `feat(web): suggest unlogged waterings from moisture rises`.

### Task 4 (C): Kesehatan perangkat

**Files:**
- Create: `supabase/migrations/20261123000000_unit_health.sql` (RPC `my_unit_health`)
- Create: `src/lib/deviceHealth.ts`
- Create: `src/components/DeviceHealth.tsx`
- Test: `tests/unit-health.integration.mjs` (masuk `test:backend`), `tests/deviceHealth.test.ts`

**Interfaces:**
- Produces RPC `my_unit_health(p_unit_id uuid, p_days int DEFAULT 7)` → `{ ok, battery: [{at, volts}], packets: [at], energy_days: [{day, solar_wh, load_wh}], calibration: {moisture_at, ph_at} | null }`. Pemilik saja (`unauthorized` untuk unit milik orang lain); `p_days` 1–30 (`invalid_request` di luar itu). Baterai dari `telemetry_packet.payload->'battery'`, energi dijumlah per hari lokal dari `energy_window`.
- Produces: `batteryDaysLeft(points: {at: number; volts: number}[], floor = 3.4): number | null`, `uploadGaps(packetTimes: number[], expectedMin = 30): {from: number; to: number}[]` (jeda lebih dari 90 menit).

- [ ] **Step 1: Tes integrasi gagal:** pemilik membaca, orang lain `unauthorized`, `p_days` 0 dan 31 ditolak, unit tanpa pembagi → `battery: []`, energi per hari benar dari 96 jendela SINTETIS.
- [ ] **Step 2:** `node --test tests/unit-health.integration.mjs` (backend lokal hidup) FAIL; terapkan migrasi lokal; ulangi sampai lolos; tambahkan ke `schema-audit` bila memeriksa hak EXECUTE.
- [ ] **Step 3: Tes unit gagal:** `linear decline 3.9→3.7 V over 48 h → about 4.8 days to 3.4 V`, `daysLeft is null when voltage rises` (Review Focus 3), `daysLeft is null with fewer than 12 points`, `uploadGaps finds a 3 h gap`.
- [ ] **Step 4:** Implementasi + panel (baterai dan perkiraan, jeda kiriman 7 hari, Wh surya per hari bila ada INA228 dengan teks "Wh panel surya per hari, petunjuk cahaya di tempat pot", kalibrasi terakhir).
- [ ] **Step 5:** Tes browser: `guest sees no device health or alerts` (Review Focus 5).
- [ ] **Step 6:** Commit `feat: device health (battery outlook, upload gaps, solar per day)`. Cloud: minta persetujuan sebelum migrasi.

### Task 5 (D): Peringatan email

**Files:**
- Create: `supabase/migrations/20261123010000_alerts.sql`: tabel `alert_preference(account_id, email_enabled bool DEFAULT false, kinds text[])`, `alert_episode(unit_id, kind, opened_at, closed_at, notified_at)`; RPC `my_alert_preferences`, `set_my_alert_preferences`; `evaluate_alerts()` (hanya `service_role`).
- Create: `supabase/functions/alert-dispatch/` (memanggil `evaluate_alerts`, mengirim email lewat SMTP, menandai `notified_at`).
- Modify: `src/components/ProfilePage.tsx` (bagian Notifikasi)
- Test: `tests/alerts.integration.mjs`, `supabase/functions/alert-dispatch/handler.test.ts`

**Interfaces:**
- Jenis: `soil_dry` (2 bacaan berturut di bawah pita bawah), `battery_low` (<3,4 V), `device_silent` (tanpa paket >90 menit), `soil_hot` (≥35 °C selama 3 jam). Episode tutup setelah 2 bacaan kembali normal.
- `evaluate_alerts()` → `[{account_id, email, unit_name, kind, opened_at}]` hanya untuk episode yang belum `notified_at` dan akun yang `email_enabled`.
- Penjadwal: satu jadwal 30 menit yang juga menjalankan `purge_due_account_deletions` (pekerjaan tertunda sejak 22 Nov siang). Pilihan pg_cron atau GitHub Action dengan service key diputuskan pengguna sebelum cloud.

- [ ] **Step 1: Tes integrasi gagal:** `one email per episode; closes after 2 readings back in band` (Review Focus 4), preferensi mati → tidak ada baris, `evaluate_alerts` ditolak untuk `authenticated`, akun yang menunggu dihapus tidak menerima email.
- [ ] **Step 2:** Jalankan FAIL → migrasi lokal → lolos.
- [ ] **Step 3:** Tes fungsi: SMTP palsu menerima satu pesan berbahasa Indonesia per episode; galat SMTP tidak menandai `notified_at`.
- [ ] **Step 4:** UI Notifikasi (mati bawaannya, empat sakelar, contoh isi email). Tes browser menyimpan preferensi.
- [ ] **Step 5:** Commit `feat: opt-in email alerts for dry soil, low battery, silent device, hot soil`. Cloud (migrasi, fungsi, secret SMTP, jadwal) hanya setelah persetujuan. Ponytail: Web Push ditunda; email dulu.

### Task 6 (E): Kalibrasi terpandu di portal perangkat

**Files:**
- Modify: `firmware/smart_agro/smart_agro.ino` (halaman `/calibrate` di portal SoftAP; NVS namespace `calib`; nilai `DeviceConfig.h` jadi bawaan)
- Modify: `firmware/README.md` (langkah kalibrasi: udara → air, buffer 4,01 → 6,86)
- Modify: `docs/telemetry-v2.md` (objek opsional `calibration: {moisture_at, ph_at}` di paket)
- Test: kompilasi arduino-cli (default dan meter aktif), `tests/telemetry.integration.mjs` (paket dengan `calibration` diterima dan muncul di `my_unit_health`)

**Interfaces:**
- Portal menampilkan mV mentah kelembapan dan pH, diperbarui tiap 2 detik dengan mengganti angka (tanpa kedip). Tombol: Catat kering, Catat basah, Catat pH 4,01, Catat pH 6,86.
- Validasi sebelum simpan: kering − basah ≥100 mV (sama dengan firmware sekarang); mV pH 4,01 dan 6,86 berbeda ≥50 mV. Gagal → pesan, NVS tidak berubah.

- [ ] **Step 1: Tes integrasi gagal:** paket dengan `calibration` diterima (bukan 400) dan `my_unit_health.calibration` terisi; paket tanpa objek itu tetap diterima.
- [ ] **Step 2:** Ubah validasi server bila perlu, lalu tes lolos.
- [ ] **Step 3:** Firmware: kompilasi kedua varian tanpa peringatan baru; flash ≤85 %.
- [ ] **Step 4:** Daftar uji ESP32 fisik di `firmware/README.md` (dikerjakan pengguna; belum bisa diuji tanpa alat).
- [ ] **Step 5:** Commit `feat(firmware): guided moisture and pH calibration in the setup portal`.

## Urutan dan verifikasi per fase

Urutan: 0 → 1 → 2 → 3 → 4 → 5 → 6. Logika murni Task 2–4 boleh dikerjakan bersamaan dengan Task 0.

Setiap fase ditutup dengan: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`, tes browser fase itu plus `ui`, `dashboard`, `route-transition`; `npm run test:backend` bila ada migrasi; tangkapan 1440/768/390/320 terang dan gelap serta teks 200%. Android menyusul di rencana tersendiri setelah web stabil (A, B, C memakai rumus yang sama).
