# Rancangan: landing dengan perangkat 3D dan ilustrasi 2D

Tanggal: 2026-11-13. Status: menunggu persetujuan pengguna. Proyek pertama dari tiga (landing → dashboard → maskot login).

## Maksud

Landing v5 bercerita lewat sekuens frame dan video hasil Google Veo, sekitar 11 MB. Saat discroll gambarnya blur, dan bentuk perangkatnya berganti-ganti antar-klip (probe pipih di satu foto, batang bulat di foto lain).

Rancangan ini mengganti media itu dengan:
- **satu perangkat 3D yang dirakit dari kode** (Three.js), tajam di layar apa pun, dan berganti keadaan sepanjang cerita;
- **ilustrasi 2D Lottie** untuk bagian pertumbuhan tanaman, dengan warna yang disesuaikan ke palet Sage.

Tujuannya agar landing terasa elegan, ringan, dan konsisten. Perangkat yang sama nanti dipakai ulang di dashboard.

## Keputusan pengguna

Semua pada 2026-11-13, sesi Claude Code ini.

- 20:04: landing dan dashboard dirombak dengan kombinasi 2D dan 3D. Utamakan efisiensi dengan hasil bagus; hindari Blender karena berat dan boros token.
- 20:11: perangkat 3D cukup **interaktif dasar**. Interaksi kompleks diurus 2D. Cara membuat 3D diserahkan ke agen.
- 20:26: spike 3D pertama "lumayan" tapi terlalu polos; perlu pemanis yang menjelaskan produk. Dashboard nanti diturunkan dari landing dan dibuat lebih informatif.
- 20:39: Rive tetap **paket Free** dan **hanya untuk 2D**. Kalau Free terbatas, ambil objek Marketplace apa adanya.
- 20:46: perangkat 3D versi terakhir spike **disetujui**, termasuk **label**. Untuk 2D dipilih **pendekatan A** (Rive Marketplace apa adanya + Lottie + SVG/GSAP), dengan pesan "cari yang terbaik".
- Urutan landing → dashboard → maskot login diusulkan agen dan tidak dibantah.

Acuan visual yang disetujui: `design-previews/device-3d-spike-2026-11-13/index.html` (serve dari root repo, misalnya `python -m http.server 4180`). Tangkapan layar ada di `.tmp/spike-3d/v2-*.png`.

## Tujuan

1. Ganti video `spin-loop.mp4` dan sekuens `lie`, `rootzone`, `water`, `grow` dengan perangkat 3D dan Lottie. Hapus aset lama (sekitar −10 MB).
2. Satu perangkat untuk seluruh cerita, dengan keadaan berurutan: studio (Hero) → label (Product) → tembus pandang (Product) → di tanah (RootZone) → sorot angka (Numbers).
3. Bagian Grow memakai Lottie "plant5v3" yang warnanya disesuaikan, maju satu tahap per klik.
4. Berjalan di tema terang dan gelap, lebar 1440/768/390/320, reduced motion, dan tanpa WebGL.
5. Komponen perangkat bisa dipakai ulang oleh dashboard tanpa ditulis ulang.

## Bukan tujuan

- Rombak dashboard dan maskot login (proyek berikutnya).
- Mengubah teks cerita, kecuali yang terpaksa berubah karena medianya berubah.
- Bagian baru, FAQ, atau footer. `MeadowRiseFooter` tetap.
- Video kebun di LeafReveal (`garden.mp4`) tetap. Itu video asli, bukan sekuens frame, dan tidak dikeluhkan.

## Anti-tujuan (gagal walau "jalan")

- Landing jadi lebih berat atau lebih lambat tampil daripada sekarang.
- Perangkat terlihat bergerigi, blur, atau "plastik murahan".
- Label berisi fakta yang tidak ada di dokumen proyek.
- Drag 3D membajak scroll di ponsel.
- Layout melompat saat chunk Three.js selesai dimuat.
- Lebih dari satu konteks WebGL hidup bersamaan di landing.

## Kondisi sekarang (hasil baca kode)

