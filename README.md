# Smart Agro · Simulator satu pot

Aplikasi React + TypeScript untuk mengeksplorasi keputusan perawatan dari riwayat tiga parameter: indeks kelembapan kapasitif, suhu DS18B20, dan pH tanah + DMS. Acuan utama: `../Makalah_Asisten_Perawatan_Tanaman_Satu_Pot.docx`, Bab V, serta `../simulasi_pot.py`.

## Menjalankan

Node.js ≥22.18 dan npm diperlukan. Jalankan dari direktori `simulasi-web`:

```powershell
$env:TEMP = Join-Path (Get-Location) '.tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
npm ci
npm run dev
```

Buka http://127.0.0.1:5173. `.npmrc` menempatkan cache npm di `../.cache/npm`. Dependensi frontend mengikuti brief: React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Lenis, Lucide, dan shadcn/ui berbasis Radix (Tabs, Select, Dialog, Popover, Sheet). Komponen di `src/components/ui/` memakai token desain aplikasi; slider dan checkbox tetap HTML native. Tidak ada backend atau credential.

## Alur penggunaan

**Simulasi** (`#simulasi`) berisi statistik di kiri, ilustrasi pertumbuhan di tengah, serta waktu/perawatan di kanan pada desktop. Di ponsel, ilustrasi dan kontrol tampil lebih dahulu. **Dashboard** (`#statistik`) berisi grafik tiga parameter, ringkasan sensor, rekomendasi, dan jam sesi. Navigasi tidak mengganti sesi atau menghentikan waktu yang sedang berjalan.

Sidebar membuka lima halaman: **Dashboard** (`#statistik`), **Simulasi** (`#simulasi`), **Bandingkan sesi** (`#bandingkan`), **Status perangkat** (`#perangkat`), dan **Terminal** (`#terminal`). Setiap halaman dapat dibuka langsung, dimuat ulang, atau dikunjungi lewat Back/Forward. Di ponsel, gunakan **Buka navigasi**; pemilihan tujuan menutup menu, sedangkan Escape mengembalikan fokus ke tombol menu. Navigasi memindahkan fokus ke konten halaman. Identitas sesi pada toolbar hanya menampilkan sesi aktif.

Kartu ringkasan dan grafik mengikuti parameter/rentang pilihan. **Kondisi pot saat ini**, rekomendasi, fase tanaman, serta jam sesi selalu menunjukkan sesi terkini; filter statistik tidak memotong riwayat keputusan. Pada ponsel, rekomendasi tampil sesudah ringkasan. Tidak ada pencarian, akun, atau notifikasi tiruan.

### Tampilan dan gerak

Ruang tanam, navigasi, dan toolbar memakai permukaan solid di atas latar abu lembut dengan aksen sage. Radius kartu 22 px dan bayangan tipis membedakan kelompok informasi; tanpa backdrop blur. Tombol **Sensor** menampilkan/menyembunyikan probe pada ilustrasi; nilai sensor tetap tersedia di panel kiri. Framer Motion menggerakkan tanaman, langit, serta transisi halaman 220 ms. Lenis menghaluskan gulir roda mouse dan perpindahan ke atas halaman (650 ms); gulir sentuh tetap native. Link sidebar halaman yang sedang aktif kembali ke atas. Fokus keyboard berpindah ke konten halaman tanpa loncatan gulir.

