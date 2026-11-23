# Perbaikan hasil analisis 23 Nov: rencana implementasi

> **Untuk agen yang melanjutkan (Codex, Claude, atau lainnya):** kerjakan tugas berurutan, satu per satu. Centang langkah (`- [x]`) di berkas ini begitu selesai, dan perbarui tabel **Status** di bagian akhir. Di akhir setiap giliran, tulis keadaan terakhir ke `HANDOFF.md`. Sub-skill: superpowers:executing-plans (tanpa subagen kecuali pengguna meminta).

**Tujuan:** menutup kelemahan yang ditemukan analisis 23 Nov (lihat **Temuan**), lalu menambah improvisasi yang berguna dan melengkapi aplikasi Android.

**Arsitektur:** perhitungan perawatan tetap di server (RPC Postgres `SECURITY DEFINER`); web (React) dan Android (Compose) hanya menampilkan. Perubahan backend ditulis tes-merah-dulu di `tests/*.integration.mjs` terhadap Supabase lokal.

**Tech stack:** Supabase (Postgres, edge function Deno), React 19 + Vite, Kotlin + Jetpack Compose (minSdk 26, targetSdk 36), firmware ESP32 (Arduino).

**Spesifikasi:** bagian **Temuan** di bawah (hasil analisis 23 Nov, dibaca dari kode). Arah produk: `PRODUCT.md`, tingkat bukti di `docs/superpowers/specs/2026-11-15-panggung-pot-kebun-cuaca-design.md` (0 Mengamati → 1 Pola pot Anda → 2 Pola komunitas → 3 Profil kurasi).

**Urutan fase (dari pengguna, 23 Nov 11:38):** Fase 1 kelemahan mayor → Fase 2 kelemahan menengah dan kecil → Fase 3 improvisasi → Fase 4 kelengkapan aplikasi Android (dan web yang setara).

---

## Temuan

### Kelemahan mayor
1. **Saran siram tidak pernah aktif untuk cabai/bawang dengan data nyata.** `care_band` (`supabase/migrations/20261123000000_unit_health.sql:43-76`) hanya memakai profil tervalidasi yang `pot_id`-nya sama dengan unit (baris 47-48). Jalur "pola pot Anda" hanya untuk spesies `tier='belajar'` (baris 52). Cabai (`kurasi`) tanpa profil per pot tidak masuk jalur mana pun, jadi status selamanya `learning`, tanpa perkiraan siram dan tanpa email `soil_dry`. Profil tervalidasi memang sengaja terikat satu pot (`assign_unit_profile` menolak dengan `calibration_mismatch`, `20261105030000_profile_curation.sql:213`) karena indeks kelembapan mentah tidak sebanding antar sensor.
2. **Perangkat fisik belum pernah diuji.** Firmware hanya terbukti terkompilasi (60% flash). Belum terbukti: portal Wi-Fi, ADC baterai (pembagi 47k/47k di GPIO32), INA228, light sleep, derau sensor nyata.
3. **Pemilihan sensor.** Sensor pH Rp300–600 ribu dari total Rp751.650 (40–47% RAB `../RAB_IoT_Smart_Agro_Lengkap.xlsx`); pH tanah pot berubah dalam hitungan minggu tetapi dibaca tiap 30 menit. RAB masih mencantumkan INA219 1 pcs, padahal keputusan 21 Nov adalah 2× INA228.
4. **Pekerjaan belum aman.** ±50 berkas berubah (Codex A–F + Claude UI v2 + perbaikan) belum dikomit; cabang `android-iot-readiness` belum digabung ke `main`; cloud tertinggal 6 migrasi (`20261122000000`, `20261122010000`, `20261123000000`–`20261123030000`) dan fungsi `alert-dispatch` belum dideploy.

### Kelemahan menengah
5. **Logika ditulis tiga kali:** katalog spesies (`src/lib/species.ts`, `android/.../SpeciesCatalog.kt`, SQL `plant_species` + larik tag di `20261123030000_garden_overview.sql:21`), ambang belajar 7/3/2 (`src/lib/observation.ts:13`, `Observation.kt:30`, `care_band` SQL).
6. **Cakupan melebar sebelum inti terbukti:** reward energi, bukti chain, komunitas, ruang kerja operator.
7. **Titik gagal tunggal:** kunci penerbit `.tmp/cloud/issuer/smart-agro-2026.pem` dan kunci rilis APK `android/.private/` tanpa cadangan; PAT Supabase CLI kedaluwarsa (401); email lewat Gmail SMTP; proyek Supabase gratis bisa dijeda bila sepi.

### Kelemahan kecil
8. `battery_low` tanpa histeresis (`20261123010000_alerts.sql:53` dan pemulihan baris 68): perangkat surya turun < 3,4 V tiap malam lalu pulih tiap siang, jadi email tiap malam. Waktu di email masih UTC. Preferensi peringatan sudah ada (`my_alert_preferences`, `set_my_alert_preferences`), tetapi email tidak menautkannya dan belum ada UI.

