# Fase 1: Katalog Tanaman — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti boolean `onion` dan literal `'cabai' | 'bawang'` dengan satu katalog spesies (`src/lib/species.ts`), tanpa perubahan visual dan tanpa perubahan perilaku.

**Architecture:** Katalog berupa data murni tanpa impor, jadi bisa diuji dengan `node --test` dan diimpor oleh `agronomyEngine.ts`, `dashboardFacts.ts`, `simulation.ts`, dan `productAccountClient.ts` (impor memakai akhiran `.ts` seperti `identity.ts`). Spesies `kurasi` membawa profil agronomi (indeks skenario, hari pertumbuhan ilustrasi, hari maksimum, fase); spesies `belajar` (anggrek, peoni) hanya identitas. Pekerjaan menyalin angka dari kode lama, dan sebuah **oracle** (salinan fungsi lama di dalam tes) membuktikan hasilnya sama.

**Tech Stack:** TypeScript, `node --experimental-strip-types --test`, Playwright (Chrome), Vite.

**Spec:** `docs/superpowers/specs/2026-11-15-panggung-pot-kebun-cuaca-design.md`, bagian "Fase 1" dan bagian 11.

## Global Constraints

- **Selesai bila:** semua tes yang ada lulus tanpa mengubah asersinya, dan DOM halaman identik sebelum dan sesudah (Tugas 4). Dua pengecualian yang dinyatakan: `tests/dashboardFacts.test.ts` dan `tests/engine.test.ts` hanya mengganti argumen `false/true` menjadi `'cabai'/'bawang'` karena tanda tangan `phaseAt`/`phaseSteps`/`phaseIndex` berubah; nilai yang diasersikan tetap. (`engine.test.ts` baru ketahuan saat tes unit dijalankan: peta awal hanya menyisir `src/`.)
- ID katalog untuk spesies kurasi tetap `cabai` dan `bawang` (sama dengan nilai yang sudah tersimpan di token/sesi), jadi tidak ada alias atau migrasi. Nama tampilan tetap "Cabai" dan "Bawang merah".
- Spesies `belajar` belum bisa dibuka di aplikasi (belum ada alur "Mengamati", Fase 4): `parsePot` menolaknya. Perlebar di Fase 4.
- `speciesId` bilangan bulat positif, unik, **permanen** begitu kode tanaman terbit (Fase 4): `code = speciesId * 1_000_000 + plant_no` harus muat di `integer` Postgres, jadi `speciesId ≤ 2146`. Huruf tampilan ("E") belum ditentukan; menunggu jawaban pengguna, jadi tidak ada di katalog.
- Hanya data yang dipakai sekarang yang masuk katalog (tanpa visual, ambang data, alias pencarian); tiap fase berikutnya menambah bidangnya sendiri.
- Jangan sentuh `android/`. Lint: `npx eslint . --ignore-pattern 'android/**'`.

## Review Focus

- Token dibuat pemiliknya sendiri: `crop` bernilai `'constructor'`, `'__proto__'`, `'toString'`, atau `'anggrek'` harus ditolak `parsePot` (pencarian objek biasa meloloskan tiga yang pertama). Tes di Tugas 2.
- Sesi lama di localStorage: `profile.crop` bisa "Bawang merah", "BAWANG", atau teks lain/kosong; hasil harus sama dengan `includes('bawang')` lama, dan teks asing jatuh ke cabai. Tes di Tugas 1.
- Batas fase: hari 0, 1, 25, 26, 30, 31, 50, 51, 55, 56, 65, 90 dan lewat maksimum (100) memberi fase yang sama dengan fungsi lama. Tes oracle di Tugas 3.
- Token/pot lama `{ crop: 'cabai' | 'bawang' }` tetap terbaca (`identityFromClaims`). Tes di Tugas 2.
- Perbedaan visual tersembunyi (judul SVG, label fase, tick instrumen) pada kedua spesies di 1440 dan 390 px. Tugas 4.

---

### Task 0: Garis dasar DOM sebelum perubahan apa pun

