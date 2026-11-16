# Smart Agro Android

Aplikasi Android native Kotlin + Jetpack Compose, terpisah dari website React. Source, konfigurasi, APK dan cache aplikasi berada di `android/`; laporan HTML pengujian berada di `.tmp/android-reports/` pada root repository agar tidak dipindai lint web. Tidak ada WebView, perubahan backend, atau perubahan source website.

## Alur aplikasi

Buka aplikasi -> login email atau Google -> verifikasi autentikator bila akun memakai 2FA -> Produk saya -> pilih persona -> Tanaman / Aktivitas / Akun.

Akun yang sudah tersimpan dipulihkan lalu dibawa ke Produk saya. Daftar produk mengikuti kepemilikan di server. Produk kosong dan unit yang belum disiapkan mempunyai petunjuk tindakan; tidak dibuatkan perangkat palsu.

Tombol **Coba mode latihan** memakai 10 skenario sintetis dari `src/lib/scenarios.json` dan hasil `evaluate()` pada engine web. Latihan tidak masuk ke akun, tidak mengirim data, dan selalu diberi label. Ini snapshot latihan, bukan seluruh simulator interaktif web.

## Yang sudah diadaptasi

- Palet Sage dan lumut, font General Sans / Fraunces dari aset web, mode terang/gelap mengikuti sistem pada awal penggunaan; pilihan manual disimpan di HP.
- Maskot Canvas native mengikuti panjang email, menutup mata dengan tangan daun saat kata sandi/kode diisi, dan menunduk saat gagal.
- Ilustrasi pot, akar, daun cabai/bawang menggunakan koordinat dan kurva dari `PlantIllustration.tsx`; sakelar zona akar memakai tween tanpa pantulan. Ripple lingkaran tombol dinonaktifkan; fokus dan semantik aksesibilitas tetap ada.
- Login email/kata sandi atau Google melalui Credential Manager, lalu autentikator TOTP melalui Supabase Auth yang sama dengan web.
- Sesi dienkripsi AES-GCM memakai kunci Android Keystore, tidak ikut backup; token diperbarui saat diperlukan. Password dan OTP tidak disimpan.
- Produk milik akun dan daftar persona ringkas memakai LazyColumn; pencarian nama, jenis, kode atau serial, serta filter produk. Kelembapan/suhu/pH mempertahankan status galat/kosong/usang dan waktu pengukuran.
- Grafik dengan rentang nilai adaptif, inspeksi sentuh, filter 24 jam/7 hari, dan pemuatan 120 bacaan sebelumnya per halaman. Data hilang, galat, jam tak sinkron dan jeda lebih dari satu jam memutus garis. Filter hanya memakai halaman yang sudah dimuat.
- 2D interaktif memakai Compose Canvas tanpa dependency baru: sentuh daun untuk gerak berurutan yang selesai sendiri, sapa maskot untuk respons tangan/tunas, serta geser jari pada maskot untuk mengubah arah pandang. Tajuk cabai/bawang berganti di atas pot yang tetap; bukaan akar mengikuti kontrol zona akar. Pose daun dan ekspresi memakai bacaan kelembapan valid yang sama; bukan diagnosis atau pengukuran bentuk tanaman. Mengikuti skala animasi sistem, tanpa loop gerak otomatis.
- Navigasi umum Tanaman / Aktivitas / Akun, tanpa tab wajib Pot/Kebun. Sensor membuka grafik di dalam kartu dengan perubahan tinggi singkat tanpa modal atau layar meredup.
- Nama persona dapat diganti lewat `rename_my_unit`, sama dengan website. Kode `T-…` berasal dari suffix ID unit dan diperpanjang bila berbenturan dalam daftar; mengganti nama tidak mengganti ID. Kode adalah label tampilan aplikasi, bukan serial produk atau kode aktivasi baru. Deretan pemilih di dasbor menampilkan kode dan nama untuk berpindah persona dalam satu akun tanpa kembali ke daftar.
- Maskot mencerminkan indeks kelembapan dengan penjagaan data usang/galat; bukan diagnosis tanaman. Aktivitas menurunkan kejadian kenaikan kelembapan dari bacaan berurutan yang valid dan jam sinkron; jeda lebih dari satu jam memutus rangkaian. Ambang contoh 5 poin belum dikalibrasi, sumber air tidak dapat dipastikan.
- Akun menampilkan nama dari metadata, jumlah produk/persona, dan saldo poin terkonfirmasi/direservasi/tersedia dari `reward_workspace`. Saldo yang gagal dimuat tidak diganti angka nol atau saldo latihan. Nama profil, katalog, konfirmasi reservasi, pembatalan, ledger poin, dan status bukti blockchain kepemilikan tersedia di layar native. Keamanan, pemulihan, dan transfer tetap ditautkan ke website.
- Reservasi memakai identitas permintaan per akun/item yang disimpan di no-backup storage sampai server mengakui hasilnya, agar kiriman ulang setelah koneksi putus memakai permintaan yang sama. Salinan identitas memulihkan ID yang sama bila berkas utama rusak. Jika keduanya rusak, pengiriman diblokir; setelah pengguna memeriksa penukaran di website, tindakan pemulihan eksplisit mengarsipkan berkas rusak dan menjelaskan bahwa aksi berikutnya adalah reservasi baru. Daftar server yang dibaca terbatas 100 penukaran, sehingga pemeriksaan ini bukan jaminan tidak pernah ada permintaan lama. Kode TOTP hanya berada di memori. Backend tetap memutus stok, saldo, 2FA, security hold, dan batas harian; aplikasi tidak mengubah saldo secara optimistis.
- Bukti kepemilikan dibaca dari `my_chain_proofs`; pending/sent/failed/mismatch tidak ditampilkan sebagai confirmed. Explorer hanya dibuka untuk hash transaksi valid pada jaringan yang dikenal. Status berasal dari layanan, bukan verifikasi jaringan independen di HP.
- Pot dan kebun akun dibaca dari `my_garden`: lokasi, zona, tanggal tanam, kode integer serta label CB/BM/AB/PN sama dengan web. Siklus tanaman dibedakan dari unit sensor; bacaan hanya tersedia bila zona benar-benar terhubung ke unit milik akun. Pengelolaan kebun tetap melalui website.
- Transisi layar singkat, tarik-untuk-segarkan, kontrol Segarkan di header, dan umpan balik tekan pada kartu. Navigasi tetap tersedia saat memuat; operasi jaringan diserialkan dan perubahan nama terikat pada tanaman asal.
- Tombol kembali Android dan keluar dari sesi aplikasi saja.
- Preview Compose untuk login normal dan teks besar; layout scroll untuk layar kecil/keyboard.