### Android (keadaan 23 Nov)
- Ada: masuk email/Google, TOTP, kode pemulihan, hapus akun, foto profil, klaim QR, transfer/pemulihan kepemilikan, kebun, detail tanaman, jurnal, catat siram dengan urungkan 5 detik, riwayat + CSV, reward, bukti chain, komunitas, pindah perangkat, sesi terenkripsi Keystore.
- Belum: notifikasi (manifest hanya `INTERNET`), kerja latar, cache offline, widget, RPC A–F (`my_overview`, `my_watering_outlook`, `my_unlogged_rises`, `dismiss_my_rise`, `my_unit_health`), setel Wi-Fi dan kalibrasi dari app, pengaturan peringatan, App Links dari QR kemasan, cek pembaruan, kebijakan privasi dan Data safety.
- QR dipindai dengan memotret lalu decode (`QrSupport.kt:74`).

---

## Global Constraints

- Bahasa UI dan dokumen: Bahasa Indonesia. Balas pengguna dalam Bahasa Indonesia.
- **Commit, push, deploy, dan perubahan database cloud hanya dengan izin eksplisit pengguna.** Langkah bertanda **(izin)** berhenti dan bertanya dulu.
- Jangan mengarang angka agronomi. Angka acuan tanaman harus punya sumber (kurator) atau berasal dari data pot itu sendiri.
- Warna lewat token (`styles.css`, `landing.css`, `Theme.kt`), tanpa hex langsung di komponen.
- Gerak: tanpa kedip, denyut, pantulan, atau crossfade yang meredup; reduced motion wajib.
- UI diuji di lebar 1440/768/390/320 px (web) dan 412/360 dp (Android), terang dan gelap, teks 200%.
- Galat backend wajib punya `code`; `unauthorized` hanya untuk sesi tidak sah (klien menghapus sesi karenanya).
- Jangan mencetak atau menyimpan secret (PAT, kunci, sandi SMTP).
- Perbaikan Claude 23 Nov pada migrasi `20261123*` (MATERIALIZED, `falling`, `below`, ambang belajar, derau baterai, cap kalibrasi firmware, `gap` ≥3 kali) jangan dibalik.
- Berkas `mail.go`, `verify.go`, `one_time_token.go` di akar repo adalah rujukan GoTrue, bukan kode proyek: jangan dikomit.

## Cara menjalankan

| Tujuan | Perintah |
| --- | --- |
| Backend lokal (Docker Desktop harus hidup) | `npm run backend:local` |
| Reset total DB lokal (setelah mengubah migrasi yang sudah diterapkan) | Hentikan launcher (port 54321 harus bebas), `docker compose --env-file .tmp/phase1/compose.env -p smart-agro-phase1 -f supabase/compose.phase1.yml down`, ganti nama `.tmp/phase1/pgdata` (bind mount; `down -v` **tidak** menghapusnya), lalu `npm run backend:local` |
| DB lokal "unhealthy" setelah Docker dimatikan tidak bersih | Postgres sedang memulihkan WAL di bind mount Windows dan melewati batas health check (30 × 2 detik). Tunggu sampai `docker inspect smart-agro-phase1-db-1 --format '{{.State.Health.Status}}'` = `healthy`, lalu jalankan `npm run backend:local` lagi |
| Satu tes backend | `node --test tests/sensor-care.integration.mjs` |
| Semua tes backend | `npm run test:backend` |
| Tes unit web | `npm test` |
| Pemeriksaan web | `npm run typecheck`, `npx eslint . --ignore-pattern 'android/**'`, `npm run build`, `git diff --check` |
| Android | di `android/`: `./gradlew.bat testDebugUnitTest lintDebug assembleDebug` dengan `JAVA_HOME=C:/Users/malik/.jdks/temurin-25.0.3` |
| Firmware | lihat `firmware/README.md` (arduino-cli di `.cache/firmware/`, `subst V:` untuk jalur pendek) |

Migrasi `20261123*` belum dikomit dan belum di cloud, jadi boleh diubah di tempat. Begitu sudah dikomit atau ada di cloud, perubahan harus berupa migrasi baru dengan `CREATE OR REPLACE`.

## Review Focus

1. Pot cabai yang **punya** profil tervalidasi per pot tetap memakai pita profil itu (`band_source='profile'`), bukan pola sendiri. Tes: Tugas 1 langkah 1.
2. Ganti tanaman di slot yang sama memulai siklus baru: pola pot lama tidak boleh terbawa (`band` kembali `null`). Tes: Tugas 1 langkah 1.
3. Baterai surya yang naik-turun di sekitar 3,4 V hanya menghasilkan satu episode peringatan sampai benar-benar pulih ≥ 3,6 V. Tes: Tugas 7 langkah 1.
4. Notifikasi Android tidak boleh berulang untuk keadaan yang sama setiap kali worker jalan. Tes: Tugas 9 langkah 1.
5. Cache offline milik satu akun tidak boleh terbaca setelah keluar lalu masuk dengan akun lain. Tes: Tugas 11 langkah 1.

---

## Fase 1: kelemahan mayor

