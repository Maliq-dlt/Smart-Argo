# Fase 2 sampai 7: panggung tanaman, cuaca, pot dan kebun, belajar, fondasi live dan komunitas — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelesaikan Fase 2 sampai 7 dari spec, berhenti sebelum Fase 8 (aktivasi, butuh persetujuan pengguna dan menyentuh produksi). Pengguna (2026-11-15 sore): mock Fase 2.0 belum persis yang diinginkan, tetapi **lanjut sampai fase terakhir dulu, lalu review dari awal sampai akhir**.

**Architecture:** Mesin panggung dari mock (`design-previews/plant-stage-2026-11-15/index.html`) dipindah ke modul TypeScript tanpa dependensi baru (`src/components/plantScene/`), dipasang lewat satu komponen React `PlantScene` yang dipakai dashboard dan Ruang tanam. Logika murni (cuaca, kebun/siklus, observasi) tinggal di `src/lib/` dan diuji dengan `node --test`. Fase 6 dan 7 berupa migrasi, RPC, dan tes integrasi di `supabase/` yang **tidak diterapkan ke cloud**.

**Tech Stack:** React, TypeScript, Vite, Framer Motion (sudah ada), `node --experimental-strip-types --test`, Playwright (Chrome), Supabase (Postgres, edge function Deno).

**Spec:** `docs/superpowers/specs/2026-11-15-panggung-pot-kebun-cuaca-design.md`, bagian 5, 6, dan Fase 2 sampai 7.

## Global Constraints