Pendaftaran, pemulihan akun, aktivasi/QR, transfer, pengaturan unit, fitur operator, jurnal manual, bukti energi, dan pencatatan berkas lewat wallet tetap menggunakan website pada versi awal ini. Saldo poin sudah dapat dibaca di aplikasi; poin program tidak diasumsikan sebagai token atau koin kripto. Cuaca memakai Open-Meteo berdasarkan kota yang dipilih per produk di HP; tidak memakai GPS dan tidak mengirim pilihan kota ke backend akun. Kartu menampilkan waktu prakiraan, suhu/kelembapan udara, angin, dan radiasi matahari W/m². Siang/malam dan awan mengubah ilustrasi secara halus. Radiasi adalah prakiraan wilayah, bukan lux sensor pot. Kontrak backend perangkat hanya memiliki kelembapan, suhu tanah, dan pH; aplikasi tidak mengarang bacaan sensor cahaya. Tautan terkait membuka browser; sesi browser dan aplikasi terpisah. Menutup aplikasi pertama kali tidak meminta izin kamera, lokasi, notifikasi, atau Bluetooth.

Animasi web ditulis ulang dengan Canvas dan Compose; GSAP/Framer Motion tidak berjalan di Android. Ini adaptasi native dari interaksi utama, bukan salinan seluruh animasi landing, Three.js, atau simulator. Kecepatan animasi Compose mengikuti skala animasi sistem Android.

## Membuka nanti dengan Android Studio