### Tugas 1: pola pot Anda untuk semua spesies, dengan sumber pita

**Files:**
- Modify: `supabase/migrations/20261123000000_unit_health.sql:43-76` (`care_band`), tambah `care_band_source` sesudahnya, tambahkan ke `REVOKE` baris 163
- Modify: `supabase/migrations/20261123020000_watering_overview.sql` (`my_watering_outlook`: keluaran `outlook.band_source`)
- Modify: `supabase/migrations/20261123030000_garden_overview.sql` (`my_overview`: `plants[].band_source`)
- Modify: `docs/sensor-care-api.md:9,11,15`
- Test: `tests/sensor-care.integration.mjs` (tes `garden overview and sensor trends…`, baris 266 dst.)

**Interfaces:**
- `public.care_band(p_unit uuid, p_version uuid, p_owner uuid, p_device uuid, p_since timestamptz) RETURNS numeric[]`: tanda tangan tetap. Perilaku baru: bila tidak ada profil tervalidasi untuk pot ini, pita "pola pot Anda" (ambang Fase 5) berlaku untuk **setiap** spesies, bukan hanya `tier='belajar'`.
- Baru: `public.care_band_source(p_unit uuid, p_version uuid) RETURNS text`: `'profile'` bila syarat baris 47-48 terpenuhi (profil terbit, `provenance` ada, `pot_id` = unit, `care_limits` tidak null), selain itu `'own_pattern'`. Pemanggil menulis `band_source = CASE WHEN band IS NULL THEN NULL ELSE care_band_source(...) END`.
- Keluaran baru (dipakai Tugas 15 dan 16): `my_overview().plants[].band_source` dan `my_watering_outlook().outlook.band_source`, nilainya `'profile' | 'own_pattern' | null`.

- [x] **Langkah 1: tulis tes yang gagal.** Pada tes garden overview, tambahkan pot baru ber-`species_id` 1 (cabai) tanpa profil tervalidasi, dengan bacaan, inspeksi, dan siram yang meniru pot 11 (pot belajar). Asersi:
  - sebelum ambang terpenuhi: `state === 'learning'`, `band === null`, `band_source === null`;
  - setelah ambang terpenuhi: `band` sama dengan pita yang dipelajari pot 11, `band_source === 'own_pattern'`, dan `my_watering_outlook` untuk pot itu juga `band_source === 'own_pattern'`;
  - pot 1 (profil tervalidasi per pot): `band` tetap `[40,85]` dan `band_source === 'profile'`;
  - setelah `switch_my_plant` pada slot cabai itu: `band === null` dan `band_source === null` (siklus baru).
- [x] **Langkah 2: pastikan gagal.** `node --test tests/sensor-care.integration.mjs` → FAIL karena `band` cabai `null` dan `band_source` `undefined`.
- [x] **Langkah 3: implementasi.** Hapus syarat `JOIN public.plant_species sp ... AND sp.tier='belajar'` dari `care_band` (baris 52); tulis `care_band_source`; tambahkan `band_source` ke kedua keluaran; perbarui komentar di atas `care_band` dan `docs/sensor-care-api.md` (pita "pola pot Anda" berlaku untuk semua spesies tanpa profil tervalidasi per pot; arti `band_source`).
- [x] **Langkah 4: reset DB lokal dan ulangi tes.** Reset total (lihat **Cara menjalankan**), lalu `node --test tests/sensor-care.integration.mjs` → PASS.
- [ ] **Langkah 5: semua tes backend.** `npm run test:backend` → semua lulus (sebelumnya 215/215).
- [ ] **Langkah 6 (izin): commit** bersama Tugas 4, jangan sendirian, agar migrasi Codex dan perbaikan ini tercatat berurutan.

### Tugas 2: panduan uji bangku perangkat fisik

**Files:**
- Create: `firmware/UJI-BANGKU.md`
- Modify: `firmware/README.md` (satu tautan ke panduan)

Isinya langkah dengan hasil yang diharapkan dan tabel hasil (`No | Uji | Harapan | Hasil | Lulus`) yang diisi pengguna. Uji minimal:
1. Flash sesuai `firmware/README.md`; monitor serial 115200 menunjukkan boot tanpa galat.
2. Portal: tekan EN lalu tahan BOOT 2 detik → SSID `SmartAgro-xxxx` (sandi dari label `provision.mjs`) → `http://192.168.4.1` → simpan Wi-Fi → bacaan pertama tiba di app dalam ±1 menit.
3. Kalibrasi kelembapan kering (probe di udara) dan basah (probe di air sampai garis) lewat `/calibrate`; `/api/calibration` menunjukkan tanggal keduanya.
4. Kelembapan: tanah kering lalu disiram → indeks naik pada bacaan berikutnya.
5. Suhu DS18B20 dibanding termometer: selisih ≤ 1 °C.
6. pH dengan larutan buffer 4,01 dan 6,86: catat bacaan (belum ada ambang lulus; hasil ini menentukan Tugas 3).
7. Baterai: `battery.volts` di app dibanding multimeter di kutub baterai: catat selisih (target ≤ 0,1 V).
8. Wi-Fi diputus 2 jam lalu dipulihkan: bacaan terbaru tiba lebih dulu, antrean lama menyusul, app tidak lama menampilkan "Bacaan lama".
9. RTC: cabut daya 1 jam; waktu bacaan sesudahnya benar.
10. INA228 (bila terpasang): jendela energi 15 menit muncul di ruang kerja energi.