- `LandingPage.tsx` merender Hero, Problem, Product, RootZone, Numbers, LeafReveal, Grow, Explore, lalu footer. Scroll memakai Lenis (`smoothScroll.ts`) dan GSAP ScrollTrigger.
- `Hero.tsx`: video `spin-loop.mp4` dengan poster. `pixelTrail(section, trail, clip)` mengambil sampel video untuk mosaik trail. Event `smartagro:ready` dikirim saat frame video pertama siap, lalu loading curtain terbuka.
- `Story.tsx`:
  - `useScrubbedSequence` memutar `FrameSequence` (`frameSequence.ts`) mengikuti scroll.
  - Product memakai `lie` (43 frame) dengan 3 fase lewat `usePhases`.
  - RootZone memakai `rootzone` (95 frame) dengan 3 fase.
  - Numbers memakai `water` (49 frame) sebagai hiasan `aria-hidden` di samping 4 angka dari engine (30 menit, 3 sensor, batas kering cabai, Wh per hari).
  - Problem memakai `PlantArt` (SVG + DrawSVG) dan satu gambar inline `seq/rootzone/m/00.avif`.
- `Grow.tsx`: 96 frame `grow`, 4 tahap per klik (Minggu 1, Minggu 3, Minggu 5, Berbunga), judul berganti di akhir, tombol Ulangi, keterangan "Ilustrasi pertumbuhan, bukan data sensor."
- `tests/landing-browser.mjs` memeriksa `src` video hero, kanvas yang sudah tergambar (`painted`) di Product, RootZone dan Grow, fase Product, serta alur klik Grow.
- Fakta perangkat (`docs/sistem-kerja-tim.md`, `docs/telemetry-v1.md`, `landingNarrative.ts`): ESP32, sensor kelembapan kapasitif, DS18B20, pH tanah, panel surya dan baterai, satu bacaan tiap 30 menit.

## Pendekatan

**Sumber 3D** (dipilih: dirakit dari kode)

| Pilihan | Untung | Rugi |
| --- | --- | --- |
| Dirakit dari kode Three.js (**dipilih**) | Tajam, tanpa file model, tiap bagian bisa dianimasikan sendiri, cahaya ikut tema | Lemah untuk bentuk organik (bukan masalah: perangkatnya sederhana) |
| AI foto→3D (Meshy, Tripo, TRELLIS) | Cepat untuk bentuk apa pun | Satu mesh menyatu dengan cahaya tercetak; berbayar atau kualitas tidak stabil |
| Blender | Kualitas tertinggi | Berat dan boros token (ditolak pengguna) |

**Sumber 2D** (dipilih: A)

| Pilihan | Untung | Rugi |
| --- | --- | --- |
| A. Rive Marketplace apa adanya + Lottie berwarna Sage + SVG/GSAP (**dipilih**) | Tanpa splash Rive, gratis, warna Lottie bisa diubah | Satu library tambahan |
| B. Rive yang di-remix | Satu alat | Paket Free memutar splash Rive di tiap file ekspor |
| C. SVG + GSAP saja | Paling ringan | Semua ilustrasi digambar tangan |

**Hasil pencarian aset ("cari yang terbaik")**

- Rive Marketplace: 80 posting dari 20 kata kunci, 16 dimuat dengan runtime di latar Sage terang dan gelap (`.tmp/assets-2d/rive-harness.png`).
  - Kandidat terbaik untuk landing: "Plant" #9953 (input `level`, latar transparan). Kelemahannya: hanya 3 tahap, tanpa pot, dan gaya tahap awalnya berbeda.
  - Kandidat lain umumnya berlatar tertanam (pink, gelap, ungu) atau bergaya neon/kartun.
- LottieFiles: 87 animasi dari 11 kata kunci (`.tmp/assets-2d/lottie-frames.png`). "plant5v3" #1509169 memuat pot terakota kosong → tunas → berdaun → berbunga putih dalam satu timeline. Ini cocok dengan teks Grow ("cabai di pot terakota"), dan bunga cabai memang putih.
- **Keputusan saya:** landing **tidak memakai Rive**, karena Lottie menang untuk satu-satunya peran 2D yang tersisa. Runtime Rive juga lebih berat untuk satu hiasan. Rive disimpan untuk dashboard dan maskot. Kandidat yang sudah dicatat: "Interactive Sprout Mascot" #28531 (input tidur, makan, digelitik, ikut kursor), "Glass Battery" #24403, "Water Cup" #1341.

## Rancangan

### 1. Panggung perangkat bersama

- Pindahkan model dari spike ke modul TypeScript, misalnya `src/components/device/`:
  - fungsi murni pembangun model;
  - komponen React panggung.
  - Pembagian file diserahkan ke pembangun; ikuti gaya repo.