- Semua teks UI berbahasa Indonesia, singkat, tanpa label kecil di atas judul. Font Fraunces Soft (judul) dan General Sans. Warna UI hanya lewat token; **palet ilustrasi panggung boleh hex di dalam `plantScene/`** (gambar, bukan UI) dan harus tetap selaras dengan token Sage.
- Aturan visual dari pengguna (mock): perangkat Smart Agro sama dengan landing tetapi **kecil dan bergaya kartun**; tanpa bentuk bulat-bulat pada probe; pembacaan sejajar bagiannya, tanpa kotak; **daun tidak bereaksi pada kursor**; denyut penyiraman kecil; reduced motion dihormati (pegas langsung sampai, tanpa goyangan).
- Tes yang ada tetap lulus; selektor yang dipakai tes (`.dash-stage[data-sky]`, `.plant-stage-section .dashboard-clock`, `.plant-mood`) dipertahankan. Teks 200% tidak meluap di 375 dan 320 px.
- `speciesId` permanen (cabai 1, bawang 2, anggrek 3, peoni 4). Kode tanaman = `speciesId * 1_000_000 + plant_no`, **global** (jawaban pengguna), huruf hanya tampilan.
- Tanaman tanpa profil kurasi (anggrek, peoni) tidak pernah dijawab mesin keputusan lama; tidak ada saran tanpa bukti, tidak ada data komunitas palsu, tidak ada dosis atau angka yang tidak ada di bukti.
- Fase 6 dan 7: **cloud tidak berubah**, tidak ada deploy function, tidak ada `db push`. Fase 8 tidak dikerjakan.
- Jangan sentuh `android/`. Lint: `npx eslint . --ignore-pattern 'android/**'`. Commit dan push per fase (permintaan tetap pengguna), akhiri pesan commit dengan `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Jam sesi melewati tengah malam (23,9 → 0,1): panggung harus maju melewati fajar, bukan memutar mundur lewat siang. Tes di Tugas 2.1.
- Tanaman belum ditanam (`planted=false`) atau `day` negatif/di luar rentang tidak boleh melempar galat atau menggambar tanaman. Tes di Tugas 2.1.
- Panggung dipasang dan dilepas berulang (pindah rute, ganti sesi): tidak boleh ada loop rAF yatim atau pendengar yang bocor. Tes browser di Tugas 2.3.
- Cuaca `hujan` dalam ruangan tidak menggerakkan adegan; kondisi tak dikenal dari penyedia jatuh ke `berawan`, bukan melempar galat. Tes di Tugas 3.1.
- Mengganti tanaman berulang kali di satu slot tidak mengubah riwayat siklus lama dan tidak membuat siklus ganda. Tes di Tugas 4.1.
- Saran tingkat 1 tidak pernah menyebut angka yang tidak ada di bukti dan tidak mengklaim "optimal untuk spesies". Tes di Tugas 5.2.
- Peracunan data komunitas: satu pemilik banyak akun, siklus pendek, ganti tanaman berulang, opt-out di tengah siklus. Tes integrasi di Tugas 7.1.

---

## Fase 2: Panggung tanaman

### Tugas 2.1: Mesin panggung (modul murni)

**Files:**
- Create: `src/components/plantScene/kit.ts` (matematika, `Spring`, `ribbon`, helper SVG), `src/components/plantScene/sky.ts` (palet langit per jam, `orbit`, `nightFactor`, `unwrapHour`), `src/components/plantScene/parts.ts` (media, akar, perangkat, air, daun, benih), `src/components/plantScene/plants.ts` (cabai, bawang merah, anggrek), `src/components/plantScene/scene.ts` (kelas `Scene`)
- Test: `tests/plantScene.test.ts`

**Interfaces:**
- Produces: `type SceneSpecies = 'cabai' | 'bawang' | 'anggrek'`; `interface SceneReadings { suhu: string; kelembapan: string; ph: string; alert?: { suhu?: boolean; kelembapan?: boolean; ph?: boolean } }`; `class Scene { constructor(svg: SVGSVGElement, opts: { species: SceneSpecies[]; readings: boolean }); set(state: { species?: SceneSpecies; day?: number; planted?: boolean; moisture?: number; hour?: number; contact?: boolean; readings?: SceneReadings; calm?: boolean }): void; pour(): void; frame(dt: number, now: number): void; night: number }`; `unwrapHour(current: number, next: number): number`; `nightFactor(hourOfDay: number): number`; `paletteAt(hour: number): string[]`.

- [x] **Step 1: Tulis tes yang gagal** (`tests/plantScene.test.ts`, impor `../src/components/plantScene/sky.ts` dan `kit.ts`): `unwrapHour(23.9, 0.1)` memberi `24.1` dan `unwrapHour(0.1, 23.9)` memberi `-0.1`; `nightFactor` 0 pada jam 10, 1 pada jam 22 dan jam 2, tidak naik-turun berulang antara jam 5 dan 8; `paletteAt` kontinu (selisih warna antar jam berdekatan kecil di setiap jam 0..24 langkah 0,25) dan `paletteAt(0) === paletteAt(24)`; `ribbon` mengembalikan path berawalan `M`, berakhiran `Z`, tanpa `NaN`, untuk panjang 0 dan panjang 100; `Spring` dengan `motion.reduced = true` langsung sampai target, dan tanpa reduced konvergen ke target dalam 3 detik dan tidak melewati target lebih dari 12% bila damping 1.
- [x] **Step 2: Jalankan** `node --experimental-strip-types --test tests/plantScene.test.ts`. Harapan: GAGAL (modul belum ada).
- [x] **Step 3: Pindahkan mesin dari mock** ke lima modul di atas dengan tipe TypeScript, tanpa mengubah perilaku, dengan perubahan ini: `motion.reduced` diekspor dari `kit.ts` (bukan membaca `matchMedia` sendiri); `Scene` tidak mengikat pendengar pointer dan tidak membuat gagang seret matahari; tidak ada `pointermove`; `set()` menerima `hour` dan memakai `unwrapHour`; `planted=false` memberi `day = -1` ke tanaman dan menampilkan benih kecil; `contact=false` mewarnai LED kuning dan menghentikan pita cahaya; pembacaan (`readings`) berupa teks SVG yang diberi `class="rl"`/`"rv"`; `pour()` menjalankan kaleng, aliran, riak, tetes tanpa mengubah kelembapan (kelembapan datang dari `set`). Warna hex hanya di modul ini dengan komentar bahwa ini palet ilustrasi.
- [x] **Step 4: Jalankan** tes dan `npm run typecheck`. Harapan: LULUS.
- [x] **Step 5: Commit** `feat(plant-scene): port the stage engine from the Fase 2.0 mock`

### Tugas 2.2: Komponen React dan pemasangan

> Selesai 2026-11-15. Deviasi: `PlantScene.tsx` ada di `src/components/` (bukan `plantScene/`); `PlantPotVisualizer` menerima `readings?: SceneReadings` (bukan `temp`/`ph`); `care` dinamai `careEffect` dan hanya `water` memutar kaleng (`plant` ditangani spring hari); `figcaption` diganti `aria-label` pada `svg role="img"`.

**Files:**
- Create: `src/components/plantScene/PlantScene.tsx`, `src/components/plantScene/plantScene.css`
- Modify: `src/components/dashboard/PlantStage.tsx` (figure, lensa, penunjuk, dan langit CSS diganti `PlantScene`; judul, status, dan `children` tetap), `src/components/PlantPotVisualizer.tsx` (SkyScene, PlantIllustration, dan pemilih tampilan diganti `PlantScene`; catatan kaki dan "Acuan fase per HST" tetap), `src/App.tsx` (meneruskan `temp`, `ph`, `careEffect`), `src/components/dashboard/dashboard.css` dan `src/styles.css` (hapus aturan `.sky`, `.orb`, `.stars`, `.hill`, `.stage-*`, `.lens*`, `.plant-canvas` yang tidak dipakai lagi)
- Delete: `src/components/PlantIllustration.tsx`, `src/components/SkyScene.tsx`

**Interfaces:**
- Consumes: `Scene` dan `SceneSpecies` dari Tugas 2.1.
- Produces: `<PlantScene species day planted moisture hour contact readings? care? label />` dengan `care?: { kind: 'plant' | 'water'; id: number }`; membuat `Scene` di `useEffect`, satu loop `requestAnimationFrame` yang berhenti saat tab tersembunyi atau elemen di luar layar (IntersectionObserver), membaca `prefers-reduced-motion` dan memperbaruinya saat berubah, dan membersihkan semuanya saat dilepas. Teks `figcaption` `sr-only` memuat spesies, hari, fase, dan ketiga pembacaan.

- [x] **Step 1:** Implementasikan `PlantScene.tsx`: `useRef<SVGSVGElement>`; efek pembuatan (`new Scene`), efek sinkron `set(...)` dari props, efek `care` (`water` memanggil `pour()`; `plant` menyetel hari dari 0 lalu kembali ke target), loop rAF dengan `dt` dibatasi 50 ms. Gaya: figure berasio 800/560, sudut membulat, `container-type: inline-size`; di bawah 34rem rasio 4/3,4 dengan `preserveAspectRatio="xMidYMid slice"`; `.rl`/`.rv` diperbesar di kontainer sempit.
- [x] **Step 2:** Pasang di `PlantStage` (pembacaan dari prop `readings` yang sudah ada, ditambah penanda `alert`) dan `PlantPotVisualizer`; hapus berkas dan CSS usang; jalankan `npm run typecheck` dan `npx eslint . --ignore-pattern 'android/**'`.
- [x] **Step 3:** Jalankan `npm run build`; semua tes unit; `node tests/dashboard-browser.js`, `tests/ui-browser.js`, `tests/pot-setup-browser.mjs`, `tests/route-transition-browser.js`. Perbarui selektor yang berubah **hanya** bila elemen lama sengaja hilang (catat tiap perubahan di pesan commit).
- [x] **Step 4: Commit** `feat(plant-scene): replace the pot illustration and the dashboard stage with PlantScene`

### Tugas 2.3: Bukti browser dan layar

**Files:**
- Create: `tests/plant-scene-browser.mjs`

- [x] **Step 1: Tulis tes browser** (Auth tiruan tidak perlu, masuk sebagai tamu lewat `asGuest`): dashboard memuat satu `svg` panggung tanpa error konsol; pindah ke `#simulasi` dan kembali 5 kali tidak menambah loop (hitung `requestAnimationFrame` aktif lewat penghitung yang disuntikkan, kembali ke ≤1); mengganti tanaman di Pengaturan mengganti judul `figcaption`; "Siram" memicu kaleng (`opacity` grup kaleng > 0 dalam 2 detik); jam sesi melewati tengah malam tidak membuat `hour` mundur lebih dari 1 jam; reduced motion mematikan goyangan (atribut `transform` tanaman tetap); tidak ada luapan horizontal di 1440, 768, 390, 320 px dan pada teks 200% di 375 dan 320.
- [x] **Step 2:** Tangkapan layar 1440/768/390/320 terang dan gelap ke `design-previews/plant-stage-port-2026-11-15/`; lihat dan perbaiki cacat nyata.
- [x] **Step 3: Commit dan push**; pantau Checks dan Deploy.