- [x] **Langkah 1:** tulis panduan dan tautannya.
- [x] **Langkah 2: periksa** setiap URL, nama SSID, dan perintah terhadap `smart_agro.ino` dan `scripts/provision.mjs` (grep), bukan dari ingatan.
- [ ] **Langkah 3:** pengguna menjalankan uji dengan ESP32. Setiap uji yang gagal menjadi tugas perbaikan baru di berkas ini.

### Tugas 3: keputusan sensor dan pembaruan RAB (keputusan pengguna)

**Files:** `../RAB_IoT_Smart_Agro_Lengkap.xlsx`, `../RAB_IoT_Smart_Agro.xlsx` (di luar repo)

**Keputusan pengguna (23 Nov 11:52): B, pH diukur sekali sehari.** Tugas 13 dikerjakan; probe pH tetap ada di RAB.

- [x] **Langkah 1: tanya pengguna** dengan pilihan:
  - A. pH tetap dibaca terus (tanpa perubahan);
  - B. pH tetap dipasang tetapi diukur sekali sehari (Tugas 13), baterai lebih awet;
  - C. probe pH dilepas dari RAB, pH dicatat manual di jurnal dengan alat ukur terpisah (hemat ±40% biaya; kontrak telemetri sudah menerima `not_measured`).
- [ ] **Langkah 2:** minta harga dan tautan INA228 dari pengguna (jangan mengarang harga).
- [ ] **Langkah 3:** ubah RAB dengan `openpyxl` (muat tanpa `data_only`, agar rumus tetap): baris INA219 menjadi INA228 qty 2 (alamat 0x40 surya, 0x41 beban), dan baris pH sesuai pilihan. Buka ulang dengan `data_only` untuk memastikan total terhitung, lalu tunjukkan totalnya ke pengguna.

### Tugas 4: amankan pekerjaan (izin di tiap langkah)

**Izin pengguna (23 Nov 11:52): commit lokal saja, dipisah per pemilik, setelah pemeriksaan hijau.** Push, PR, merge, dan cloud (langkah 4–5) tetap butuh izin baru.

- [x] **Langkah 1:** pindahkan `mail.go`, `verify.go`, `one_time_token.go` ke `.tmp/gotrue-ref/`; tambahkan `tsconfig.tsbuildinfo` ke `.gitignore`. Tanyakan nasib `android/design-preview/konsep-kebun/` (mock Codex).
- [ ] **Langkah 2:** pemeriksaan penuh sebelum commit: `npm run typecheck`, eslint (tanpa `android/`), `npm test`, `npm run test:backend`, `npm run build`, `git diff --check`, tes Android.
- [ ] **Langkah 3 (izin): commit terpisah per pemilik**:
  - (a) backend A–F Codex beserta perbaikan Claude: `supabase/migrations/20261123*`, `supabase/functions/alert-dispatch/`, `supabase/functions/_shared/observability.ts`, `supabase/config.toml`, `.github/workflows/care-alerts.yml`, `scripts/backend-gateway.mjs`, `firmware/`, `docs/sensor-care-api.md`, `docs/telemetry-v2.md`, `tests/sensor-care.integration.mjs`, `Dockerfile`, `package.json`, `package-lock.json`, `src/lib/telemetry.ts`;
  - (b) UI dashboard v2 Claude: `src/components/shell/`, `src/components/overview/`, `src/components/dashboard/*`, `src/lib/overview.ts`, `src/lib/plantHistory.ts`, `src/lib/siteRoute.ts`, `src/App.tsx`, `src/styles.css`, `src/components/AccountMenu.tsx`, `src/components/SimulationOverview.tsx`, `src/components/StatisticsDashboard.tsx`, `public/_headers`, tes browser dan unit terkait, `docs/superpowers/plans/2026-11-22-web-ui-dashboard-v2.md`;
  - (c) rencana ini.

  Akhiri pesan commit dengan baris atribusi yang berlaku di sesi itu.
- [ ] **Langkah 4 (izin):** push `android-iot-readiness`; buka PR ke `main` (aturan cabang mewajibkan PR + status check); merge setelah CI hijau.
- [ ] **Langkah 5 (izin, cloud):**
  - cadangkan skema dan data ke `.tmp/cloud/backups/pre-2026-11-23-*`;
  - terapkan 6 migrasi tertunda;
  - deploy `alert-dispatch`;
  - atur secret `ALERT_DISPATCH_SECRET` (GitHub dan fungsi) beserta SMTP fungsi;
  - pastikan workflow `care-alerts.yml` (cron `7,37 * * * *`) hijau.

  PAT di `.tmp/cloud/supabase.env` kedaluwarsa: minta pengguna membuat token baru, atau pakai konektor Supabase (cara 21 Nov). Uji asap: `node tests/cloud-smoke.mjs`.

