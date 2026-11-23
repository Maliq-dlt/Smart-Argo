# Android "pot sebagai antarmuka" dan akun lengkap

Tanggal: 22 November 2026. Acuan visual yang disetujui: `design-previews/android-apple-2026-11-22/` (pengguna: "UI seperti
ini sudah lumayan bagus, implementasiin"). Arti setiap gerak ada di `NOTES.md` mock itu dan wajib diikuti.

## Keputusan pengguna (22 Nov, 06:40 WIB)

| Topik | Keputusan |
|---|---|
| Hapus akun | Tenggang 14 hari: akun langsung nonaktif dan keluar dari semua perangkat, data dihapus permanen sesudahnya. Masuk lagi dalam 14 hari memunculkan pilihan batalkan atau tetap hapus. |
| Produk milik akun | Dilepas otomatis setelah konfirmasi; daftar produk ditampilkan dulu. Bukti on-chain tetap (hanya hash). |
| Foto profil | Unggah foto (kamera atau galeri), dipotong bulat, maks 2 MB, privat. Tanpa foto tampil inisial. Akun Google memakai foto Google sampai diganti. |
| Cadangan akun | Verifikasi ulang (sandi atau Google) + kode 2FA bila aktif; kode pemulihan bila autentikator hilang. Email konfirmasi ke alamat akun. |
| Web | Google Play mewajibkan hapus akun di aplikasi **dan** lewat tautan web: `#hapus-akun` di app live. |

## Yang sudah ada (tidak dibuat ulang)

`display_name` di metadata GoTrue (web `saveMetadata`, Android ubah nama), 2FA TOTP, kode pemulihan
(`create_my_recovery_codes`, `my_recovery_codes_status`, `consume_recovery_code`, fungsi `mfa-recovery`), log keamanan,
penahanan 24 jam (`security_hold_until`), keluar dari perangkat lain, ekspor CSV (`history-export`), berbagi komunitas
per slot, gerbang verifikasi ulang (`privileged_write_gate`, `value_action_gate`).

## Fase

Tiap fase: tes merah lalu hijau, lint, build, tangkapan (Android: emulator 412/360 dp, terang/gelap, teks 200%;
web: 1440/768/390/320), commit lalu push ke cabang kerja. Perubahan cloud (migrasi, fungsi, secret) **hanya dengan
persetujuan pengguna**.

1. **Backend akun (lokal dulu).** Migrasi baru:
   - Storage bucket privat `avatars`, jalur `<uid>/avatar.webp`, RLS pemilik saja, batas 2 MB, tipe webp/jpeg/png;
     `avatar_path` di metadata pengguna; URL bertanda tangan untuk membaca.
   - Tabel `account_deletion` (diminta, jadwal hapus = +14 hari, dibatalkan, dihapus) dan RPC
     `request_account_deletion` (verifikasi ulang ≤5 menit, AAL2 bila TOTP aktif, lepas semua unit milik, catat log),
     `cancel_account_deletion`, `my_account_deletion`. Sesi dicabut lewat fungsi edge dengan admin API.
   - Fungsi edge `account-purge` (terjadwal harian): hapus data kebun, jurnal, sesi, foto; anonimkan ledger hadiah dan
     rujukan outbox chain; `auth.admin.deleteUser`. Email konfirmasi lewat SMTP yang sama dengan Auth.
   - Tes integrasi: tanpa verifikasi ulang ditolak, unit dilepas, batal dalam tenggang memulihkan, lewat tenggang
     menghapus, akun lain tidak tersentuh.
2. **Web.** Profil: foto (unggah, potong, hapus), hapus akun 4 langkah seperti mock, rute `#hapus-akun` yang bisa
   dibuka tanpa aplikasi (meminta masuk dulu), layar "akun dijadwalkan dihapus" saat masuk dalam tenggang.
3. **Android A, kit.** Komponen garis ukur (pita ukur, penggaris hari dengan bab fase, pita rawat, batang tipis),
   efek tepi gulir di bawah tab bar, kapsul "Latihan" tunggal, "Akhiri latihan" sebagai baris merah.
4. **Android B, detail.** Panggung penampang pot (tanah menggelap sesuai indeks, layu saat kering, air tiba hanya saat
   bacaan baru), nama dan status di bawah panggung, satu kartu aksi (catat siram, urungkan, simulasi di latihan),
   penggaris hari yang menumbuhkan gambar, Kondisi dengan pita ukur, pita rawat, cuaca, lembar "Kenapa?".
5. **Android C, beranda.** Kalimat status, kisi pot mini (tinggi garis air = indeks), urutan perlu perhatian dulu,
   transisi zoom ubin ke panggung, roda pilih jenis saat menambah tanaman.
6. **Android D, aktivitas.** Pemilih tanaman di bawah judul, satu segmen 24 jam/7 hari, tiga grafik batang tipis,
   lembar grafik yang bisa ditelusuri, jurnal per hari.
7. **Android E, akun.** Kartu profil, Profil (foto lewat Photo Picker atau kamera, potong, unggah; nama dengan validasi),
   Masuk & keamanan (cara masuk, 2FA, kode pemulihan, perangkat, aktivitas), Data & privasi (unduh, komunitas, hapus
   akun 4 langkah, layar batalkan saat masuk lagi), Kelola akun di web.

## Batas yang diketahui

- Catatan chain tidak bisa dihapus; hanya hash tanpa data pribadi yang tersisa, dan ini dijelaskan di layar hapus akun.
- Email konfirmasi hapus akun bergantung pada SMTP Gmail yang sekarang; penempatan di Spam belum teruji.