---

## Fase 3: Cuaca

> Selesai 2026-11-15. Deviasi: tanpa antarmuka `WeatherProvider` (belum ada implementasinya; muncul saat fungsi diaktifkan di Fase 8); `isSimWeather`, `simKind`, `conditionFromWmo`, `SIM_WEATHERS` dan `src/lib/weatherStore.ts` (kunci `smart-agro.weather`) ditambahkan; tampilan tiap cuaca ada di `LOOKS` (`plantScene/sky.ts`); fungsi dipecah `handler.ts` + `index.ts` seperti fungsi lain, memuat `fromOpenMeteo` dari `src/lib/weather.ts`; semua pot dianggap `outdoor` untuk catatan sampai Fase 4 memberi tiap situs penempatannya.

### Tugas 3.1: Model dan penyedia cuaca

**Files:**
- Create: `src/lib/weather.ts`, `tests/weather.test.ts`, `tests/fixtures/open-meteo-forecast.json`, `docs/cuaca.md`

**Interfaces:**
- Produces: `type Condition = 'cerah' | 'berawan' | 'mendung' | 'hujan' | 'badai'`; `type SimWeather = 'cerah' | 'berawan' | 'mendung' | 'hujan' | 'terik'`; `interface WeatherSnapshot { at: string; condition: Condition; tempC: number; humidity: number; cloud: number; windMs: number; rainMm: number; forecast: { inHours: number; condition: Condition; rainMm: number; tempC: number }[] }`; `interface WeatherProvider { snapshot(place: { lat: number; lon: number }): Promise<WeatherSnapshot> }`; `simulatedWeather(kind: SimWeather): WeatherSnapshot`; `fromOpenMeteo(json: unknown): WeatherSnapshot` (adapter murni, kode WMO ke `Condition`, nilai tak dikenal jatuh ke `berawan`); `weatherNote(w: WeatherSnapshot, placement: 'indoor' | 'outdoor' | 'rooftop'): string | null` (dalam ruangan `null`; `hujan ±N jam lagi: pertimbangkan menunda siram`; terik: `suhu tinggi: periksa media lebih sering`).