---

## Fase 2: kelemahan menengah dan kecil

### Tugas 5: tes keselarasan tiga salinan

**Files:**
- Create: `tests/parity.test.ts`

**Interfaces:**
- Consumes: `SPECIES` dari `src/lib/species.ts`, `THRESHOLDS` dari `src/lib/observation.ts`; teks `android/app/src/main/java/id/smartagro/app/SpeciesCatalog.kt`, `Observation.kt`, `supabase/migrations/20261115100000_garden_sites_cycles.sql`, `20261123030000_garden_overview.sql`, `20261123000000_unit_health.sql` (dibaca sebagai teks, diurai dengan regex).

- [ ] **Langkah 1: tulis tes:**
  - `species ids, tags, names and tiers agree in TypeScript, Kotlin and SQL`: untuk tiap spesies, `speciesId`, `tag`, `name`, `tier` sama di ketiganya, dan larik `ARRAY['CB','BM','AB','PN']` di SQL berurutan menurut `speciesId`;
  - `learning thresholds agree`: `THRESHOLDS` = `{days:7, inspections:3, waterings:2}` = default `ObservationThresholds` Kotlin = `interval '7 days'`, `>=3`, `>=2` di `care_band`.
- [ ] **Langkah 2:** `npm test` → PASS. Lalu ubah sementara satu tag di `SpeciesCatalog.kt` → FAIL. Kembalikan perubahan itu.

### Tugas 6: dokumen pembekuan cakupan dan titik gagal tunggal

**Files:**
- Modify: `README.md` (bagian "Status fitur": berjalan / dibekukan / rencana)
- Modify: `docs/backend-operations.md` (bagian "Titik gagal tunggal")

- [ ] **Langkah 1:** di README, tandai reward energi, bukti chain, pengetahuan komunitas, dan ruang kerja operator sebagai **dibekukan**: dirawat, tetapi tanpa fitur baru sampai uji bangku (Tugas 2) lulus.
- [ ] **Langkah 2:** tulis daftar periksa pengguna:
  - cadangkan `.tmp/cloud/issuer/smart-agro-2026.pem` dan `android/.private/*` ke dua tempat offline (jangan dikomit);
  - buat PAT Supabase baru;
  - SMTP transaksional + domain (berbayar, tunggu hasil uji email);
  - jeda proyek gratis tertangani oleh cron `care-alerts.yml` setelah Tugas 4 langkah 5.
- [ ] **Langkah 3:** periksa setiap jalur berkas di dokumen itu memang ada (`ls`).

### Tugas 7: histeresis baterai, waktu WIB, dan tautan pengaturan di email

**Files:**
- Modify: `supabase/migrations/20261123010000_alerts.sql:49-75` (`care_alert_signals`)
- Modify: pembentuk teks email di `supabase/functions/alert-dispatch/` (cari dengan grep `subject`)
- Test: `tests/sensor-care.integration.mjs` (tes `owner sensor care, calibration and scheduled mail`, `smtpSink`)

**Interfaces:**
- `care_alert_signals`: tiap jenis punya predikat `bad` dan `good`. Untuk `battery_low`: `bad = volts < 3.4`, `good = volts >= 3.6`; jenis lain `good = NOT bad`. Pemulihan (baris 68) memakai dua bacaan `good` berturut-turut. Beri komentar `ponytail:` bahwa 3,6 V adalah histeresis rekayasa untuk sel Li-ion, bukan hasil ukur.

- [ ] **Langkah 1: tulis tes yang gagal:**
  - tegangan 3,35 → 3,50 → 3,35 → 3,50 (tiap 30 menit) menghasilkan **satu** episode `battery_low`;
  - 3,35 → 3,65 → 3,66 → 3,35 menghasilkan **dua** episode;
  - isi email peringatan memuat waktu bertanda `WIB` dan tidak memuat cap ISO berakhiran `Z`;
  - isi email memuat tautan `<APP_ORIGIN>/#pengaturan-peringatan`.
- [ ] **Langkah 2:** jalankan → FAIL.
- [ ] **Langkah 3:** implementasi. Waktu memakai zona `Asia/Jakarta` dengan format `23 Nov 14.30 WIB`. Halaman `#pengaturan-peringatan` dibuat di Tugas 16; sampai itu ada, rute tak dikenal tetap jatuh ke Ringkasan.
- [ ] **Langkah 4:** reset DB lokal, lalu `npm run test:backend` → PASS.

Catatan: unsubscribe satu klik (RFC 8058) ditunda sampai pindah ke penyedia email transaksional.

---

## Fase 3: improvisasi

### Tugas 8: profil spesies umum untuk sensor terkalibrasi (MENUNGGU DATA KURATOR)

Hanya dikerjakan bila pengguna atau kurator memberi angka acuan cabai/bawang beserta sumbernya. Rancangan:
- profil tervalidasi dengan `pot_id = "*"` (berlaku untuk semua pot spesies itu) diterima `assign_unit_profile`;
- `care_band` memakainya hanya bila sampel kelembapan di jendela itu membawa `calibration.moisture_at` tidak null (sensor sudah dikalibrasi kering/basah);
- `band_source = 'species_profile'`.