- **Isi model, sama dengan spike yang disetujui:**
  - badan superellipsoid dua warna dengan garis sambungan;
  - AgroMark timbul (path dari `AgroMark.tsx`);
  - panel surya miring dengan bingkai;
  - LED dengan cincin;
  - karet di pangkal probe dan tutup port belakang;
  - dua probe baja dengan tanda kedalaman;
  - bagian dalam: papan ESP32, baterai, kabel probe;
  - penampang tanah dengan akar dan gelombang kelembapan;
  - siklorama studio dengan lampu sorot bertekstur daun.
- **Satu renderer untuk seluruh landing.** Kanvas berpindah ke "slot" bagian yang sedang aktif, atau satu lapisan tetap di atas halaman. Pembangun boleh memilih, asal hanya ada satu konteks WebGL.
- **Keadaan (mode):** `studio`, `label`, `tembus`, `tanah`, `angka`.
  - Perpindahan antar-keadaan memakai tween, bukan lompat: label memudar, perangkat turun ke tanah, dan sebagainya.
  - Mode `tembus` memakai material `transmission` yang mahal, jadi hanya aktif selama fase itu.
- **Interaksi dasar:**
  - seret untuk memutar (rotate saja, sudut vertikal dibatasi, tanpa zoom atau pan);
  - putar pelan otomatis saat diam, berhenti saat diseret, lanjut 2,5 detik kemudian;
  - di layar sentuh `touch-action: pan-y`, supaya scroll vertikal tetap milik browser.
- **Hemat:**
  - render hanya saat panggung terlihat;
  - DPR maksimal 2 di desktop dan 1,5 di ponsel;
  - shadow map 1024.
  - Three.js dimuat sebagai chunk terpisah yang hanya diminta landing.
- **Tema:** warna studio dan cincin kelembapan dibaca dari token CSS dan diperbarui saat `html[data-theme]` berubah. Ingat jebakan: baca tema lagi setelah observer terpasang.
- **Label (DOM, Bahasa Indonesia), hanya fakta dari dokumen:**

  | Label | Catatan | Sumber |
  | --- | --- | --- |
  | Panel surya | mengisi baterai | `landingNarrative.ts` (solarInput) |
  | LED baca | tiap 30 menit | Numbers dan RootZone |
  | Probe zona akar | kelembapan · suhu · pH | `sistem-kerja-tim.md` |
  | ESP32 | mengirim data | `sistem-kerja-tim.md` |
  | Baterai | cadangan 3 hari | `solarInput.autonomyDays`; angkanya dibaca dari kode, bukan ditulis tangan |

  - Label meredup saat titiknya tertutup badan perangkat.
  - Di layar ≤480 px hanya judul label yang tampil.
- **Poster per keadaan:**
  - Lima gambar statis berlatar transparan, satu per keadaan (`studio`, `label`, `tembus`, `tanah`, `angka`), misalnya `public/landing/device/<keadaan>.webp`.
  - Dirender sekali dari adegan kode yang sama lewat skrip Playwright, tanpa siklorama, supaya latar CSS terlihat di kedua tema.
  - Label tetap DOM di atas poster.
- **Slot per bagian:**
  - Tiap bagian punya slot berukuran tetap (aspect-ratio di CSS, tanpa CLS) yang berisi poster keadaannya.
  - Kanvas hidup menimpa slot bagian yang aktif.
  - Saat dua bagian sama-sama terlihat di perbatasan scroll, bagian yang tidak aktif tetap menampilkan poster.
- **Siap:** `smartagro:ready` dikirim saat frame pertama atau poster hero siap, mana yang lebih dulu, dengan batas waktu supaya curtain tidak tertahan.
- **Tanpa WebGL:** hanya poster dan label.
- **Reduced motion:**
  - Kanvas hidup tidak dipakai. Tiap bagian menampilkan poster keadaan akhirnya.
  - Ini cocok dengan aturan yang sudah ada: tanpa sticky stage, sehingga bagian-bagian tampil bertumpuk sekaligus.

### 2. Hero

- Video diganti panggung dengan mode `studio`.
- Wordmark, teks, tombol, tag "Render konsep perangkat", dan blok berundak tetap.
- Trail kursor: mosaik yang sekarang mengambil sampel video diubah agar mengambil sampel kanvas 3D, atau cukup kotak solid. Pembangun memilih; utamakan mempertahankan mosaik.

