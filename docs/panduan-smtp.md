# Panduan SMTP untuk email Smart Agro

Supabase Auth mengirim email konfirmasi pendaftaran dan tautan reset sandi. Server email bawaan Supabase hanya untuk uji coba (kuota sangat kecil dan terbatas pada anggota tim), jadi pendaftaran publik membutuhkan **SMTP sendiri**.

## Keadaan sekarang (dicek 2026-11-15)

- Proyek cloud `smart-agro` (ref `ihgqormeicusyqfphuub`) sudah memakai `smtp.gmail.com:587`.
- Nilai SMTP ada di `.tmp/cloud/smtp.env` (diabaikan git, jangan pernah di-commit atau ditempel di chat).
- Batas yang dipasang: satu email per pengguna per 60 detik, 30 email per jam untuk seluruh proyek.
- Konfirmasi email tetap wajib (`mailer_autoconfirm = false`). Tautan kembali ke `https://smart-agro-demo.pages.dev`.

Pengiriman nyata ke kotak masuk belum diuji pada tanggal ini. Uji dengan langkah di bawah.

## Uji cepat (2 menit)

1. Buka https://smart-agro-demo.pages.dev/ dan pilih **Daftar** dengan email yang bisa Anda buka.
2. Email "Konfirmasi akun Smart Agro" harus tiba dalam satu menit (cek folder Spam).
3. Klik tautan di dalamnya. Anda akan kembali ke aplikasi dalam keadaan masuk.

Kalau tidak tiba, lihat bagian **Masalah umum** di bawah.

## Cara memasang atau mengganti SMTP

### Opsi A. Gmail (cukup untuk demo dan presentasi)

1. Aktifkan **Verifikasi 2 Langkah** di akun Google yang akan menjadi pengirim.
2. Buka https://myaccount.google.com/apppasswords, buat sandi aplikasi (nama bebas, misalnya "Smart Agro"). Google menampilkan 16 karakter; spasinya boleh ikut disalin.
3. Isi `.tmp/cloud/smtp.env`:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=alamat-gmail-anda@gmail.com
   SMTP_PASS=sandi-aplikasi-16-karakter
   SMTP_SENDER=alamat-gmail-anda@gmail.com
   ```

4. Terapkan ke Supabase: `node .tmp/cloud/apply-smtp.mjs`. Skrip hanya mencetak host, port, dan apakah pengirim cocok; sandi tidak dicetak.

Batasnya: kira-kira 500 penerima per hari untuk akun Gmail biasa, pengirim tampil sebagai alamat Gmail, dan email lebih mudah masuk Spam. Pakai ini selama masih prototipe.

### Opsi B. Layanan email transaksional (untuk produk sungguhan)

Resend, Brevo, atau Postmark memberi kuota gratis dan pengiriman yang lebih andal. Yang diperlukan:

1. Satu **domain** milik Anda (misalnya `smartagro.id`), karena penyedia ini meminta domain pengirim diverifikasi.
2. Tambahkan record DNS **SPF** dan **DKIM** yang diberikan penyedia di pengelola domain (Cloudflare, registrar, dan sebagainya). Tanpa ini email cenderung ditolak atau masuk Spam.
3. Buat kredensial SMTP di dashboard penyedia, lalu salin host, port, user, dan sandinya ke `smtp.env`. Nilai host berbeda tiap penyedia, jadi baca halaman "SMTP" mereka. Isi `SMTP_SENDER` dengan alamat di domain yang sudah diverifikasi, misalnya `no-reply@smartagro.id`.
4. Jalankan `node .tmp/cloud/apply-smtp.mjs`.

Tidak perlu mengubah kode aplikasi; semua pengaturan ada di Supabase Auth.

## Setelah memakai domain sendiri

Perbarui juga di Supabase (Authentication → URL Configuration) atau lewat Management API:

- `site_url` menjadi alamat produksi,
- `uri_allow_list` memuat alamat itu (dan `/**`),
- secret edge function `APP_ORIGIN` menjadi alamat yang sama, lalu deploy ulang function agar CORS cocok,
- daftar sumber di `public/_headers` (CSP) bila ada domain baru.

## Templat email dan kode verifikasi

Pendaftaran memakai kode 6 angka dari email (berlaku 10 menit); tautan "Konfirmasi lewat tautan" tetap ada di email sebagai cadangan. Email konfirmasi dan reset sandi ada di `supabase/templates/confirmation.html` dan `recovery.html` (berbahasa Indonesia, dengan gambar kepala `public/mail/header.png` yang dibuat `node scripts/build-mail-assets.mjs`).

1. Lihat hasilnya lebih dulu: `node scripts/preview-email.mjs` menulis PNG ke `design-previews/email-2026-11-15/`.
2. Lihat apa yang akan berubah di cloud (hanya membaca): `node scripts/apply-auth-email.mjs`.
3. Terapkan: `node scripts/apply-auth-email.mjs --apply`. Nilai lama disimpan dulu di `.tmp/cloud/backups/auth-email-<waktu>.json`, lalu hasilnya diverifikasi. Kembalikan dengan `node scripts/apply-auth-email.mjs --restore <berkas>`.

Skrip ini mengatur kode OTP 6 angka (bukan 8) yang berlaku 10 menit (bukan 1 jam). Terapkan **sesudah** gambar kepala tayang di `smart-agro-demo.pages.dev/mail/header.png` (deploy hijau), supaya email tidak menampilkan gambar rusak. `apply-smtp.mjs` hanya mengatur SMTP.

**Kenapa pengirim tampil "saya"?** Nama pengirim di cloud sudah "Smart Agro". Gmail menamai email dari akun yang sama dengan penerimanya "saya". Uji dengan alamat penerima yang berbeda dari akun pengirim.

## Masalah umum

| Gejala | Penyebab biasa | Perbaikan |
| --- | --- | --- |
| Tidak ada email sama sekali | Sandi aplikasi salah atau Verifikasi 2 Langkah belum aktif | Buat ulang sandi aplikasi, isi `smtp.env`, jalankan ulang skrip |
| Pengirim tampil "saya" | Penerima sama dengan akun Gmail pengirim | Uji dengan alamat lain |
| Email masuk Spam | Pengirim Gmail atau domain tanpa SPF/DKIM | Opsi B dengan domain terverifikasi |
| Galat "rate limit" saat daftar | Batas 60 detik per pengguna atau 30 per jam tercapai | Tunggu, atau naikkan `rate_limit_email_sent` di `apply-smtp.mjs` |
| Tautan membuka alamat salah | `site_url` atau `uri_allow_list` tidak cocok | Perbarui seperti bagian di atas |
| Pengguna sudah terdaftar tetapi tidak bisa masuk | Email belum dikonfirmasi | Kirim ulang dari layar masuk, atau konfirmasi manual di dashboard Supabase (Authentication → Users) |

## Keamanan

- `smtp.env` dan `supabase.env` tidak boleh masuk git, chat, atau log. Keduanya sudah diabaikan git.
- Kalau sandi aplikasi pernah bocor, cabut di https://myaccount.google.com/apppasswords dan buat yang baru.
- Templat email ada di `supabase/templates/`, bukan di `apply-smtp.mjs`; lihat bagian "Templat email dan kode verifikasi".
