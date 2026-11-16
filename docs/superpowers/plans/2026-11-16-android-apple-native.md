# Android native bergaya Apple: rencana per fase

Dibuat 2026-11-16 atas permintaan pemilik: perbaiki bug aplikasi Android lebih dulu, lalu ubah UI agar terasa seperti aplikasi native Apple (interaktif, elegan, UX selaras pengguna), samakan fitur dengan website, dan terbitkan APK yang bisa diunduh dari GitHub. **Status: empat keputusan pemilik sudah diambil (bagian akhir); A0 dimulai.**

## Titik awal (diperiksa 2026-11-16 sore)

- `android/`: Kotlin + Jetpack Compose, 15 berkas sumber (±2.000 baris), minSdk 26, targetSdk 36, Compose BOM 2026.04.01. Belum dilacak Git.
- Codex mengubahnya 2026-11-16 pukul 13:03–13:29 WIB, setelah tinjauan pagi: masuk Google lewat Credential Manager (butuh `GOOGLE_WEB_CLIENT_ID`), kebun dari `my_garden` dengan label CB/BM/AB/PN, tarik-untuk-segarkan, umpan balik tekan, grafik berrentang adaptif dengan halaman berikutnya, transisi layar, kunci aplikasi dihapus (pilihan pemilik 16 November). Tiga bug mayor pertama sudah diperbaiki Claude pagi itu.
- Yang belum pernah dilakukan: menjalankan aplikasi di HP atau emulator. Mesin ini punya Android SDK dan emulator tetapi **tanpa system image**. Semua bukti UI berasal dari Robolectric.
- `FLAG_SECURE` aktif di semua layar, jadi pemilik tidak bisa mengirim tangkapan layar untuk review desain.

## Kesetaraan fitur dengan website

Acuan kesetaraan adalah **app live** (`live.smart-agro-demo.pages.dev`, build `VITE_APP_MODE=live`), bukan demo: aplikasi HP adalah produk untuk pemilik pot sungguhan, jadi tanpa tamu, Ruang tanam, simulator, Terminal, dan cuaca simulasi.

| Fitur website (live) | Aplikasi sekarang | Fase |
| --- | --- | --- |
| Masuk email/sandi, Google, 2FA | Ada; Google menunggu Client ID | A1 |
| Daftar dengan kode email 6 angka, reset sandi | Dialihkan ke website | A4a |
| Siapkan pot pertama, wizard pot/kebun, ganti tanaman, riwayat siklus | Hanya melihat kebun | A4c |
| Panggung tanaman (penampang pot, langit, cuaca nyata) | Ilustrasi lama (`PlantIllustration` versi lama web) | A3, A4b |
| Saran perawatan dan penjelasan unit (`unit-explanation`) | Hanya di mode latihan | A2, A4b |
| Mode belajar untuk tanaman tanpa profil (anggrek) | Tidak ada | A4b |
| Telemetri, grafik 24 jam / 7 hari | Ada | A4b (gaya baru) |
| Cuaca nyata dari situs berkoordinat (fungsi `weather-forecast`) | Open-Meteo langsung dari HP per kota | A2 |
| Jurnal perawatan, perbandingan minggu, ekspor CSV | Tidak ada | A4d |
| Berbagi ke pengetahuan komunitas, membaca agregat | Tidak ada | A4c |
| Produk saya, persona, ganti nama | Ada | A4f (gaya baru) |
| Aktivasi lewat QR (kamera), transfer, pemulihan kepemilikan | Dialihkan ke website | A4f |
| Keamanan: 2FA, kode pemulihan, log aktivitas | Dialihkan ke website | A4e |
| Reward: saldo, katalog, reservasi, ledger, banding | Ada kecuali banding | A4g |
| Bukti energi, bukti chain | Bukti chain ada; energi tidak | A4g |
| Ruang kerja operator dan kurator | Tidak ada | Diusulkan tetap di website (lihat keputusan) |

## Prinsip desain yang dipakai

Sumber: Apple Human Interface Guidelines lewat skill `apple-design` (dipasang 2026-11-16 di `~/.claude/skills/apple-design`, 124 halaman HIG; repo tanpa lisensi, jadi hanya dibaca sebagai acuan, tidak disalin ke repo ini). Setiap keputusan desain mengutip halaman HIG yang dibaca, bukan dari ingatan.

- **Struktur iOS, perilaku Android.** Tab bar bawah untuk bagian utama, judul besar yang menyusut saat menggulir, daftar berkelompok (inset grouped), sheet dengan detent, menu konteks tekan lama, geser untuk aksi. Tetapi tombol/gestur kembali Android, inset edge-to-edge, TalkBack, dan target sentuh 48 dp tetap dihormati (HIG sendiri meminta mengikuti konvensi platform untuk navigasi kembali).
- **Gerak berpegas, bukan durasi.** Semua transisi memakai `spring()` dengan dua atau tiga preset bersama (padanan pegas bawaan SwiftUI), dapat diinterupsi, dan mengikuti skala animasi sistem; reduced motion tetap didukung.
- **Haptik** pada aksi yang berhasil, pilihan segmen, tarik-untuk-segarkan, dan aksi destruktif.
- **Material kaca terbatas** pada tab bar dan bar navigasi (blur di atas konten) memakai pustaka Haze (chrisbanes). Efek "Liquid Glass" bergaya refraksi masih eksperimental di Haze, jadi tidak dipakai di versi pertama.
- **Identitas Smart Agro tetap.** Font General Sans dan Fraunces (SF Pro tidak boleh dipakai di luar platform Apple), palet Sage dan lumut dengan nilai persis seperti web, ikon Phosphor seperti web.
- Alur pemilik untuk UI: mock HTML berukuran HP untuk 3 layar kunci → review → port ke Compose → review tangkapan layar emulator.

