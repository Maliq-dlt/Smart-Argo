# Smart Agro — preview aplikasi

Mockup HTML interaktif untuk review UI dan animasi. Berdiri sendiri, tanpa mengubah website React maupun aplikasi Kotlin. Belum disambungkan ke backend; seluruh pot, sensor, dan timeline adalah contoh. Form masuk hanya menerima panggilan, tanpa password. Riwayat kelembapan dipakai untuk mendemonstrasikan pencatatan otomatis; belum menerima stream sensor asli.

## Jalankan

Dari root repository:

```powershell
python -m http.server 4318 --bind 127.0.0.1
```

Buka http://127.0.0.1:4318/android/design-preview/ . Tidak perlu Android Studio atau dependency baru. Server harus dijalankan dari root karena font dibaca dari `public/fonts/`.

Di desktop tersedia konfigurasi ukuran 320/390/430 px, tema, layar, dan pengurangan animasi. Di viewport sempit, preview mengisi layar; tombol pengaturan ada di pojok kanan atas.

## Interaksi yang dapat ditinjau

- Masuk demo → Tanaman saya → dasbor persona tanaman; navigasi bawah Tanaman, Aktivitas, dan Akun. Pot/Kebun merupakan konteks produk, bukan tab wajib.
- Tanaman saya memakai baris ringkas dengan pencarian nama/kode. Nama panggilan dapat diganti; kode contoh tetap dan nama jenis tetap terlihat. Akun menambahkan contoh saldo reward, tautan profil, keamanan, kepemilikan dan blockchain sesuai tujuan website.
- Pemilih produk dan tanaman mengelompokkan persona per produk dalam satu akun. Pengaturan review menyediakan koleksi contoh Pot saja / Kebun saja / Pot dan kebun. Ini skenario tampilan, bukan fitur untuk memberikan akses atau mengubah kepemilikan. Alur verifikasi menunggu kontrak website yang sedang dikerjakan Claude.
- Kebun rumah tersedia dari produk kebun yang ada pada koleksi contoh; dua persona, filter Teras/Sudut, dan ketuk tanaman untuk membuka dasbor.
- Cuaca contoh Cerah/Berawan/Hujan mengubah suasana SVG di tanaman dan kebun; tidak meminta lokasi atau data cuaca langsung.
- Pilih produk/persona lewat nama produk atau deretan nama/kode di atas tanaman; perpindahan tidak mengganti akun. Ketuk daun untuk gerak kecil berurutan; pot tetap diam dan tidak muncul toast. Ketuk maskot untuk sapaan, arah pandangnya mengikuti pointer, sedangkan tombol kondisi di sebelahnya membuka detail kelembapan. Lihat akar membuka ilustrasi akar bertahap dari atas ke bawah. Gerak respons selesai sendiri, tanpa pantulan atau loop idle; mengikuti reduced motion.
- Buka sensor, pilih 24 jam/7 hari, telusuri grafik langsung dengan jari/mouse, slider sentuh, atau tombol panah. Geseran vertikal di atas grafik tetap menggulir panel.
- Tombol plus, pencatatan penyiraman manual, dan volume ml dihapus. Jejak tumbuh diturunkan otomatis dari riwayat sensor, dengan label Kelembapan meningkat. Satu rangkaian kenaikan menghasilkan satu kejadian; tampilan ulang tidak menggandakannya.
- Batas contoh adalah kenaikan kumulatif 5 poin selama sampel terus naik. Noise kecil, nilai turun/datar, dan sampel tidak valid memutus rangkaian; tidak ada klaim penyiraman pasti, karena hujan juga dapat meningkatkan kelembapan. Ambang dan jeda pembacaan belum dikalibrasi untuk perangkat; ini referensi UI, bukan detektor produksi.
- Maskot di bawah ilustrasi mengekspresikan media mulai kering / cukup lembap / lebih basah dari indeks contoh. Ketuk untuk membuka sensor kelembapan. Tidak mendiagnosis penyakit atau kesehatan tanaman.
- Detail sensor, cuaca, dan pemilih persona tampil sebagai halaman nonmodal dengan gerak horizontal pendek 12 px. Tidak ada backdrop, penarikan bottom sheet, atau efek lingkaran saat tombol ditahan. Kembali, Escape, dan navigasi bawah tetap berfungsi; fokus kembali ke pemicu.
- Pilihan 24 jam/7 hari mempertahankan tombol, grafik, dan panel; kurva bergeser ke bentuk baru tanpa meredupkan layar. Ketukan cepat dapat mengganti tujuan gerak. Rentang harian memakai kemarin 18.00 sampai hari ini 18.00 pada data contoh.
- Tab yang sudah aktif tidak menggambar ulang layar. Setelah panel cuaca ditutup, fokus kembali ke tombol pemicunya.
- Filter Jejak tumbuh mengubah daftar di tempat: header/tombol tetap terpasang, baris melipat, dan posisi scroll dipertahankan. Tidak ada animasi yang meredupkan seluruh layar.
- Cabai/bawang berganti dengan transisi tajuk; pot, kontrol sensor, dan posisi scroll tetap di tempat.
- Scroll memakai perilaku native browser dan mengingat posisi per layar. Tidak ada pengambilalihan wheel/gesture scroll.
- Loading awal menunggu kesiapan font. Tombol Lihat loading screen memutar ulang demonstrasi pembuka 1,2 detik; ini demonstrasi, bukan permintaan backend.
- Tombol tidak mengecil/memantul saat ditekan; halaman detail tanpa blur atau lapisan peredup. Indikator navigasi bergeser, detail berhenti lembut tanpa overshoot atau pantulan, transisi layar dapat diinterupsi. Mengikuti pengaturan reduced motion sistem dan kontrol preview.