Urutan prioritas pita: profil per pot → profil spesies terkalibrasi → pola pot sendiri. Tes mengikuti pola Tugas 1. Tanpa data, tugas ini dilewati.

### Tugas 9: notifikasi Android lewat WorkManager (tanpa Firebase)

**Files:**
- Modify: `android/app/build.gradle.kts` (`androidx.work:work-runtime-ktx:2.10.1`, naikkan bila Gradle menolak)
- Modify: `android/app/src/main/AndroidManifest.xml` (`POST_NOTIFICATIONS`)
- Create: `android/app/src/main/java/id/smartagro/app/CareNotifications.kt`
- Test: `android/app/src/test/java/id/smartagro/app/CareNotificationsTest.kt`

**Interfaces:**
- `fun noticesFor(previous: Set<String>, overview: JSONObject, kinds: Set<String>): Pair<List<Notice>, Set<String>>`: fungsi murni. Kunci keadaan:
  - `"<unit>:below"` untuk tanaman `state=below`;
  - `"<unit>:<device>:<kind>"` untuk `devices.issues` berjenis `silent` atau `battery_low`.

  Hanya kunci yang belum ada di `previous` yang menjadi `Notice`. Set kedua adalah keadaan baru yang disimpan.
- `data class Notice(val key: String, val title: String, val body: String)`.
- `class CareCheckWorker : CoroutineWorker`: periodik 1 jam. Ia memanggil `my_overview` dan `my_alert_preferences` dengan sesi tersimpan; bila refresh token ditolak, worker berhenti tanpa notifikasi.

- [ ] **Langkah 1: tulis tes yang gagal:**
  - keadaan sama dua kali → notifikasi kedua kosong;
  - tanaman pulih lalu kering lagi → notifikasi muncul lagi;
  - jenis yang dimatikan di preferensi → tanpa notifikasi.
- [ ] **Langkah 2:** implementasi; kanal "Perawatan tanaman"; izin diminta saat pengguna menyalakan sakelar "Notifikasi" (Tugas 17), bukan saat app dibuka.
- [ ] **Langkah 3:** `./gradlew.bat testDebugUnitTest lintDebug assembleDebug` → PASS; uji di emulator `sa-api35` dengan backend lokal.

FCM ditunda: butuh proyek Firebase milik pengguna; worker per jam cukup untuk tanah yang mengering dalam hitungan jam.

### Tugas 10: pemindai QR langsung

**Files:**
- Modify: `android/app/build.gradle.kts` (`com.google.android.gms:play-services-code-scanner:16.1.0`)
- Modify: `ProductsScreen.kt` (tombol pindai), `QrSupport.kt`

- [ ] **Langkah 1:** pakai `GmsBarcodeScanning.getClient(context, GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()).startScan()`. Hasilnya lewat pengurai yang sama dengan jalur foto (URL `…/?serial=…#ekosistem`, `src/lib/productQr.ts:13`).
- [ ] **Langkah 2:** bila modul Play Services tidak tersedia, jalur foto lama (`decodeQrFromUri`) tetap tersedia.
- [ ] **Langkah 3:** tes pengurai yang ada tetap hijau; uji manual di emulator dengan image Google Play.

### Tugas 11: cache bacaan terakhir (offline)

**Files:**
- Create: `android/app/src/main/java/id/smartagro/app/OverviewCache.kt`
- Modify: `AgroViewModel.kt` (simpan setelah `my_overview` sukses; hapus saat keluar akun atau hapus akun)
- Test: `android/app/src/test/java/id/smartagro/app/OverviewCacheTest.kt`

**Interfaces:**
- `class OverviewCache(dir: File)` dengan `fun save(account: String, json: String, at: Instant)`, `fun load(account: String): Cached?`, `fun clear()`.
- `data class Cached(val json: String, val at: Instant)`.
- Berkas `cache-<sha256(account)>.json` di `filesDir`.

- [ ] **Langkah 1: tulis tes:**
  - simpan lalu muat → sama;
  - `load` untuk akun lain → `null`;
  - setelah `clear()` → `null`.
- [ ] **Langkah 2:** implementasi. Saat jaringan gagal, UI menampilkan data cache dengan baris "Terakhir diperbarui 14.30" (bukan layar galat).
- [ ] **Langkah 3:** tes Android → PASS.

### Tugas 12: sambungkan Wi-Fi dan kalibrasi alat dari app

**Files:**
- Create: `android/app/src/main/java/id/smartagro/app/DeviceSetup.kt`
- Create: `android/app/src/main/res/xml/network_security_config.xml` (HTTP polos hanya ke `192.168.4.1`)
- Modify: manifest (`ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE`, `android:networkSecurityConfig`)
- Test: `DeviceSetupTest.kt`