## Fase

Tiap fase ditutup dengan: tes unit dan UI hijau, lint tanpa error, APK dibangun, tangkapan layar emulator terang dan gelap pada lebar 360 dan 412 dp serta teks 200%, commit dan push, catatan di HANDOFF/CLAUDE.md/Obsidian.

### A0. Fondasi (tanpa perubahan perilaku)
- Masukkan `android/` ke Git dengan `.gitignore` yang menjaga `.private/`, `.cache/`, `build/`, `.tmp/`, `local.properties` tetap di luar.
- Job CI Android (Gradle: tes unit, lint, `assembleDebug`) di `checks.yml`.
- Emulator: pasang system image API 30 (bug cap waktu hanya muncul di Android 11 ke bawah) dan API 35, dan buat skrip tangkapan layar.
- Baseline: build dan tes kode Codex saat ini, uji pertama di emulator dengan akun lokal.

### A1. Bug
- Audit ulang daftar bug pagi terhadap kode sekarang; perbaiki yang tersisa dengan tes yang gagal dulu.
- Buktikan perbaikan cap waktu di emulator API 30 (sebelumnya hanya teori).
- Masuk Google: Client ID Android/Web di Google Cloud dan pengaturan Supabase untuk token ID; uji dengan akun Google sungguhan.
- `FLAG_SECURE` hanya pada layar berisi kode (2FA, kode pemulihan, kode aktivasi), bukan semua layar.
- Label web "Usang (>5 menit saat dimuat)" di `ProductTelemetry.tsx` disamakan dengan batas 75 menit.

### A2. Kontrak data setara web (tak terlihat di UI)
- Cuaca lewat fungsi `weather-forecast` dengan koordinat situs, bukan Open-Meteo langsung dari HP; pilihan kota di HP dihapus.
- Saran perawatan dan penjelasan unit dari server, sama dengan web; mode latihan dipertahankan dengan label.
- Kode tanaman memakai bilangan bulat global dan label CB-1, bukan `T-…`.

### A3. Sistem desain Apple untuk Compose
- Mock HTML 3 layar kunci (beranda tanaman, detail tanaman, akun) untuk disetujui pemilik.
- Token: warna semantik terang/gelap dari web, skala tipe bergaya HIG (judul besar 34, judul 28/22/20, isi 17, catatan 13, keterangan 12) dengan Fraunces untuk judul.
- Komponen: tab bar kaca, bar navigasi judul besar, daftar berkelompok, sel, sheet berdetent, segmen, sakelar, menu konteks, aksi geser, tombol, banner status; preset pegas dan haptik.
- Layar galeri komponen khusus build debug untuk review.

### A4. Layar per layar dan fitur yang belum ada
- A4a Masuk, daftar dengan kode email, reset sandi, onboarding singkat.
- A4b Beranda tanaman dan detail: panggung tanaman versi web (penampang pot, langit, cuaca), saran, mode belajar, grafik yang bisa ditelusuri.
- A4c Kebun: wizard pot/kebun, ganti tanaman, riwayat siklus, berbagi komunitas.
- A4d Aktivitas: jurnal, perbandingan minggu, ekspor CSV lewat lembar bagikan Android.
- A4e Akun dan keamanan: nama, 2FA, kode pemulihan, log aktivitas, keluar.
- A4f Produk: aktivasi lewat QR dengan kamera, transfer, pemulihan kepemilikan.
- A4g Reward, banding, energi, bukti chain.

### A5. Rilis di GitHub
- Versi semantik (`versionName`/`versionCode`), APK bertanda tangan kunci rilis, checksum SHA-256, catatan rilis berbahasa Indonesia.
- Diterbitkan di **GitHub Releases** (halaman Releases repo, tombol unduh APK). GitHub Packages ditujukan untuk pustaka (Maven/npm/container), bukan aplikasi siap pasang.
- Tautan unduh di README dan di landing.

### A6. Uji pemilik di HP dan pemolesan

## Keputusan pemilik (2026-11-16 sore)

1. **Kaca hanya di bar** (tab bar dan bar judul); konten lain padat. Liquid Glass penuh tidak dipakai.
2. **APK ditandatangani di laptop ini** lalu diunggah ke GitHub Releases dengan `gh`; kunci rilis tidak pernah keluar dari `android/.private/`.
3. **Emulator API 30 dan 35** boleh diunduh (cmdline-tools dipasang dengan checksum terverifikasi; WHPX tersedia).
4. **Operator dan kurator tetap di website.**

Baseline A0 (kode Codex 13:29 WIB): 34 dari 35 tes lolos; yang gagal adalah bug nyata, judul "Smart Agro" di header terpotong pada 320 dp dengan teks 200% (`SecurityTest.smallScreenHeaderWrapsWithLargeText`). Masuk A1.