1. Pilih **Open**, buka folder `android/` ini, bukan root website.
2. Pakai Android Studio dengan dukungan AGP 9.0.1; biarkan Gradle Sync selesai.
3. Siapkan SDK Android 36 dan Build Tools 36.1.0. Minimum HP adalah Android 8.0 / API 26.
4. Di `android/local.properties`, isi SDK lokal dan **hanya** URL serta publishable/anon key backend:

```properties
sdk.dir=C\:/Users/NAMA/AppData/Local/Android/Sdk
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_ANON_KEY=PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

`local.properties` diabaikan Git. Jangan masukkan service-role key, `sb_secret_`, password database, atau key AI. URL backend wajib HTTPS. Pada mesin awal, konfigurasi lokal hanya menyalin dua pengaturan publik dari `.env.cloud`; nilainya tidak dicatat dalam source. APK memakai endpoint saat build; mengganti file memerlukan build ulang.

Untuk login Google, tambahkan `GOOGLE_WEB_CLIENT_ID` di `local.properties` dengan OAuth client ID bertipe Web dari proyek Google yang sama dengan Supabase. APK tidak memakai client secret. Daftarkan OAuth client bertipe Android untuk package `id.smartagro.app` dengan SHA-1 sertifikat debug/rilis yang sesuai; Play App Signing memakai sertifikat distribusi Play tersendiri. Credential Manager memerlukan Google Play Services yang mendukung. Nonce acak per percobaan di-hash untuk Google lalu dikirim ke Supabase dalam bentuk asal. Konfigurasi Console dan login Google sungguhan harus diuji di HP; tes HTTP lokal hanya memeriksa kontrak token/nonce dan MFA.

5. Sambungkan HP melalui USB debugging, atau pilih emulator, lalu tekan **Run**. Akun email dan 2FA menggunakan akun web yang sama. Untuk mencoba tanpa akun, pilih mode latihan.

## Uji di emulator dengan backend lokal

Build debug boleh memakai HTTP ke `10.0.2.2` saja (alamat laptop dilihat dari emulator); build rilis tetap hanya HTTPS. Dengan `npm run backend:local` hidup:

```powershell
$anon = ((Get-Content .env.local | Where-Object { $_ -like 'VITE_SUPABASE_ANON_KEY=*' }) -split '=',2)[1]
cd android; ./gradlew.bat assembleDebug "-PSUPABASE_URL=http://10.0.2.2:54321" "-PSUPABASE_ANON_KEY=$anon"
```

Nilai `-P` menimpa `local.properties` hanya untuk build itu. AVD `sa-api30` dan `sa-api35` (Pixel 6, system image `google_apis` x86_64) dibuat 2026-11-16; di Git Bash pakai `MSYS_NO_PATHCONV=1` untuk perintah `adb` yang memakai path `/sdcard`.

## Build tanpa Android Studio

Perlu JDK 17+ dan Android SDK yang sudah tersedia. Wrapper menggunakan Gradle 9.3.0 dan checksum distribusi resmi. Pada Windows/PowerShell:

```powershell
$env:JAVA_HOME = 'C:\path\to\jdk'
.\build.ps1
```

Script menaruh Gradle, Android user files, cache, dan temporary files di dalam folder aplikasi. Untuk terminal lain, set `GRADLE_USER_HOME=android/.cache/gradle`, `ANDROID_USER_HOME=android/.cache/android`, serta temporary directory ke `android/.tmp` sebelum menjalankan wrapper. Folder SDK yang sudah ada tetap dibaca dari `local.properties`.

Command individual:

```powershell
.\build.ps1 -Tasks testDebugUnitTest
.\build.ps1 -Tasks lintDebug
.\build.ps1 -Tasks assembleDebug
```

APK debug: `app/build/outputs/apk/debug/app-debug.apk`. Kunci debug standar dibuat otomatis di `.cache/debug.keystore` dan diabaikan Git. APK ini untuk uji lokal; gunakan alur release di bawah untuk artefak bertanda tangan terpisah. Laporan unit test HTML: `../.tmp/android-reports/testDebugUnitTest/index.html` (di root repository supaya tidak ikut lint website); hasil XML tetap di `app/build/test-results/testDebugUnitTest/`; lint: `app/build/reports/lint-results-debug.html`.

## Sumber dan verifikasi

| Android | Referensi web (dibaca saja) |
| --- | --- |
| `Theme.kt` + font | `src/styles.css`, `public/fonts/` |
| `Illustrations.kt` | `src/components/Mascot.tsx`, `PlantIllustration.tsx` |
| `AgroApi.kt`, `Models.kt` | `src/lib/productAccountClient.ts`, `deviceTelemetryClient.ts` |
| `MainActivity.kt` | `AccountGate.tsx`, `AccountSignIn.tsx`, `ProductUnits.tsx`, `ProductTelemetry.tsx` |
| `assets/demo-scenarios.json` | Skenario dan hasil aturan dari engine web |

Regenerasi snapshot latihan dari root repository (Node 22.18+):

```powershell
node --experimental-strip-types android/tools/generate-demo.mjs
```

Tes UI Robolectric menjalankan alur login/latihan, produk, sakelar akar, riwayat, akun dan kembali, serta menyimpan screenshot di `.tmp/screenshots/`. Ini simulasi Android API 34 di JVM, bukan emulator/HP fisik. API 34 dipilih karena Robolectric 4.16.1 native pada API 35 salah membaca path Windows yang mengandung spasi sebagai `%20`; target APK tetap API 36.

Tes domain memeriksa data kosong dan rentang sensor, status usang, pemutusan grafik, respons kepemilikan, konfigurasi HTTPS, penolakan kunci admin dan pesan auth. Build/lint tidak membuktikan animasi di HP, koneksi perangkat fisik, kalibrasi, atau notifikasi background. Hasil uji yang benar-benar dijalankan dicatat pada laporan akhir pekerjaan.

Lisensi font salinan dari web tersedia di `licenses/`. Generator font hanya dipakai saat konversi aset; bukan dependency runtime atau build aplikasi.

Verifikasi awal (15 November 2026): 8 tes Android lulus, lint 0 error (peringatan versi dependency tersedia), APK debug berhasil dibuat dan tanda tangan v2 diverifikasi. Login akun nyata, Android Keystore di HP, performa animasi pada perangkat, serta sensor fisik belum diuji. Lint/typecheck/130 tes web dan build web juga lulus pada snapshot sebelum perubahan web paralel; perubahan web yang muncul selama pekerjaan ini dibiarkan utuh.

Verifikasi revisi UX (15 November 2026): `build.ps1` menjalankan 10 tes Android (domain dan alur UI Robolectric), `lintDebug`, dan `assembleDebug` dengan sukses. Pencarian, nama persona, detail sensor dalam kartu, akun dan navigasi sudah diperiksa pada Android simulasi API 34; APK debug ditandatangani dan diverifikasi. Integrasi login/rename/saldo dengan akun nyata dan kelancaran HP fisik belum diuji. Preview HTML terpisah lulus 127 pemeriksaan browser, syntax check, dan ESLint.

Verifikasi 2D interaktif (15 November 2026): `build.ps1` berhasil menjalankan 11 tes, `lintDebug` (0 error, 7 peringatan versi dependency), dan `assembleDebug`; tanda tangan APK v2 diverifikasi. Tes piksel Robolectric memeriksa daun bergerak, pot diam saat disentuh/pergantian spesies, dan gerak kembali berhenti. Preview lulus 142 pemeriksaan browser, syntax check, dan ESLint, termasuk ketukan cepat, nama/kode pemilih, sapaan/arah pandang maskot, dan reduced motion. Belum diuji di HP fisik atau dengan akun/sensor nyata.

## Verifikasi integrasi native

```powershell
$env:JAVA_HOME = 'C:/Users/malik/.jdks/temurin-25.0.3'
./android/build.ps1
node android/tools/check-services.mjs
```

Jalankan dari root repository. `check-services.mjs` memeriksa Auth, penolakan akses RPC tanpa login, pencarian kota dan prakiraan publik secara read-only; hasil tanpa token disimpan di `.tmp/services/report.json`. Jika tidak ada akun uji, alur akun dilaporkan **skipped**, bukan lulus. Untuk membaca akun uji, sediakan `SMART_AGRO_TEST_TOKEN` pada environment terminal (tidak disimpan), atau `SMART_AGRO_TEST_EMAIL` dan `SMART_AGRO_TEST_PASSWORD` untuk sesi uji sementara yang ditutup setelahnya. Script tidak mengganti nama, membuat reservasi, atau mengirim data perangkat.

Tes `AgroApiTest` menggunakan HTTP sungguhan ke server kontrak terisolasi di loopback dan kunci AES sementara. Tes ini memeriksa request login, MFA, pembaruan nama, pembacaan telemetri, pembaruan sesi, dan identitas reservasi saat server gagal/step-up. Ini bukan bukti login cloud, kinerja HP, atau kalibrasi perangkat fisik. Kunci Android Keystore produksi tidak diganti oleh kunci tes dalam APK.

Pada host Windows, tes kontrak memakai shadow kecil untuk operasi rename yang menimpa target agar sesuai perilaku Android; protokol `AtomicFile`, enkripsi AES-GCM, dan format sesi tetap dijalankan. Ini mengatasi perbedaan `File.renameTo` Windows yang terbukti meninggalkan berkas lama, bukan mengganti penyimpanan produksi.

Verifikasi penyelesaian fitur native (15 November 2026): `android/build.ps1` berhasil menjalankan 19 tes (12 domain, 4 kontrak HTTP, 3 UI Robolectric), lint 0 error/8 warning (7 pembaruan versi dan 1 saran KTX), dan build APK debug. `check-services.mjs` lulus 7 pemeriksaan live read-only; alur akun dilewati karena akun uji tidak diberikan. Syntax check dan ESLint script lulus. HP, Android Keystore fisik, akun nyata, perangkat sensor, dan transaksi reward cloud belum diuji. Bukti screenshot fitur baru berasal dari fixture tes UI terisolasi.


## Keamanan aplikasi dan build release

`FLAG_SECURE` (dan thumbnail Recents pada API 33+) hanya aktif di layar yang meminta atau menampilkan kode: langkah autentikator dan Reward. Layar lain boleh ditangkap layar agar pemilik bisa membagikannya untuk review (sejak 2026-11-16; sebelumnya seluruh window). Sesuai pilihan pengguna pada 16 November 2026, aplikasi tidak meminta kunci aplikasi tambahan atau konfirmasi PIN/pola/sandi HP. Berpindah ke browser lalu kembali tidak mengunci akun lagi. Login dan MFA server tetap berlaku; sesi dienkripsi melalui Android Keystore di no-backup storage. Perlindungan window dan enkripsi tidak menjamin keamanan sistem yang sudah disusupi.

Dari root repository:

```powershell
$env:JAVA_HOME = 'C:/path/to/jdk'
./android/prepare-release.ps1
./android/build.ps1 -Tasks @('testDebugUnitTest','lintDebug','assembleRelease','lintRelease')
```

`prepare-release.ps1` membuat key RSA 3072-bit dan password acak lokal di `android/.private/` tanpa mencetak password atau menimpa pasangan yang sudah ada. Folder ini diabaikan Git. **Simpan backup terenkripsi kedua file** (`release.p12` dan `release.properties`) di tempat aman sebelum membagikan APK. File properties memuat password; jangan dikirim bersama source atau APK. Kunci ini merupakan kunci release lokal; proses Google Play App Signing, upload key, pemulihan, dan publikasi belum dilakukan.

Release mengaktifkan R8, resource shrinking, serta `debuggable=false`. Build release berhenti jika signing tidak lengkap; tidak beralih ke debug signing atau APK unsigned. APK: `android/app/build/outputs/apk/release/app-release.apk`. Debug dan release memiliki sertifikat berbeda sehingga pemasangan release di atas debug dengan package sama memerlukan uninstall debug (data lokal hilang); jangan uninstall aplikasi berisi data penting tanpa backup yang sesuai. Mapping R8 tersedia di `android/app/build/outputs/mapping/release/mapping.txt`; simpan bersama versi APK untuk membaca laporan crash.

Uji isolasi akun dan reward pada backend lokal, setelah `node scripts/phase1-local.mjs` siap:

```powershell
node --test --test-concurrency=1 tests/unit-lifecycle.integration.mjs tests/unit-overview.integration.mjs tests/reward.integration.mjs
```

Tes menggunakan akun Auth sungguhan di lingkungan lokal dan fixture produk/energi sintetis. Tidak membuat akun, mengubah saldo, atau mengirim transaksi reward di cloud. Kode website/backend dibaca dan test yang sudah tersedia dijalankan tanpa perubahan source.


Verifikasi hardening (15 November 2026): `android/build.ps1 -Tasks @('testDebugUnitTest','lintDebug','assembleDebug','assembleRelease','lintRelease')` berhasil, 22 tes Android lulus, lint debug/release masing-masing 0 error/8 warning, dan kedua APK bertanda tangan v2 valid. Release berukuran 1.445.580 byte, `debuggable=false`, dengan sertifikat berbeda dari debug. Password signing dan berkas privat tidak ditemukan dalam isi APK release.

Uji backend lokal unit/reward/overview lulus 20 pemeriksaan. `phase1-local.mjs` berhenti pada migrasi `20261115000000_recovery_and_case_guards.sql` karena kolom `mfa_recovery_code.factor_ids` sudah ada sementara registri terakhir baru mencatat `20261114170000_knowledge_workspace_profiles.sql`. Gateway uji kemudian dijalankan langsung terhadap skema terpasang. Pemeriksaan read-only membuktikan isi ketiga fungsi guard cocok dengan source dua migrasi terbaru, dan kedua indeks unik pencegah kredit ganda sudah ada. Source/backend, registri, dan migrasi tidak diedit atau direset; ketidaksesuaian pencatatan migrasi tetap perlu ditangani pada pekerjaan backend terpisah. Hasil lokal tidak membuktikan environment cloud atau hardware.

Perbaikan setelah tinjauan (16 November 2026, Claude Code atas permintaan pemilik): (1) cap waktu server dibaca dengan `OffsetDateTime` karena Postgres mengirim `+00:00` dan `Instant.parse` menolaknya sebelum Java 12 (Android 8 sampai 11); (2) data dianggap usang setelah 75 menit, sama dengan alert `stale` di `my_unit_overview`, lewat satu fungsi `fresh()` (sebelumnya 5 menit di tiga tempat, padahal perangkat membaca tiap 30 menit); (3) penolakan refresh token dikenali dari status HTTP 4xx selain 408/429, bukan dari teks pesan, dan kode `unauthorized`/`invalid_session` menampilkan "Sesi berakhir". Tes ditulis lebih dulu: 3 gagal sebelum perbaikan, lalu 23 tes lulus, lint 0 error/8 warning, kedua APK dibangun ulang dan tanda tangan v2 valid. Tes cap waktu lulus juga sebelum perbaikan karena JVM host menerima kedua bentuk; kegagalan lama hanya bisa dibuktikan di emulator atau HP API 30 ke bawah, dan itu belum dilakukan. Belum diuji di HP atau dengan akun nyata.

Tes UI keamanan kini memeriksa akun tanpa kunci perangkat, kembali dari background, tema sesudah Activity dibuat ulang, `FLAG_SECURE`, navigasi saat sibuk, antrean perubahan nama, serta header pada 320 dp dengan teks 200%. Fixture akun tidak memakai token atau memanggil cloud. Challenge PIN lokal dihapus sesuai pilihan pengguna; pengujian penguncian pada catatan 15 November merupakan perilaku lama.


Uji tambahan `node --test --test-concurrency=1 tests/mfa-recovery.integration.mjs tests/reward-cases.integration.mjs` lulus 13 pemeriksaan pada skema lokal terpasang: kode pemulihan, pembatasan akses sesi password-only, rate limit, akses operator, refund/kompensasi tunggal, dan satu kredit per subjek banding. Total pemeriksaan backend pada hardening ini 33, semuanya lulus. Perubahan source tetap terbatas pada enam file Android.