**Interfaces:**
- Android 10+:
  1. `WifiNetworkSpecifier.Builder().setSsidPattern(PatternMatcher("SmartAgro-", PatternMatcher.PATTERN_PREFIX)).setWpa2Passphrase(<sandi label>)`, lalu `requestNetwork` dan `bindProcessToNetwork`;
  2. `POST http://192.168.4.1/save` dengan form `ssid`, `pass` (aturan firmware: SSID 1–32 karakter, sandi kosong atau 8–63, `smart_agro.ino:472-486`);
  3. kalibrasi: `POST /api/calibration` dengan header `X-Smart-Agro-Setup: 1` dan form `point` (`smart_agro.ino:385`).
- Android 8–9: tampilkan langkah membuka `http://192.168.4.1` di browser.
- `fun wifiFormError(ssid: String, pass: String): String?`: validasi yang sama dengan firmware.

- [ ] **Langkah 1:** tes `wifiFormError` (SSID kosong, SSID 33 karakter, sandi 7 karakter → galat; sandi kosong → boleh).
- [ ] **Langkah 2:** implementasi wizard "Siapkan perangkat": sambung → Wi-Fi rumah → kalibrasi kering → basah → selesai.
- [ ] **Langkah 3:** uji bersama pengguna dengan ESP32 nyata (bagian dari Tugas 2).

### Tugas 13: pH sekali sehari (hanya bila Tugas 3 memilih B)

**Files:** `firmware/smart_agro/smart_agro.ino`, `firmware/README.md`

- [ ] **Langkah 1:** konstanta `kPhIntervalHours = 24`. pH hanya diukur bila sejak pengukuran pH terakhir (disimpan di `Preferences`) sudah 24 jam; selain itu kirim `ph: {status:"not_measured", value:null}` (sudah diterima server, `docs/telemetry-v2.md:34`).
- [ ] **Langkah 2:** kompilasi arduino-cli tanpa peringatan baru.
- [ ] **Langkah 3:** web dan Android menampilkan pH terakhir yang `ok`, dengan waktu ukurnya.

### Tugas 14: widget layar utama

**Files:**
- Modify: `android/app/build.gradle.kts` (`androidx.glance:glance-appwidget:1.1.1`)
- Create: `CareWidget.kt`
- Test: `CareWidgetTest.kt`

**Interfaces:**
- Consumes: `OverviewCache` (Tugas 11); diperbarui oleh `CareCheckWorker` (Tugas 9).
- `fun widgetLine(overview: JSONObject?): String`: tanaman `below` pertama ("Cabai 1 perlu disiram"); bila tidak ada, "Semua tanaman aman"; tanpa data, "Buka Smart Agro untuk memuat".

- [ ] **Langkah 1:** tes `widgetLine` untuk ketiga kasus di atas.
- [ ] **Langkah 2:** implementasi; mengetuk widget membuka app.

---

## Fase 4: kelengkapan Android (dan web yang setara)

### Tugas 15: fitur A–F di Android

**Files:**
- Modify: `AgroApi.kt` (`my_overview`, `my_watering_outlook`, `my_unlogged_rises`, `dismiss_my_rise`, `my_unit_health`)
- Modify: `Models.kt` (pengurai)
- Modify: `PlantScreens.kt`, `DetailScreen.kt`
- Test: `ModelsTest.kt`

- [ ] **Langkah 1:** tes pengurai untuk contoh jawaban tiap RPC (salin bentuknya dari `docs/sensor-care-api.md`, termasuk `band_source`).
- [ ] **Langkah 2:** implementasi:
  - beranda memakai `my_overview` (status `below/ok/above/learning/no_device`);
  - label pita:
    - `own_pattern` → "Berdasarkan pola pot Anda";
    - `profile` → "Profil kurasi untuk pot ini";
  - detail menampilkan perkiraan siram (`window` → "Siram sekitar 14.00–16.00");
  - kenaikan tanpa catatan → kartu "Sepertinya Anda menyiram pukul 14.20. Catat?" dengan tombol Catat dan Bukan;
  - kartu Perangkat dari `my_unit_health` (baterai, jeda kiriman, tanggal kalibrasi).
- [ ] **Langkah 3:** tes Android, lalu tangkapan emulator 412/360 dp, terang/gelap, teks 200% (`node android/tools/shots.mjs`).

### Tugas 16: fitur A–F dan pengaturan peringatan di web (U5)

**Files:**
- Modify: `src/lib/overview.ts`, `src/components/overview/Overview.tsx`, `src/App.tsx`
- Create: kartu Perangkat di `src/components/dashboard/`, halaman `#pengaturan-peringatan` (daftarkan di `src/lib/siteRoute.ts`)
- Test: `tests/overview.test.ts`, `tests/overview-browser.mjs`

- [ ] **Langkah 1:** tes unit label `band_source`; tes browser untuk kartu Perangkat dan halaman pengaturan (sakelar per jenis lewat `set_my_alert_preferences`).
- [ ] **Langkah 2:** implementasi mengikuti rencana `docs/superpowers/plans/2026-11-22-web-ui-dashboard-v2.md` (U5).
- [ ] **Langkah 3:** pemeriksaan web penuh + tangkapan 1440/768/390/320 terang/gelap.