- [x] **Step 1:** Tes merah: adapter terhadap fixture rekaman Open-Meteo (kondisi, suhu, 6 jam prakiraan), kode WMO 0,1,2,3,45,51-67,80-82,95-99 dan nilai asing (`999`, `null`) tanpa melempar, `weatherNote` dalam ruangan selalu `null`, dan tidak menyebut dosis atau angka di luar snapshot.
- [x] **Step 2:** Implementasikan; tulis `docs/cuaca.md` (syarat tiap penyedia: Open-Meteo non-komersial 10.000/hari, BMKG izin tertulis dan atribusi, WeatherAPI.com 100.000/bulan komersial, MET Norway User-Agent) dan jalankan tes. Commit.

### Tugas 3.2: Lapisan cuaca di panggung dan kontrol demo

**Files:**
- Modify: `src/components/plantScene/scene.ts` (lapisan: awan menebal, tetes hujan, sinar dan riak panas, goyang angin), `src/components/plantScene/PlantScene.tsx` (prop `weather?: SimWeather`), `src/components/dashboard/PlantStage.tsx` (kontrol "Cuaca simulasi" sebagai segmented control, catatan konteks dari `weatherNote`), `tests/plantScene.test.ts`, `tests/plant-scene-browser.mjs`

- [x] **Step 1:** Tes merah (unit): `Scene.set({ weather })` menerima kelima nilai; `hujan` menaikkan jumlah tetes aktif; `cerah` nol tetes. Browser: tiap kondisi menghasilkan tangkapan tanpa error konsol; pilihan cuaca tersimpan di `localStorage` kunci `smart-agro.weather`.
- [x] **Step 2:** Implementasikan dan jalankan tes; tangkapan layar kelima kondisi siang/malam. Commit dan push.

### Tugas 3.3: Edge function `weather-forecast` (tidak di-deploy)

**Files:**
- Create: `supabase/functions/weather-forecast/index.ts`, `tests/weatherForecast.test.ts`

- [x] **Step 1:** Tes merah: validasi masukan (lat/lon di rentang, bukan angka ditolak), CORS terkunci ke `APP_ORIGIN`, galat penyedia menjadi `{ code: 'weather_unavailable' }`, dan **tidak ada** pemanggilan jaringan di tes (fetch disuntikkan, fixture rekaman).
- [x] **Step 2:** Implementasikan memakai `fromOpenMeteo` (impor `.ts` murni), tidak ditambahkan ke skrip deploy mana pun; catat di `docs/cuaca.md`. Commit.

---

## Fase 4: Pot pribadi dan kebun

### Tugas 4.1: Model kebun, slot, dan siklus (murni)

**Files:**
- Create: `src/lib/garden.ts`, `tests/garden.test.ts`