**Files:**
- Create: `.tmp/parity-dom.mjs` (tidak dilacak git)

- [ ] **Step 1: Bangun `dist` dari HEAD ke `.tmp/baseline-dist`** (`npm run build`, lalu salin `dist` ke `.tmp/baseline-dist`).
- [ ] **Step 2: Tulis `.tmp/parity-dom.mjs`**: menyajikan folder `dist` yang diberikan (`--host 127.0.0.1`), membuka sebagai tamu dengan `page.clock` dibekukan, dan untuk cabai lalu bawang (lewat `Profil tanaman` di sheet pengaturan, seperti `tests/ui-browser.js:145`) di 1440 dan 390 px menyimpan `main.innerHTML` yang dinormalisasi (id `useId`, id sesi, dan stempel waktu dibuang) ke JSON.
- [ ] **Step 3: Jalankan terhadap baseline dua kali**; kedua hasil harus identik (kalau tidak, normalisasi masih kurang). Simpan sebagai `.tmp/parity/baseline.json`.

### Task 1: Katalog `src/lib/species.ts`

**Files:**
- Create: `src/lib/species.ts`
- Test: `tests/species.test.ts`

**Interfaces:**
- Produces: `type CuratedId = 'cabai' | 'bawang'`; `type SpeciesId = CuratedId | 'anggrek' | 'peoni'`; `interface Phase { name: string; start: number }`; `interface Species { id: SpeciesId; speciesId: number; name: string; category: 'sayur_buah' | 'hias' | 'perkebunan'; form: 'semak' | 'roset' | 'umbi'; tier: 'kurasi' | 'belajar' }`; `interface Curated extends Species { id: CuratedId; tier: 'kurasi'; scenario: number; growthDays: number; maxDay: number; phases: readonly Phase[] }`; `SPECIES: readonly Species[]`; `CURATED_IDS: readonly CuratedId[]`; `curated(id: CuratedId): Curated`; `isCuratedId(value: unknown): value is CuratedId`; `speciesOfCrop(crop: string): CuratedId`; `phaseRanges(id: CuratedId): [range: string, name: string][]`.

- [ ] **Step 1: Tulis tes yang gagal** di `tests/species.test.ts`, import dari `../src/lib/species.ts` dan `../src/lib/scenarios.json`:
  - `speciesId` setiap entri bilangan bulat 1..2146 dan unik; `id` unik; tepat dua `kurasi` (`cabai`, `bawang`) dan dua `belajar` (`anggrek`, `peoni`).
  - Nilai yang disalin dari kode lama: `curated('cabai')` → `scenario 0, growthDays 62, maxDay 90`, fase `Awal tanam 0, Vegetatif 1, Berbunga 31, Berbuah 56`; `curated('bawang')` → `scenario 7, growthDays 48, maxDay 65`, fase `Awal tanam 0, Vegetatif 1, Pembentukan umbi 26, Pematangan umbi 51`.
  - `scenarios[curated(id).scenario].profile.crop` lewat `speciesOfCrop` kembali ke `id` untuk kedua spesies.
  - `speciesOfCrop`: `'Cabai'`→`cabai`; `'Bawang merah'`, `'BAWANG'`, `'bawang'`→`bawang`; `''`, `'Synthetic test crop'`→`cabai`.
  - `isCuratedId`: benar untuk `'cabai'`, `'bawang'`; salah untuk `'anggrek'`, `'constructor'`, `'__proto__'`, `'toString'`, `42`, `null`, `undefined`.
  - `phaseRanges('cabai')` sama persis dengan `[['0','Awal tanam'],['1–30','Vegetatif'],['31–55','Berbunga'],['56–90','Berbuah']]` dan `phaseRanges('bawang')` dengan `[['0','Awal tanam'],['1–25','Vegetatif'],['26–50','Pembentukan umbi'],['51–65','Pematangan umbi']]` (tanda hubung en `–`).