### Tugas 17: pengaturan notifikasi dan email di Android

**Files:** `AccountScreens.kt`, `AgroApi.kt`

- [ ] **Langkah 1:** grup "Peringatan" di Akun:
  - sakelar per jenis (`soil_dry`, `battery_low`, `device_silent`, `soil_hot`) lewat `my_alert_preferences` dan `set_my_alert_preferences`;
  - sakelar "Notifikasi di HP" yang meminta izin `POST_NOTIFICATIONS` dan menjadwalkan `CareCheckWorker`.
- [ ] **Langkah 2:** tes alur Robolectric (nyalakan → izin → tersimpan); tes Android → PASS.

### Tugas 18: QR kemasan langsung membuka app (App Links)

**Files:**
- Create: `public/.well-known/assetlinks.json`
- Modify: `public/_headers` (`Content-Type: application/json` untuk berkas itu)
- Modify: manifest (`intent-filter` `autoVerify` untuk host `live.smart-agro-demo.pages.dev`)
- Modify: `MainActivity.kt` (baca `serial` dari intent)

- [ ] **Langkah 1 (pengguna):** jalankan `keytool -list -v` pada keystore rilis di `android/.private/` dan berikan sidik SHA-256. Jangan memindahkan keystore.
- [ ] **Langkah 2:** isi `assetlinks.json`; intent membuka layar klaim produk dengan serial terisi.
- [ ] **Langkah 3:** setelah deploy (izin), verifikasi dengan `adb shell pm get-app-links id.smartagro.app`.

### Tugas 19: cek pembaruan APK

**Files:**
- Create: `UpdateCheck.kt`
- Test: `UpdateCheckTest.kt`

**Interfaces:**
- `fun isNewer(latestTag: String, current: String): Boolean`: membandingkan `v0.1.2` dengan `0.1.1` per angka.

- [ ] **Langkah 1:** tes kasus `v0.1.2 > 0.1.1`, `v0.2.0 > 0.1.9`, `v0.1.1 = 0.1.1`, dan tag tak terurai → `false`.
- [ ] **Langkah 2:** sekali sehari, `GET https://api.github.com/repos/Maliq-dlt/Smart-Argo/releases/latest`. Bila lebih baru, tampilkan baris "Versi baru tersedia" yang membuka halaman rilis.

Laporan crash tidak ditambahkan (ponytail: tambahkan saat rilis lewat Play Store).

### Tugas 20: syarat Play Store

**Files:**
- Create: `public/privasi.html` (halaman statis berbahasa Indonesia dengan token warna situs)
- Create: `docs/play-data-safety.md`

- [ ] **Langkah 1:** tulis data yang benar-benar dikumpulkan, diperiksa dari kode:
  - email, nama tampilan, foto profil, bacaan sensor, koordinat situs untuk cuaca;
  - log keamanan;
  - jurnal perawatan;
  - retensi;
  - cara hapus (`#hapus-akun`, tenggang 14 hari).
- [ ] **Langkah 2:** pengguna meninjau teks sebelum terbit.

---

## Keputusan yang menunggu pengguna

- Tugas 3: pilihan pH (A/B/C), harga dan tautan INA228.
- Tugas 4: izin commit, push, PR, merge, rilis cloud; PAT baru; nasib `android/design-preview/konsep-kebun/`.
- Tugas 8: angka acuan spesies beserta sumbernya.
- Tugas 18: sidik SHA-256 kunci rilis.
- Sisa tinjauan Codex 23 Nov:
  - (b) status `no_reading` saat perangkat diam;
  - (e) `device_silent` untuk perangkat yang belum dipasang;
  - (f) `<` vs `<=` antara peringatan dan Ringkasan;
  - (h) portal 10 menit tidak diperpanjang saat kalibrasi;
  - (i) kalibrasi ulang terbaca sebagai kenaikan;
  - (j) laju = rata-rata per pasangan;
  - (k) tag ditulis ulang di SQL (dijaga Tugas 5).

## Status

| Tugas | Status | Catatan / commit |
| --- | --- | --- |
| 1 | langkah 1–4 selesai, 5 berjalan | Pot 17 (cabai) di `sensor-care` merah (`band_source` undefined) lalu hijau 15/15, p95 Ringkasan 136,6 ms. Migrasi diubah di tempat (belum dikomit/cloud). |
| 2 | langkah 1–2 selesai, 3 menunggu ESP32 | `firmware/UJI-BANGKU.md`, ditautkan dari README firmware. |
| 3 | pilihan B (pH sekali sehari) | Langkah 2–3 menunggu harga dan tautan INA228 dari pengguna. |
| 4 | langkah 1 selesai; izin commit lokal | Berkas GoTrue dipindah ke `.tmp/gotrue-ref/`, `tsconfig.tsbuildinfo` diabaikan. `android/design-preview/konsep-kebun/` menunggu keputusan. |
| 5–7 | belum | |
| 8 | menunggu data | |
| 9–14 | belum | |
| 15–20 | belum | |
