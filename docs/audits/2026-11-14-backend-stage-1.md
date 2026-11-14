# Backend tahap 1 — keamanan klaim dan biaya AI

Tanggal: 14 November 2026 (Asia/Jakarta). Batas pekerjaan dari pengguna: backend saja; UI dikerjakan Claude. Tahap ini menutup SEC-01/SEC-02 dari [audit sebelumnya](2026-11-13-backend-readiness.md) dan menambahkan pemeriksaan backend ke CI. Tidak ada dependency baru.

## Perubahan

1. **Aktivasi dan MFA.** Migration `20261114000000_activation_mfa.sql` menolak penerbitan nonce oleh sesi AAL1 jika account mempunyai TOTP terverifikasi. Final RPC memeriksa ulang assurance, factor dan sesi sebelum konsumsi nonce/ownership; sesi dikunci selama transaksi. Handler meneruskan assurance dari JWT yang sudah divalidasi Auth, bukan body pengguna. Overload lama diganti dengan argumen assurance default AAL1 agar caller lama gagal tertutup pada account MFA dan tetap kompatibel untuk account tanpa MFA.
2. **Admission sebelum inference.** Migration `20261114010000_explanation_admission.sql` menyimpan satu baris per percobaan. Pemeriksaan per account berlangsung atomik sebelum AI: maksimum 20 percobaan/menit, 2 worker aktif, lease 2 menit. Hasil tersimpan dikembalikan tanpa inference; permintaan sama yang masih berjalan menghasilkan 409; kehabisan kuota menghasilkan 429. Retry kedaluwarsa memakai percobaan baru dan tetap dihitung. Kuota berlaku lintas produk dalam account yang sama.
3. **Finalisasi bertoken.** Hanya service-role dapat melakukan finalisasi. Worker lama/expired tidak dapat menyimpan; snapshot dan penutupan attempt satu transaksi. Urutan lock product → account → attempt → session menjaga keselarasan dengan transaksi energi. Expiry diperiksa setelah lock dan setelah inner save; exception sesudah save me-rollback snapshot. Tabel attempt mempunyai RLS, tanpa akses baca/tulis langsung oleh anon/owner.
4. **Histori besar tetap didukung.** Gateway menerapkan batas internal 600.000 byte untuk finalisasi snapshot baru, sama seperti penyimpanan snapshot sebelumnya. Request browser tetap dibatasi sesuai batas sebelumnya.
5. **CI backend.** Job baru `backend` pada Checks menyalakan stack lokal terisolasi, menunggu health, menjalankan `npm run test:backend`, lalu menutup proses/container pengujian. Startup log berada di `.tmp`, tidak mencetak credential. Job belum dijalankan di GitHub karena pekerjaan ini belum dipush.

Tabel attempt dipertahankan sebagai bukti penggunaan/percobaan. Retensi dan anggaran global lintas account belum ditambahkan; kebutuhannya harus ditentukan bersama kebijakan data dan anggaran provider.

## Batas perubahan

File implementasi milik tahap ini:

- `.github/workflows/checks.yml`
- `scripts/backend-gateway.mjs`
- `supabase/functions/product-claim/handler.ts`
- `supabase/functions/unit-explanation/handler.ts`
- Dua migration baru bertanggal 20261114
- `tests/account-activation.integration.mjs`
- `tests/ai-explanation.integration.mjs`
- `tests/explanationAdmission.test.ts`

Perubahan lain pada UI, aset, package files dan dokumentasi yang sudah ada/dikerjakan bersamaan oleh Claude dipertahankan. Status Git seluruh workspace tidak sama dengan daftar file yang dikerjakan tahap ini.

## Verifikasi

Log dan reproduksi berada di `.tmp/backend-stage1-2026-11-14/`.

- Sebelum fix, ketiga tes handler AI gagal karena inference tetap dipanggil untuk duplicate/pending/quota rejection. Setelah fix, 3/3 lulus.
- Reproduksi SQL AAL1 terhadap database lama gagal dengan pesan `verified MFA account issued a nonce to AAL1`; setelah migration, pemeriksaan yang sama lulus. Fixture SQL seluruhnya rollback.
- Fresh-database check menerapkan seluruh 13 migration dari file final tanpa data pengguna. Seluruh 28 tabel domain mengaktifkan RLS; overload klaim lama tidak ada; grants reserve/finalize dan private-table checks lulus. Evidence menyertakan hash SHA256 migration di `fresh-migrations-result.json`. Database pengujian dipertahankan.
- `npm test`: 101/101 lulus pada run yang dicatat.
- `npm run lint`, `npm run typecheck`, `npm run build`: lulus. Warning build yang sudah ada: chunk >500 kB dan dua font yang diselesaikan saat runtime.
- YAML workflow dan sintaks Bash job baru lulus validasi lokal. Ini bukan hasil eksekusi GitHub Actions.

Run integrasi awal menemukan fixture dengan public key tetap yang bertabrakan saat pengulangan, serta batas payload gateway yang belum mencakup RPC baru. Fixture dan gateway diperbaiki, lalu suite penuh dijalankan ulang. **Run final `npm run test:backend`: 73/73 lulus, tanpa skip, dalam sekitar 173 detik (`backend-final.log`).** Scoped lint pada seluruh file backend yang berubah juga lulus setelah koreksi terakhir.

## Penerapan

Dua migration baru sudah diterapkan pada stack lokal. Belum ada push, deploy Edge Functions, ataupun perubahan data/config Supabase cloud.

Urutan rilis yang diperlukan: **apply migration dalam urutan nama → reload schema PostgREST → deploy/restart handler `product-claim` dan `unit-explanation`**. Handler baru yang dipasang sebelum migration akan merujuk RPC/signature yang belum tersedia dan mengembalikan 503. Selama jendela migration-first, caller klaim lama default ke AAL1 sehingga account MFA gagal tertutup sampai handler baru tersedia.

Gateway lokal tanpa provider AI nyata dipakai untuk regresi aturan. Suite AI memakai server OpenAI-compatible lokal yang terlabel sebagai stub; tidak ada biaya inference eksternal dan tidak ada klaim model/IoT fisik telah diuji.

## Tahap backend berikut yang relevan

Lanjutkan dengan backup/restore teruji dan logging operasional terstruktur. Pemulihan akun, jurnal perawatan, ekspor histori, organisasi/tim dan provisioning perangkat memerlukan kontrak API serta alur yang diselaraskan dengan Claude; penambahan UI tetap di luar scope pekerjaan ini. Skor cakupan diagram sebelumnya tidak dinaikkan hanya karena hardening: tahap ini memperbaiki keamanan/verifikasi, bukan menambah use case bisnis baru.