Gerak ini merupakan referensi perilaku untuk implementasi Compose berikutnya; kelancaran pada perangkat Android fisik belum diuji.

## Referensi publik

- [Apple Home](https://www.apple.com/home-app/): ringkasan kondisi yang mudah dipindai dan pengelompokan perangkat.
- [Apple HIG — Motion](https://developer.apple.com/design/human-interface-guidelines/motion): gerak singkat untuk menjelaskan tindakan, dapat diinterupsi, mendukung reduced motion.
- [Apple HIG — Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets): tugas singkat dalam konteks layar, satu sheet pada satu waktu.

Halaman Apple dan materi sheet ditinjau pada 15 November 2026. Halaman pencarian Dribbble tidak berhasil diekstrak; tidak dipakai sebagai dasar desain. Tidak menggunakan aset atau komponen proprietary Apple; SVG tanaman mengikuti geometri identitas Smart Agro. Warna sage/lumut, General Sans, dan Fraunces tetap mengikuti tema website.

## Verifikasi

```powershell
node --check android/design-preview/preview.js
node node_modules/eslint/bin/eslint.js android/design-preview/preview.js android/design-preview/check.mjs
# Gunakan instalasi Playwright yang sudah tersedia pada mesin:
$env:PLAYWRIGHT_MODULE = 'C:/Users/malik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node android/design-preview/check.mjs
```

Server lokal harus aktif. Pemeriksaan menggunakan Chrome headless yang terpasang, mencakup alur demo, sheet, grafik, deteksi kenaikan kelembapan dari data contoh, sanitasi nama, ukuran layar, kedua tema, halaman detail, filter tanpa penggantian layar, scroll per frame, pergantian tanaman, cuaca, kebun, loading, pergantian periode, gestur sentuh horizontal/vertikal melalui Chrome DevTools Protocol, koleksi pot/kebun, persona tanpa ganti akun, detail tanpa overshoot, serta reduced motion. Laporan dan screenshot ditulis ke `.tmp/app-preview/` pada root repository.

Revisi 2D interaktif 15 November 2026: 142 pemeriksaan Chrome lulus, tanpa error browser, request gagal, atau request eksternal. Pose daun pada contoh yang lebih kering adalah ekspresi kelembapan, bukan prediksi bentuk atau penyakit tanaman.