- [ ] **Step 2: Jalankan** `node --experimental-strip-types --test tests/species.test.ts`. Harapan: GAGAL (modul belum ada).
- [ ] **Step 3: Implementasikan `src/lib/species.ts`** tanpa impor. `isCuratedId` memakai `CURATED_IDS.includes`, bukan pencarian properti objek. `speciesOfCrop` = `crop.toLowerCase().includes('bawang') ? 'bawang' : 'cabai'` dengan komentar `ponytail:` (hanya dua spesies kurasi; Fase 4 menyimpan id spesies di data sesi). `phaseRanges`: akhir rentang = `start` fase berikutnya − 1, atau `maxDay` untuk fase terakhir; satu hari ditulis `"0"`, selainnya `"a–b"`.
- [ ] **Step 4: Jalankan tes**. Harapan: LULUS.
- [ ] **Step 5: Commit** `feat(species): add plant catalog with curated and learning species`

### Task 2: Tipe pot dan `parsePot` memakai katalog

**Files:**
- Modify: `src/lib/productAccountClient.ts:85-92` (`PotSetup.crop: CuratedId`, `parsePot` memakai `isCuratedId`), `src/components/PotSetup.tsx:10-12` (`POT_SCENARIO` dari katalog), `src/App.tsx:289,395,445` (indeks skenario dan opsi pilihan dari katalog)
- Test: `tests/species.test.ts` (tambahan) atau berkas baru `tests/pot.test.ts`

**Interfaces:**
- Consumes: `CURATED_IDS`, `curated(id).scenario`, `curated(id).name`, `isCuratedId`.

- [ ] **Step 1: Tulis tes yang gagal** untuk `parsePot` (impor dari `../src/lib/productAccountClient.ts`):
  - pot lama `{ name: 'Pot teras', crop: 'cabai', device: true }` dan `{ …, crop: 'bawang', device: false }` dibaca persis sama (nama dirapikan seperti sebelumnya);
  - `crop` bernilai `'anggrek'`, `'peoni'`, `'constructor'`, `'__proto__'`, `'toString'`, `''`, `42` → `null`.
- [ ] **Step 2: Jalankan**. Harapan: LULUS terhadap kode lama. Ini tes karakterisasi: ia mengunci perilaku sebelum refaktor, jadi tidak ada merah yang diharapkan; nilainya ada di Step 4, saat tes yang sama harus tetap hijau setelah kode diganti.
- [ ] **Step 3: Ubah kode**: `PotSetup.crop` menjadi `CuratedId`; `parsePot` mengganti dua pembandingan literal dengan `isCuratedId(value.crop)`; `PotSetup.tsx` membangun `crops` dari `CURATED_IDS` dengan `scenarios[curated(id).scenario].profile`; `App.tsx` mengganti `onion ? 7 : 0` / `pot.crop === 'bawang' ? 7 : 0` / `value === 'bawang' ? 7 : 0` dengan `curated(id).scenario` dan opsi `Profil tanaman` dari `CURATED_IDS.map(id => ({ value: id, label: curated(id).name }))`.
- [ ] **Step 4: Jalankan** `npm run typecheck`, `npm test`, `node tests/pot-setup-browser.mjs` (preview 4173). Harapan: hijau tanpa mengubah tes lama.
- [ ] **Step 5: Commit** `refactor(pot): validate pot crop against the species catalog`

### Task 3: Hapus `onion` dari mesin, simulasi, dan komponen

**Files:**
- Modify: `src/lib/agronomyEngine.ts:170` (`phaseAt(day: number, id: CuratedId)`), `src/lib/dashboardFacts.ts:18-24` (`phaseSteps(id)`, `phaseIndex(day, id)` diturunkan dari `curated(id).phases` dan `maxDay`), `src/lib/simulation.ts:46,84-96`, `src/lib/sessionStore.ts:51`, `src/components/SimulationControls.tsx:14`, `src/App.tsx:158-159,455,462,477-478,497`, `src/components/PlantIllustration.tsx:5-13,37`, `src/components/PlantPotVisualizer.tsx:11-12,21,30-31`, `src/components/dashboard/PlantStage.tsx:33-34,71,75`, `src/components/dashboard/Instruments.tsx:14-18`, `src/lib/landingStory.ts:28`
- Test: `tests/species.test.ts` (tambahan oracle), `tests/dashboardFacts.test.ts` (hanya argumen)