**Interfaces:**
- Produces: `type Placement = 'indoor' | 'outdoor' | 'rooftop'`; `interface Site { id: string; name: string; kind: 'pot' | 'garden'; placement: Placement; location?: { lat: number; lon: number } }`; `interface Cycle { id: string; speciesId: number; plantNo: number; nickname: string; plantedOn: string; endedOn?: string; outcome?: 'berhasil' | 'gagal' | 'dihentikan' }`; `interface Slot { id: string; siteId: string; name: string; sessionId: string | null; cycles: Cycle[] }`; `interface GardenBook { sites: Site[]; slots: Slot[]; activeSlotId: string | null; nextPlantNo: Record<number, number> }`; `addPersonalPot(book, input): GardenBook`; `addGarden(book, input): GardenBook`; `addSlot(book, siteId, name): GardenBook`; `plantInSlot(book, slotId, speciesId, plantedOn, nickname?): GardenBook` (nama otomatis "Cabai 1, 2, 3"; kode = `plantCode(speciesId, plantNo)`); `switchPlant(book, slotId, speciesId, on, outcome?): GardenBook` (menutup siklus aktif dengan hasil `dihentikan` bila tak ditentukan, membuka siklus baru; tidak mengubah siklus lama); `activeCycle(slot)`; `plantCode(speciesId, plantNo): number`; `parseGarden(raw: unknown): GardenBook` (validasi masukan penyimpanan lokal, tolak/bersihkan yang rusak); `demoGarden(): GardenBook` (satu pot anggrek dan satu kebun dua zona).

- [ ] **Step 1:** Tes merah: nama otomatis berurut per spesies; kode `plantCode(3, 7) === 3_000_007` dan `speciesId` di luar 1..2146 atau `plant_no` > 999.999 ditolak; mengganti tanaman 5 kali meninggalkan 5 siklus berhasil terurut, tepat satu aktif, dan riwayat lama tak berubah; mengganti ke spesies yang sama pada hari yang sama tidak membuat siklus ganda; `parseGarden` menolak JSON rusak, id ganda, dan slot yang menunjuk situs tak ada; `demoGarden` memuat pot anggrek dan kebun dua zona.
- [ ] **Step 2:** Implementasikan dan jalankan. Commit.

### Tugas 4.2: Penyimpanan, pemilih, dan wizard

**Files:**
- Create: `src/lib/gardenStore.ts` (kunci `smart-agro.garden.v1.<akun atau tamu>`), `src/components/SlotPicker.tsx`, `src/components/SlotWizard.tsx`, `src/components/SwitchPlantDialog.tsx`, `tests/garden-browser.mjs`
- Modify: `src/App.tsx` (slot aktif menentukan sesi yang dibuka; `PotSetup` tetap sebagai langkah pertama setelah masuk dan membuat slot pertama), `src/lib/species.ts` (`searchSpecies(query)` dengan nama dan alias; `plantNickname`), `tests/species.test.ts`

- [ ] **Step 1:** Tes merah browser (tamu dan akun tiruan): pemilih menampilkan situs dan slot; "Tambah" membuka wizard (Pot pribadi atau Kebun, penempatan, lokasi hanya bila luar ruang, tanaman lewat kolom cari, tanggal tanam); mengganti tanaman menampilkan dialog yang menjelaskan siklus lama ditutup dan riwayatnya disimpan, lalu membuka siklus baru; muat ulang mempertahankan semuanya; akun lain tidak melihat slot akun ini; `pot-setup-browser` yang ada tetap lulus tanpa perubahan.
- [ ] **Step 2:** Implementasikan; mode Kebun menampilkan ringkasan zona di atas panggung; penempatan dalam ruangan menyembunyikan kontrol cuaca. Jalankan semua tes browser terkait dan tangkapan layar. Commit dan push.

---

## Fase 5: Mode belajar (tingkat 0 dan 1)

### Tugas 5.1: Modul observasi deterministik

**Files:**
- Create: `src/lib/observation.ts`, `tests/observation.test.ts`

**Interfaces:**
- Produces: `interface Inspection { at: string; state: 'sehat' | 'biasa' | 'bermasalah'; note?: string }`; `interface Observation { days: number; readings: number; waterings: number; inspections: Inspection[] }`; `evidenceLevel(o: Observation, thresholds?): 0 | 1`; `healthyMoistureRange(samples, inspections): [number, number] | null`; `dryingRate(samples): number | null` (poin kelembapan per jam, siang); `waterResponse(samples, wateringAt: string[]): number | null`; `remaining(o, thresholds): { days: number; inspections: number; waterings: number }` dengan ambang awal 7 hari, 3 pengecekan, 2 siraman terukur.