### 3. Product (`#kenalan`)

Sekuens `lie` diganti panggung. Teks fase tetap.

| Fase | Teks | Keadaan perangkat |
| --- | --- | --- |
| 0 | "Bagaimana kalau pot bisa memberi tahu sendiri?" | `studio` |
| 1 | "Kenalkan Smart Agro." | `label`: panel surya, LED, probe |
| 2 | kartu fitur | `tembus`, ditambah label ESP32 dan Baterai |

### 4. RootZone (`#zona-akar`)

- Sekuens `rootzone` diganti mode `tanah`. Seiring scroll, perangkat turun dan tertancap di penampang tanah, lalu gelombang kelembapan muncul tiap LED berkedip.
- Tiga teks fase tetap.

### 5. Numbers

- Sekuens `water` diganti mode `angka`. Perangkat **tetap tertancap di penampang tanah** dari RootZone, supaya ceritanya bersambung dan cincin kelembapan punya tempat. Saat tiap angka masuk layar, bagian perangkat yang terkait disorot:

  | Angka | Bagian yang disorot |
  | --- | --- |
  | 30 menit | denyut LED |
  | 3 sensor | probe + label |
  | batas kering | cincin kelembapan |
  | Wh per hari | kilau panel surya + label Baterai |

- Angka tetap dihitung dari engine (`thresholds`, `solarSizing`).

### 6. Problem

- `PlantArt` tetap.
- Gambar inline zona akar dipindahkan dari `seq/rootzone/m/00.avif` ke `public/landing/rootzone-still.avif` sebelum folder sekuens dihapus.

### 7. Grow (`#rawat`)

- Sekuens `grow` diganti Lottie "plant5v3" #1509169 dengan renderer SVG, memakai build ringan `lottie-web`.
- **Warna diubah ke palet Sage:**
  - daun hijau limau → hijau Sage (`primary-2` dan turunannya);
  - bunga tetap putih;
  - pot terakota tetap (sesuai teks);
  - tanah coklat tua.
  - Cek di tema terang dan gelap. JSON hasil ubah disimpan di `public/landing/lottie/`.
- **Tahap:** Tunas → Minggu 1 → Minggu 3 → Minggu 5 → Berbunga.
  - Keadaan awal "Tunas" memakai **frame pertama yang sudah memperlihatkan tunas**, bukan frame 0 (pot kosong).
  - Tiap klik memutar satu segmen (`playSegments`).
  - Frame tiap tahap diukur pembangun dari timeline (sekitar 25%, 50%, 75% dan frame berbunga terakhir).
  - **Bagian akhir timeline yang kembali ke pot kosong tidak dipakai.**
- Judul berganti, indikator tetes, tombol Ulangi, `aria-live`, dan keterangan "Ilustrasi pertumbuhan, bukan data sensor." tetap.
- Reduced motion: lompat langsung ke frame tahap (`goToAndStop`).

### 8. Dihapus

- `public/landing/seq/` (lie, rootzone, water, grow)
- `public/landing/video/spin-loop.mp4` dan `spin-poster.webp`
- `frameSequence.ts` dan `useScrubbedSequence` bila tidak dipakai lagi
- `garden.mp4` dan `garden-poster.webp` **tetap**

## Aset dan lisensi