Log terminal dan dialog bergulir secara native. Saat dialog atau Select terbuka, penguncian Radix juga menghentikan animasi gulir Lenis yang masih berjalan; gulir halaman aktif kembali setelah panel ditutup. `prefers-reduced-motion` meniadakan tween gulir/transform; kontras tinggi mempertegas garis pembatas kartu dan kontrol. Tidak ada font Apple atau aset berlisensi yang diunduh; stack font sistem tetap dipakai. Acuan materi: [Apple Design Resources](https://developer.apple.com/design/resources/) dan [HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials). Kontrol shadcn/Radix mengelola fokus, Escape, navigasi keyboard, dan posisi menu. Pengaturan tanaman serta waktu/sampel berada dalam Sheet; pemilih zona waktu dan aksi sesi memakai Popover. Library animasi dibundel terpisah agar dapat dicache sendiri; konten statistik tetap langsung tersedia saat navigasi panel.

Mode Perjalanan tanam/Eksperimen dan rentang statistik memakai segmented control dengan radio HTML; tombol panah memilih opsi melalui keyboard. Tab terminal tetap memakai Radix. Penanda aktif memakai Framer Motion dengan spring teredam; reduced motion berpindah langsung. Tombol menyusut ringan saat ditekan, lalu kembali halus. Angka sensor tetap menampilkan nilai tercatat tanpa ticker tambahan. Tidak ada dependency baru.

Penyebab waktu dijeda tampil dekat kontrol: jeda pengguna, pemulihan sesi, tab tidak aktif, pergantian zona/sumber, mode manual, perhatian baru, atau batas sesi. Mode manual menyediakan **Gunakan waktu otomatis**. Tab yang kembali aktif dan sesi yang baru dipulihkan tetap menunggu tombol lanjut, sehingga simulasi tidak berjalan tanpa terlihat. Jeda otomatis juga ditulis pada log.

### Perjalanan tanam

1. Buka **Atur tanaman & skenario** untuk memilih cabai atau bawang, lalu tekan **Tanam & mulai**. Waktu langsung berjalan. Pot baru dimulai pada HST 0 dengan timestamp ketika **Tanam & mulai** ditekan. **Pot baru** mempertahankan perjalanan sebelumnya untuk **Bandingkan sesi**. Animasi bibit jatuh dan tunas muncul hanya diputar saat menanam.
2. Pilih **Otomatis** untuk pola lingkungan atau **Acak** untuk variasi dengan seed tersimpan. **Pengaturan waktu & sampel** memuat sumber dan opsi jeda. Playback selalu menghasilkan satu sampel per 30 menit simulasi: Lambat = satu hari dalam 288 detik, Normal = 24 detik, Cepat = 6 detik. **+30 menit** dan **+1 hari** tersedia untuk langkah terkontrol.
3. HST, jam sensor, suasana pagi/siang/sore/malam, dan perkembangan visual mengikuti waktu yang sama. Sesi baru berjalan terus secara bawaan. Opsi **Jeda otomatis saat perlu tindakan** menghentikan langkah saat muncul kondisi perhatian atau pengingat pupuk baru; satu hari tidak selalu dilewati penuh. **Lanjutkan waktu** melewati peringatan yang telah dilihat, sehingga kondisi yang sama tidak langsung menjeda lagi. Peringatan tetap terlihat. Pilihan jeda pada sesi lama tetap dipertahankan.
4. **Siram 150 mL** mencatat tindakan dan memutar animasi penyiram, tetesan, serta riak tanah. Respons sintetis diterapkan sekali pada sampel berikutnya, tanpa mengubah riwayat sebelumnya. Kondisi media yang kurang mendukung memperlambat perkembangan visual dalam model latihan.
5. **Jadwal pupuk pribadi** memakai interval pilihan pengguna; 0 menonaktifkan pengingat. **Catat sudah diberi pupuk** mengatur ulang tanggal pengingat dan menulis log. Tidak ada deteksi kebutuhan/dosis pupuk maupun perubahan pH atau nutrisi yang diasumsikan.
6. **Jurnal terbaru** dapat dibuka untuk melihat kejadian terbaru. Perjalanan berhenti pada 90 HST untuk cabai atau 65 HST untuk bawang. Bentuk akhir mengikuti perkembangan model, bukan jaminan panen nyata. Buka statistik untuk mengevaluasi riwayat atau membandingkan salinan sesi.

Animasi perawatan bersifat sesaat: tidak menambah sampel atau pertumbuhan, tidak tersimpan, dan tidak diputar ulang setelah navigasi atau pemulihan sesi. Reduced motion menyembunyikan efek dekoratif. Satu **Mood tanaman** di sidebar menampilkan maskot 2D dengan ekspresi dari status simulasi; bukan diagnosis kesehatan dan tidak mengulang angka sensor. Analisis AI belum ditambahkan.

### Eksperimen

Buka **Atur tanaman & skenario** untuk memilih satu dari 10 skenario makalah. **Otomatis** dan **Acak** menghasilkan sampel tanpa mengisi slider. **Manual** membuka kontrol kelembapan, suhu, pH, volume, dan gangguan. Slider menyiapkan pembacaan; **Tambah sampel** memajukan jam sensor 30 menit. pH hanya dicatat jika pengukuran baru disertakan; selain itu nilainya `null`. **Catat siram** pada mode manual tidak mengarang respons sensor: masukkan sendiri sampel berikutnya.

HST di **Ilustrasi fase tanaman** tetap terpisah dari jam sensor dalam mode eksperimen. **Acuan lokal** mengubah observasi media dan jadwal kunjungan. Mengganti media memulai sesi baru. Skenario dan impor sebelumnya tetap tersimpan untuk perbandingan. Beralih antara Perjalanan tanam dan Eksperimen membuka sesi terakhir dari mode tersebut.

Halaman **Dashboard** menyediakan pilihan kelembapan, suhu, pH, serta rentang seluruh sesi / 24 jam / 72 jam. Ringkasan menampilkan rata-rata, minimum–maksimum, persentase pengukuran valid, dan durasi teramati. Selain riwayat garis, tersedia histogram, diagram donat mutu data, dan rentang minimum/rata-rata/maksimum per 24 jam (maksimal 7 kelompok berisi data). Semua dihitung dari sampel nyata dalam sesi; sampel gagal dan pH kosong dikecualikan dari statistik numerik. Persentase valid merujuk status sampel, bukan kalibrasi. Halaman **Terminal** memuat log, JSON, jejak aturan, bukti pendukung, dan kontrol waktu. Ketuk titik, gunakan Enter/Spasi, atau pilih sampel untuk membaca waktu, nilai, dan status. Silang menandai gagal; wajik menandai tidak diukur. Garis terputus pada keduanya dan pada jeda lebih dari satu jam. **Bandingkan sesi** menerima dua sesi pilihan pengguna dan salinan sebelum/sesudah tindakan.

Tombol tema menampilkan kondisi aktif: matahari untuk terang, bulan sabit untuk gelap. Pilihan disimpan lokal dan awalnya mengikuti sistem. View Transition native membuka tema baru melalui lingkaran dari pusat tombol (480 ms), disertai pergantian ikon; klik cepat tidak menumpuk transisi. Fokus keyboard dipertahankan. Browser tanpa API tersebut memakai perubahan langsung dan gerak ikon; reduced motion meniadakan animasi tema. Tema antarmuka terpisah dari waktu dunia simulasi. Matahari bergerak dari timur ke barat, disusul bulan dan langit malam; awan melayang pelan. Animasi langit menginterpolasi dua waktu yang telah tercatat, tidak membuat pembacaan tambahan. Preferensi pengurangan gerak menghentikan interpolasi dan animasi dekoratif.

## Penyimpanan dan cadangan

Perubahan disimpan otomatis ke `localStorage` pada perangkat. Status penyimpanan tampil di atas simulator. Refresh memulihkan sesi terakhir beserta riwayat, draf slider, pilihan pH baru, volume, HST, kecepatan, dan log; waktu otomatis dan pemutaran ilustrasi selalu dijeda; tab yang disembunyikan juga dijeda tanpa mengejar waktu saat kembali. Skenario baru, impor, serta salinan tidak menghapus sesi sebelumnya.

Panel **Lanjutkan sesi** dan menu riwayat dihapus. Pemulihan otomatis setelah refresh tetap aktif; sesi lama tersedia di **Bandingkan sesi**. Menu **Berkas** memuat **Impor** dan **Ekspor sesi**. **Ekspor sesi** mencadangkan sesi aktif sebagai JSON versi 2. **Impor** menerima versi 2, ekspor versi 1, dan kontrak kasus Python; keputusan selalu dihitung ulang. Versi 2 memulihkan metadata, draf, dan log lengkap, dengan ID baru agar sesi asal tetap utuh. Batas impor 2 MB / 10.000 sampel. Grafik menampilkan 120 sampel terakhir; log dibatasi 500 entri. Semua sampel sampai batas 10.000 tetap tersimpan dan ikut ekspor.

Simpanan terikat pada alamat situs (origin) dan browser. Data localhost tidak otomatis muncul pada domain hosting; gunakan ekspor/impor. Membersihkan data browser menghapus simpanan lokal. Tidak ada sinkronisasi akun. Saat kuota penuh, simpanan rusak, atau ada perubahan dari tab lain, aplikasi menampilkan kegagalan penyimpanan dan mempertahankan data lama. Ekspor perubahan aktif sebelum memuat ulang ketika konflik tab terjadi.

## Waktu UTC dan kesiapan perangkat

**Zona perangkat** berada pada toolbar sesi aktif. Awalnya mengikuti zona waktu browser/perangkat, termasuk pergantian DST. Pilihan manual tersedia dari UTC−12:00 hingga UTC+14:00, kelipatan 15 menit. Web, langit, grafik, pratinjau perangkat, dan terminal memformat waktu melalui `src/lib/sessionClock.ts`.

Setiap sesi menyimpan `clock.startedAtMs` sebagai timestamp UTC dan `clock.offsetMinutes` (null = otomatis). Waktu sampel = awal sesi + `t_h` jam. UTC dan durasi HST tidak berubah saat zona diganti; langit dan lingkungan sintetis selanjutnya mengikuti jam lokal pilihan. Tampilan tanggal menangani pergantian hari. Sesi skenario memakai acuan sehingga sampel terakhir bertepatan dengan waktu pembukaan; waktu sebelumnya tetap ilustratif. Sesi lama tanpa metadata waktu diberi acuan dari waktu simpan terakhir dikurangi durasi, bukan rekonstruksi timestamp historis perangkat.

Halaman **Status perangkat** membuka validator/pratinjau JSON. Tersedia contoh berlabel `example`. Nilai tiap sensor wajib memiliki status; gagal atau tidak diukur disimpan sebagai null. Umpan balik aktuator dan aliran dibedakan dari perintah. Paket tua, waktu perangkat di masa depan, error sensor, dan fault tetesan menghasilkan status yang dapat ditelusuri di terminal. Paket maksimum 64 KB. Impor gagal mempertahankan paket sebelumnya; paket terakhir ikut autosave dan ekspor sesi.

Belum ada koneksi langsung, server ingest, firmware, atau kendali tetesan. Pratinjau paket tidak masuk ke statistik/keputusan simulasi. Kontrak dan kebutuhan integrasi berikutnya: [`docs/telemetry-v1.md`](docs/telemetry-v1.md). Sensor kapasitif menyatakan indeks kelembapan, bukan kapasitas air yang dapat dihitung dari angka saja.

**Acuan fase per HST** di bawah ilustrasi menampilkan rentang bawaan dan fase model saat ini. Saat melewati batas HST, terminal mencatat pergantian acuan. Rentang ini bukan deteksi bunga/buah dan belum mendekati tanaman nyata secara tervalidasi. Kesesuaian 1:1 memerlukan varietas, tanggal tanam, catatan fase lapangan, dan kalibrasi model.

## Model dan batas

- `src/lib/agronomyEngine.ts` mengikuti urutan 10 aturan dan validasi Python, termasuk median acuan, mutu data, evaluasi siram, basah menetap, tiga bacaan kering, suhu, pH berulang, serta regresi linear lokal.
- Prediksi memerlukan ≥6 sampel valid, durasi ≥2,5 jam, jeda ≤1 jam, kemiringan <−1 poin/jam, R² ≥0,8, dan horizon ≤12 jam. Riwayat prediksi dibatasi enam jam dan setelah penyiraman terakhir.
- Skenario JSON berasal dari `simulasi_pot.cases()`. Nilai `expected` hanya metadata pengujian; mesin tidak memakainya untuk mengambil keputusan.
- Pada eksperimen, HST ilustrasi terpisah dari jam sampel. Pada perjalanan, HST = jam berlalu / 24 (dibulatkan ke bawah); perkembangan gambar dapat tertinggal saat media kurang mendukung. Fase gambar tidak mengubah profil acuan mesin keputusan.
- `src/lib/simulation.ts` adalah model latihan tambahan: pengeringan bergantung siklus cahaya, suhu mengikuti kurva harian, pH baru dibuat saat pergantian hari, dan seed membuat variasi acak dapat diulang. Respons siram memakai koefisien sintetis (volume/8 poin pada sampel berikutnya). Perkembangan bertambah 0,5 jam pada kondisi mendukung dan 0,1 jam pada kondisi lain. Angka ini belum dikalibrasi atau divalidasi secara agronomi.
- Tidak ada RS485/Modbus, EC, TDS, NPK, penentuan dosis pupuk/dolomit, diagnosis penyakit, prediksi pertumbuhan, atau klaim penghematan. Perangkat tidak terhubung. Penampilan tanaman tidak menunjukkan kesehatan dari sensor.
- Indeks 0–100 bukan kadar air volumetrik. Acuan angka bawaan merupakan demonstrasi, belum validasi agronomi. Antarmuka DMS aktual harus dikonfirmasi sebelum firmware atau pengkabelan dibuat.
- Font sistem dipakai tanpa unduhan Google Fonts. Lenis 1.3.26 ditambahkan untuk gulir halus; Tabs tetap memakai Radix. Navigasi sidebar dan kartu dashboard mengikuti referensi pengguna dengan tema botani; tidak ada pemasangan penuh shadcn/ui.

## Hosting statis

Aplikasi tidak memerlukan backend, database, API key, atau environment variable. Gunakan Node.js 24 LTS (minimum 22.18) untuk build:

```powershell
npm ci
npm run build
npm run preview
```

Build menghasilkan `dist/`. Unggah **isi** folder tersebut (`index.html`, `assets/`, `favicon.svg`, `telemetry-example.json`) ke direktori situs, lalu akses lewat HTTP/HTTPS. Jangan membuka `index.html` melalui `file://`. `base: './'` membuat aset bekerja di root domain maupun subfolder seperti `/simulator/` dengan URL berakhiran `/`.

Pilihan hosting:

| Platform | Pengaturan |
| --- | --- |
| Vercel | Root Directory: `simulasi-web` jika seluruh workspace diunggah sebagai repo, atau `.` jika repo hanya berisi aplikasi. Framework: Vite; install: `npm ci`; build: `npm run build`; output: `dist`. `vercel.json` sudah tersedia. |
| Netlify / Cloudflare Pages | Base/root: `.` untuk repo Smart-Argo ini; gunakan `simulasi-web` hanya jika folder induk ikut menjadi root repo; build: `npm run build`; publish/output relatif ke root aplikasi: `dist`; Node 24. |
| cPanel / hosting statis | Ekstrak isi paket build ke `public_html/` atau subfolder tujuan. |

Tidak perlu rewrite SPA karena kelima halaman memakai navigasi hash. Situs publik sebaiknya memakai HTTPS. Repo aplikasi: [Maliq-dlt/Smart-Argo](https://github.com/Maliq-dlt/Smart-Argo). Integrasi Cloudflare membangun perubahan yang didorong ke GitHub; status deploy diperiksa terpisah dari hasil build lokal.

## Verifikasi

Python ≥3.10 diperlukan untuk pemeriksaan kesetaraan; `PYTHON` bisa menunjuk executable tertentu.

```powershell
npm test
npm run lint
npm run typecheck
npm run build
python ../simulasi_pot.py --self-test
```

`npm test` memakai runner bawaan Node, tanpa framework tes tambahan. Pemeriksaan mencakup 10 skenario, kesetaraan hasil dan bukti dengan Python pada 110 kasus, validasi JSON, kegagalan data, pH, kontinuitas riwayat, batas prediksi, dan pencatatan tindakan. Tes sesi mencakup pemulihan, ekspor/impor, pergantian sesi, validasi metadata, kuota, konflik tab, dan segmentasi grafik.

Tampilan mempertahankan referensi pengguna: sidebar, toolbar sesi, kartu ringkasan, grid grafik/perawatan, dan studio tanaman. Palet netral/sage, kontrol shadcn/Radix, serta ilustrasi SVG dipertahankan. Panduan visual lokal ada di `design.md`. Belum ada pengujian perangkat atau tanaman nyata. Dokumen dan program Python asli tidak diedit.

Paket versi 1.7: `.tmp/release/smart-agro-v1.7.0.zip`. ZIP hanya memuat isi `dist/`; ekstrak langsung di direktori hosting tujuan. Situs belum dipublikasikan saat verifikasi versi 1.7.

Verifikasi versi 1.3: `npm test` lulus 28/28, termasuk kesetaraan 110 kasus Python, perjalanan 90 HST, statistik valid/kosong/gagal, batas histogram, serta orbit siang–malam. Lint, type-check, dan build lulus. Chrome menguji 48 kombinasi mode/tema/viewport (320/375/414/768/1024/1440 px), autoplay/jeda, interpolasi langit, malam, tindakan, 10 keputusan makalah, sumber sampel, grafik, keyboard, perbandingan, ekspor/impor, dan pemulihan. Hasil ada di `.tmp/apple-browser-report.json`. Build statis lulus di `/` dan `/simulator/` beserta aset dan favicon HTTP 200; hasil ada di `.tmp/hosting-smoke-report.json`. Browser uji: Chrome lokal; belum perangkat fisik atau Safari/Firefox.


Verifikasi versi 1.4: 34/34 tes Node lulus; lint, type-check, dan build lulus. Chrome memeriksa kesamaan jam web/langit/grafik/terminal, offset sistem dan manual, pergantian hari/DST, masukan manual, migrasi sesi lama, paket sensor error/fault tetesan, penolakan paket invalid tanpa kehilangan pratinjau, dan ekspor/impor. Dua halaman × dua tema × enam lebar (320/375/414/768/1024/1440 px) lulus dengan panel waktu/perangkat/terminal terbuka. Build dan contoh paket diuji di root serta `/simulator/`. Hasil: `.tmp/clock-device-browser-report.json`, `.tmp/hosting-smoke-report.json`, dan `.tmp/clock-device-diff-report.json`. Pengujian belum memakai perangkat IoT, tanaman nyata, atau Safari/Firefox.

Verifikasi versi 1.5: 34/34 tes lulus, termasuk kesetaraan 110 kasus Python; lint, type-check, dan build lulus. Uji Chrome build produksi mencakup 24 kombinasi halaman/tema/lebar, navigasi sidebar serta fokus keyboard, menu ponsel/Escape, pemilihan dan penamaan sesi, perbandingan, playback, sinkronisasi jam, impor paket, sembilan kombinasi parameter/rentang, histogram, pemilihan titik, penanda gagal/kosong, pemulihan, dan ekspor/impor. Hosting root/subfolder serta aset HTTP 200 lulus; enam pasangan kontras teks per tema memenuhi 4,5:1. Laporan: `.tmp/dashboard-browser-report.json`, `.tmp/dashboard-hosting-report.json`, `.tmp/dashboard-diff-report.json`, dan `.tmp/dashboard-scope-review.md`. Skrip pemeriksaan browser: `.tmp/dashboard-browser.cjs` dan `.tmp/dashboard-hosting.cjs`, memakai Playwright dari runtime Codex lokal. Tidak ada dependency tambahan atau perubahan mesin agronomi. Situs belum dipublikasikan; Safari/Firefox dan perangkat fisik belum diuji.

Verifikasi versi 1.6: 36/36 tes lulus, termasuk dua regresi waktu kontinu/jeda sekali serta kesetaraan 110 kasus Python. `npm run lint`, `npm run typecheck` (juga dijalankan oleh build), dan `npm run build` lulus. Chrome build produksi memeriksa 24 kombinasi ukuran/tema/halaman, playback lebih dari 30 jam, jeda/resume, pengingat pupuk, perpindahan sidebar cepat, gulir Lenis, fokus keyboard, gulir terminal/dialog, mode manual/otomatis, overlay sensor, pemulihan, dan reduced motion. Hosting root/subfolder serta 12 pasangan kontras teks utama per mount lulus. Laporan: `.tmp/studio-browser-report.json`, `.tmp/studio-hosting-report.json`, `.tmp/studio-diff-report.json`, `.tmp/studio-scope-review.md`. Kontras bukan audit aksesibilitas lengkap. Safari/Firefox dan perangkat fisik belum diuji; situs belum dipublikasikan.


## Catatan historis versi 1.7

Bagian ini mencatat perilaku saat rilis 1.7; alur terkini mengikuti bagian penggunaan di atas.

Daftar **Lanjutkan sesi** memakai kartu ringkas; tombol pensil membuka form nama. **Lanjutkan** menjalankan waktu otomatis dari data tersimpan, termasuk sesi aktif yang dijeda. Sesi manual, bibit belum ditanam, dan sesi selesai memakai **Buka sesi** sesuai statusnya. Refresh tetap memulihkan sesi dalam keadaan dijeda.

Timer sensor terpisah dari pembaruan ilustrasi dan form. Sebelumnya timelapse yang lebih cepat daripada interval sensor membatalkan timeout berulang kali, sehingga waktu tidak maju. Interval tetap memakai sesi terbaru; perubahan yang lebih baru tidak ditimpa oleh tick tertunda.

HST tampil di bagian atas ilustrasi; label Timur–Barat dihapus. Disclosure mengubah tinggi isi tanpa memudarkan seluruh panel. Dropdown memakai native customizable select: daftar membulat, penanda pilihan, keyboard/typeahead bawaan, dan gulir lokal. Browser yang belum mendukung `appearance: base-select` memakai picker sistem; browser tanpa `interpolate-size` membuka disclosure langsung. Preferensi reduced motion tetap dihormati. Framer Motion dan Lenis yang sudah ada dipertahankan; tidak ada dependency baru.

Regresi timer di browser bisa dijalankan memakai Playwright yang sudah tersedia serta Chrome lokal, tanpa instalasi paket atau browser otomatis:

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/installed/node_modules/playwright'
$env:TEST_URL = 'http://127.0.0.1:4173/'
$env:TEMP = Join-Path (Get-Location) '.tmp'
$env:TMP = $env:TEMP
node tests/playback-browser.js
```


Verifikasi versi 1.7: 36/36 tes Node lulus (termasuk 110 kasus kesetaraan Python), self-test Python lulus, lint dan type-check/build lulus. Regresi browser baru memeriksa lima kombinasi laju sensor/ilustrasi, pause/resume, rename, siram, riwayat tetap utuh, dan refresh. Chrome memeriksa 36 kombinasi tampilan/tema/lebar untuk kartu sesi, pemilih native, disclosure, serta reduced motion, ditambah 24 kombinasi regresi navigasi, Lenis, jurnal, dan jam kontinu. Tidak ada error browser. Root/subfolder dan aset HTTP 200 lulus. Laporan: `.tmp/refinement-ui-report.json`, `.tmp/refinement-legacy-browser-report.json`, `.tmp/refinement-legacy-hosting-report.json`, `.tmp/refinement-diff-report.json`, `.tmp/refinement-scope-review.md`. Safari/Firefox dan perangkat fisik belum diuji. Situs belum dipublikasikan saat verifikasi versi 1.7.

## Verifikasi antarmuka

`npm test` memeriksa model, sesi, statistik, dan kontrak perangkat; `npm run lint`, `npm run typecheck`, dan `npm run build` memeriksa source/build.

Dengan Chrome dan Playwright yang tersedia di lingkungan pengembangan, jalankan preview hasil build lalu `node tests/ui-browser.js`. Jika Playwright berada di lokasi lain, isi `PLAYWRIGHT_MODULE` dengan path modul tersebut. `TEST_URL` dapat mengganti alamat bawaan `http://127.0.0.1:4173/`.

Pemeriksaan browser mencakup lingkaran tema, ikon, klik cepat, reduced motion/fallback, jam tetap maju antarhalaman, penyimpanan, impor/ekspor, fokus, Select di dalam Sheet, gulir modal, lima halaman beserta refresh/Back/Forward, animasi tanam/siram tanpa mutasi sensor tambahan, maskot, perbandingan sesi, pratinjau perangkat, grafik, serta lebar 320/375/414/768 px. Tangkapan layar tersimpan di `.tmp/ui-check/` dan tidak diunggah.

Verifikasi versi 1.9: 36/36 tes Node lulus, termasuk 110 kasus kesetaraan Python. Lint, type-check, build produksi, dan regresi Chrome `tests/ui-browser.js` lulus. Tinjauan visual mencakup halaman terpisah, mode gelap, maskot, efek tanam/siram, serta lebar 320/375/414/768 px. Belum diuji pada Safari/Firefox atau perangkat fisik. Tidak ada dependency baru.

Verifikasi versi 1.10: 36/36 tes Node lulus (termasuk 110 kasus kesetaraan Python), lint, type-check, build produksi, dan regresi Chrome lulus. Regresi mencakup keyboard segmented control/tab, filter tanpa perubahan data sesi, efek tekan tombol, reduced motion, dan tautan jurnal ke Terminal. Tinjauan visual mencakup simulasi/statistik/terminal pada 320/375/414/768/1440 px dan tema gelap. Kontras teks kontrol yang berubah: 4,53:1, 6,44:1, dan 7,39:1. Safari/Firefox serta perangkat fisik belum diuji.
