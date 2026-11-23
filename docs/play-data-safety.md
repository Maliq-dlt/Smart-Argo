# Persiapan Data safety Android

Draf 23 November 2026 untuk paket `id.smartagro.app`. Pengelola perlu memeriksa APK rilis, konfigurasi penyedia, kontak privasi aktif, retensi log dan cadangan, serta menjawab formulir Play Console sebelum publikasi. Halaman kebijakan ada di `public/privasi.html`. URL penghapusan akun adalah `/#hapus-akun` pada domain aplikasi.

| Data/alur | Tujuan dan pilihan pengguna | Penerima atau penyimpanan |
| --- | --- | --- |
| Email, ID akun, identitas Google, nama tampilan, foto | Login dan profil. Nama/foto dapat diubah, foto opsional | Supabase Auth dan basis data, Google saat login Google |
| Nomor perangkat/produk, kepemilikan, bacaan dan energi | Registrasi dan pemantauan alat | Backend Smart Agro di Supabase |
| Nama lokasi, koordinat kebun | Penataan kebun dan cuaca ketika lokasi diberikan | Server kebun, Open-Meteo menerima koordinat dibulatkan |
| Jurnal, pertanyaan, siklus, data yang dibagikan | Riwayat, penjelasan dan berbagi atas tindakan pengguna | Backend, komunitas bila dibagikan, penyedia model bila diaktifkan |
| Log akses dan peristiwa keamanan, sesi/MFA | Autentikasi, pencegahan penyalahgunaan, audit | Auth, log layanan, sesi terenkripsi di HP |
| Email dan rincian peringatan | Peringatan perawatan atas persetujuan pemilik | Relay SMTP saat email aktif |
| IP dan metadata permintaan layanan eksternal | Pemeriksaan versi, layanan Google yang dipilih | GitHub Releases, Google/Play Services sesuai fitur |
| SSID dan sandi Wi-Fi | Konfigurasi lokal atas tindakan pengguna | Permintaan HTTP ke ESP32 di jaringan setup; periksa pengecualian aliran lokal saat menjawab tentang enkripsi transit |
| Cache kebun, widget, ekspor CSV | Baca offline, widget pilihan pengguna dan berbagi berkas | Penyimpanan privat HP, layar utama, tujuan berbagi yang dipilih |

Tidak ada SDK iklan atau analitik di web maupun Android (diperiksa 23 November 2026). Koordinat ke Open-Meteo dibulatkan dua desimal (`round2` di `weather-forecast/handler.ts`). Purge menghapus `community_contribution`, `care_journal`, `explanation_attempt`, siklus, slot, situs, foto, `activation_nonce` dan `security_event`. Kontak privasi di halaman kebijakan sementara mengarah ke GitHub Issues (publik); sediakan email kontak sebelum mengajukan ke Play.

Pengiriman ke backend produksi memakai HTTPS. Portal ESP32 memakai HTTP lokal pada jaringan setup. Status "dikumpulkan", "dibagikan", pengecualian pemroses layanan dan perlakuan SDK Google perlu disesuaikan dengan perjanjian layanan dan build yang diajukan. Formulir publik dan kontak dukungan diisi oleh pemilik akun Play.

Proses penghapusan setelah 14 hari menghapus login dan data pribadi tertentu. Baris akun ditandai dihapus untuk relasi audit, bukti teknis dan riwayat kepemilikan. Periksa penjadwal `purge_due_account_deletions` dan kebijakan cadangan pada deployment sebelum menyatakan waktu penghapusan kepada pengguna.

Acuan kode: `20261122000000_account_deletion_avatar.sql`, `20261122010000_deletion_security_hold.sql`, `supabase/functions/weather-forecast/handler.ts`, `supabase/functions/unit-explanation/handler.ts`, `supabase/functions/alert-dispatch` dan `android/app/src/main`.