- **Perangkat 3D dan AgroMark:** karya proyek sendiri.
- **Lottie "plant5v3"** oleh Ömer Faruk (https://lottiefiles.com/animations/plant5v3-DlGito0Myl), Lottie Simple License: boleh dipakai gratis termasuk komersial, atribusi dianjurkan.
  - Tetap dikreditkan di `public/landing/CREDITS.md` dan `docs/ACKNOWLEDGMENTS.md`, dengan catatan bahwa warnanya diubah.
  - Cadangan bila ada masalah: "plant5 v1" #1509167 dari seri yang sama.
- **Rive:** tidak dipakai di landing.

## Kinerja

- Media landing turun dari sekitar 11 MB menjadi video kebun + Lottie (±100 KB) + poster perangkat.
- Ukuran chunk Three.js dan Lottie diukur saat build, lalu dilaporkan. Keduanya hanya dimuat di landing.
- Lima poster keadaan: targetkan masing-masing ≤60 KB (WebP dengan alpha).
- Target: putaran mulus di desktop 1440. Di ponsel tidak boleh ada patah yang terasa saat scroll; turunkan DPR atau bayangan bila perlu.

## Aksesibilitas

- Panggung memakai `role="img"` dengan `aria-label` yang mengikuti keadaan, misalnya "Perangkat Smart Agro tertancap di tanah, probe membaca zona akar".
- Label DOM `aria-hidden`. Faktanya sudah ada di teks halaman atau di `aria-label`.
- Isi halaman tidak bergantung pada memutar perangkat.
- Aturan yang sudah ada tetap: satu `role="status"` per halaman, reduced motion tanpa Lenis/curtain/sticky stage, reset reduced motion memakai `transition: none`.

## Tes dan pemeriksaan

- Perbarui `tests/landing-browser.mjs`:
  - Hero: kanvas 3D sudah tergambar (`painted`), bukan lagi `src` video.
  - Product: fase tetap diuji, ditambah kanvas tergambar dan label muncul di fase 1.
  - RootZone dan Numbers: kanvas tergambar.
  - Grow: SVG Lottie ada, teks tahap berganti per klik, judul akhir, dan Ulangi.
  - Reduced motion: tidak ada putar otomatis.
- Satu cek unit yang bermakna untuk logika baru yang murni. Contohnya: daftar frame tahap Grow naik berurutan dan semuanya sebelum bagian "kembali ke pot kosong", atau pemetaan warna Lottie hanya memakai warna palet.
- Pemeriksaan wajib proyek:
  - `npm run lint`, `typecheck`, `test`, `build`, `git diff --check`;
  - tes browser landing dan transisi rute;
  - tangkapan layar 1440/768/390/320, terang dan gelap.
- Hanya Chrome; tes headless memakai SwiftShader.

## Fase pengerjaan

1. Modul perangkat dari spike, poster, dan Hero (termasuk sinyal `smartagro:ready`). Verifikasi.
2. Mode `label` dan `tembus` (Product), `tanah` (RootZone), `angka` (Numbers). Verifikasi.
3. Grow dengan Lottie berwarna Sage. Verifikasi.
4. Hapus aset dan kode lama, tambahkan kredit, perbarui tes dan README. Catat progres di CLAUDE.md dan Obsidian.

## Batasan

- Diuji hanya di Chrome.
- WebGL di ponsel kelas bawah tidak bisa diuji di sini.
- Teks AgroMark dan label tetap 2D (DOM), bukan teks 3D.

## Keputusan saya (bisa dikoreksi)

1. **Rive tidak dipakai di landing.** Hasil pencarian menunjukkan Lottie lebih cocok untuk Grow; Rive disimpan untuk dashboard dan maskot.
2. Numbers memakai perangkat 3D dengan sorotan bagian, bukan ilustrasi baru.
3. Grow memakai pot terakota dari Lottie, dengan nama tahap yang sama seperti sekarang.
4. Video kebun di LeafReveal tetap.
5. Satu renderer WebGL untuk seluruh landing.
6. Versi Three.js dan lottie-web ditulis exact, rilis stabil terbaru yang berumur minimal dua minggu (spike memakai Three.js r170).
7. Lima poster keadaan berlatar transparan, dirender dari adegan kode yang sama. Dipakai sebagai pengganti saat kanvas belum siap, saat tanpa WebGL, saat reduced motion, dan di slot bagian yang tidak aktif.
8. Mode `angka` tetap di penampang tanah.
9. Grow dimulai dari frame tunas pertama, bukan pot kosong.
10. Label Baterai memakai "cadangan 3 hari" dari `solarInput.autonomyDays`, bukan "cadangan malam".

## Diserahkan ke pembangun

- Jalur kamera, durasi, dan easing tiap perpindahan keadaan.
- Posisi label per lebar layar.
- Nilai warna pasti pemetaan Lottie (dalam palet Sage).
- Cara kanvas berpindah antarbagian (slot atau lapisan tetap), asal hanya satu konteks WebGL.
- Pembagian chunk build dan detail helper tes.

## Amandemen 2026-11-14

Atas keputusan pengguna (2026-11-13 22:08): video kebun di LeafReveal juga diganti ilustrasi vektor (pot cabai dan bawang merah), dan bagian "Jelajahi prototipe" diganti "Tanya mesinnya", yaitu pot interaktif yang sarannya langsung dari `evaluate()`. Rinciannya ada di amandemen rencana kerja (Task 6 dan 7).