- [ ] **Step 1:** Tes merah dengan data **sintetis berlabel**: kurang dari ambang selalu tingkat 0; tepat di ambang tingkat 1; rentang sehat hanya dari bacaan dalam 6 jam setelah pengecekan `sehat`; laju kering `null` bila kurang dari dua titik valid; bacaan tak valid diabaikan; hasil deterministik untuk masukan yang sama.
- [ ] **Step 2:** Implementasikan dan jalankan. Commit.

### Tugas 5.2: Penjelasan tingkat 1 dan kartu belajar

**Files:**
- Create: `src/components/LearningCard.tsx`, `tests/learningPrompt.test.ts`, `tests/learning-browser.mjs`
- Modify: `src/lib/aiExplanation.ts` (prompt `smart-agro.explain.v2` untuk tingkat 1 dan pemeriksa keluaran), `src/App.tsx` (spesies `belajar` menampilkan `LearningCard` sebagai ganti kartu jawaban mesin; sesi demo anggrek dengan data simulasi sendiri), `src/lib/species.ts` (ambang di katalog)

- [ ] **Step 1:** Tes merah prompt: keluaran yang menyebut dosis, angka yang tidak ada di bukti, atau "optimal untuk spesies" ditolak oleh pemeriksa; label asal data ("Berdasarkan pola pot Anda, bukan standar tanaman") wajib ada; tingkat 0 tidak pernah memanggil model.
- [ ] **Step 2:** Tes merah browser: kartu "Sedang belajar" menampilkan kemajuan, apa yang terekam, dan satu tindakan; mencatat pengecekan menaikkan hitungan; demo anggrek berpindah dari tingkat 0 ke 1 setelah ambang terpenuhi lewat data simulasi miliknya.
- [ ] **Step 3:** Implementasikan; jalankan semua tes; tangkapan layar. Commit dan push.

---

## Fase 6: Persistensi server dan mode `live` (tidak aktif)

**Files:**
- Create: `supabase/migrations/20261115100000_garden_sites_cycles.sql`, `tests/garden.integration.mjs`, `tests/liveMode.test.ts`
- Modify: `package.json` (`build:live`), `vite.config.ts` atau `src/lib/appMode.ts` (`VITE_APP_MODE=demo|live`), tes yang memeriksa tampilan `live`

- [ ] **Step 1:** Tes integrasi merah (pola tahap 6–12: `tests/*.integration.mjs` memakai backend lokal): tabel `site`, `plant_cycle`, perluasan `garden_pot` (`site_id`, `unit_id` opsional, `placement`); RLS menolak membaca milik pengguna lain; RPC `SECURITY DEFINER` dengan `search_path` terkunci dan hak EXECUTE hanya `authenticated`; mengganti tanaman menutup siklus lama secara atomik; `plant_no` global unik per spesies dan kode muat integer.
- [ ] **Step 2:** Tulis migrasi dan jalankan suite backend penuh dari basis data baru (Docker). Tes unit mode `live`: tamu, Ruang tanam, dan cuaca simulasi tersembunyi. Pastikan **tidak ada** perubahan ke cloud. Commit.

---

## Fase 7: Pengetahuan komunitas (tingkat 2, tidak aktif)

**Files:**
- Create: `supabase/migrations/20261115110000_community_knowledge.sql`, `tests/community.integration.mjs`

- [ ] **Step 1:** Tes integrasi merah: opt-in per slot; agregat anonim hanya dengan zona iklim kasar dan tanpa id akun; ambang `k` (≥3 pemilik berbeda, ≥5 siklus berhasil) menahan hasil di bawah ambang; pencilan dipangkas; kurator bisa mengecualikan sumber; skenario peracunan (satu pemilik banyak akun, siklus pendek, ganti tanaman berulang, opt-out di tengah siklus) tidak lolos ke agregat; **tidak ada jalur** yang mengembalikan data per-pengguna ke pengguna lain (uji sebagai pengguna lain dan sebagai anon). Data sintetis diberi label.
- [ ] **Step 2:** Tulis migrasi dan fungsi agregat; jalankan suite backend penuh; catat label "belum dikurasi" pada hasil. Commit dan push (hanya repo, bukan cloud).

---

## Penutup

- [ ] Perbarui `CHANGELOG.md`, `HANDOFF.md`, `CLAUDE.md`, catatan Obsidian; matikan server; kemas daftar pertanyaan untuk review menyeluruh dari awal sampai akhir (Fase 0 sampai 7). Fase 8 tetap menunggu persetujuan pengguna.