**Interfaces:**
- Consumes: `curated(id)`, `speciesOfCrop`, `phaseRanges`.
- Produces: `phaseAt(day: number, id: CuratedId): string`; `phaseSteps(id: CuratedId): { names: string[]; starts: number[]; total: number }`; `phaseIndex(day: number, id: CuratedId): number`; komponen menerima prop `species: CuratedId` menggantikan `onion: boolean`.

- [ ] **Step 1: Tulis tes oracle yang gagal**. Di dalam tes, salin fungsi lama sebagai `legacyPhaseAt(day, onion)` (isinya persis kode lama di `agronomyEngine.ts:170-174`) dan `legacySteps(onion)` (persis `dashboardFacts.ts:19-23`). Untuk `day` 0..100 dan kedua spesies: `phaseAt(day, id)` sama dengan oracle; `phaseSteps(id)` sama (`deepEqual`) dengan oracle; `speciesOfCrop(profile.crop)` untuk tiap entri `scenarios.json` memberi `maxDay` yang sama dengan `crop.includes('bawang') ? 65 : 90` lama.
- [ ] **Step 2: Jalankan**. Harapan: GAGAL (untuk `cabai`, fungsi lama menganggap string non-kosong sebagai `true`).
- [ ] **Step 3: Implementasikan** `phaseAt`/`phaseSteps` dari `curated(id)`: `phaseAt` mengembalikan nama fase terakhir yang `start`-nya ≤ `day`; `phaseSteps` memetakan `names`/`starts` dan `total: maxDay`. Ganti di setiap pemanggil `profile.crop.toLowerCase().includes('bawang')` dengan `speciesOfCrop(profile.crop)`, angka `65 : 90` dengan `curated(id).maxDay`, `onion ? 48 : 62` dengan `curated(id).growthDays`, judul SVG dengan `curated(id).name`, daftar rentang di `PlantPotVisualizer` dengan `phaseRanges(id)`. Cabang gambar bawang di `PlantIllustration` menjadi `species === 'bawang'` (bentuk gambar pindah ke data di Fase 2). Perbarui `tests/dashboardFacts.test.ts` hanya pada argumen (`[false, true]` menjadi `['cabai', 'bawang'] as const`, label tes menyesuaikan).
- [ ] **Step 4: Jalankan** `npm run typecheck` dan `npm test`. Harapan: hijau.
- [ ] **Step 5: Commit** `refactor(species): replace the onion flag with catalog lookups`

### Task 4: Bukti tanpa perbedaan dan rilis

**Files:**
- Modify: `CHANGELOG.md`, `HANDOFF.md`, `CLAUDE.md` (baris Progres), catatan Obsidian

- [ ] **Step 1: Bangun `dist` baru**, jalankan `.tmp/parity-dom.mjs` terhadapnya → `.tmp/parity/after.json`. Harapan: identik dengan `baseline.json` (cabai dan bawang, 1440 dan 390 px). Bila berbeda, tiap selisih harus dijelaskan dan diperbaiki sebelum lanjut.
- [ ] **Step 2: Jalankan pemeriksaan wajib**: `npx eslint . --ignore-pattern 'android/**'`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.
- [ ] **Step 3: Jalankan tes browser yang menyentuh area ini** (preview `--host 127.0.0.1`, port bawaan masing-masing): `ui-browser.js`, `dashboard-browser.js`, `pot-setup-browser.mjs`, `route-transition-browser.js`, `account-browser`, `gate-motion-browser.mjs`.
- [ ] **Step 4: Perbarui dokumen** (CHANGELOG, HANDOFF, CLAUDE.md, Obsidian) dan matikan semua server preview.
- [ ] **Step 5: Commit dan push** (permintaan tetap pengguna: "jika sudah selesai tinggal di push"); sertakan `tests/cloud-smoke.mjs` yang masih tertunda. Pantau Checks dan Deploy sampai hijau.
