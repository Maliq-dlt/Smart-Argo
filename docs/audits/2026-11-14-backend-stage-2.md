# Backend tahap 2 — pemulihan database dan logging

Tanggal: 14 November 2026 (Asia/Jakarta). Melanjutkan [tahap 1](2026-11-14-backend-stage-1.md), sesuai batas pengguna: backend saja; UI milik Claude. Tidak ada dependency baru, perubahan UI, push, atau deployment cloud dari tahap ini.

## Hasil

- `scripts/database-backup.mjs` membuat backup PostgreSQL format custom melalui stream biner, memverifikasi SHA256/ukuran dan keterbacaan archive, lalu memulihkan hanya ke database baru. File existing, target existing/system/source, path di luar direktori backup repo, symlink yang keluar workspace, dan identifier dengan newline ditolak. File staging eksklusif dan publikasi hard-link mencegah overwrite. Restore satu transaksi mempertahankan ownership/grants asli; role yang diperlukan harus sudah tersedia.
- Empat entrypoint Edge dan gateway menghasilkan JSON access log berisi operasi tetap, UUID permintaan, method allowlist, status, durasi, outcome, serta level. ID diteruskan ke Auth/PostgREST dan dikembalikan pada response. Tidak merekam body, URL/query, nama RPC dinamis, credential, identitas account/device, atau pesan exception. Sink logger yang gagal tidak mengubah respons bisnis.
- Gateway membedakan respons selesai dengan koneksi terputus melalui `finish`/`close`, tepat satu log per request. Parsing URL malformed sekarang dijaga dan menghasilkan 400. Wrapper Edge menyalin header immutable tanpa membaca stream body.
- Job `backend` pada CI diperluas dengan backup → verify → restore ke database baru setelah suite integrasi. YAML dan sintaks Bash diverifikasi lokal; GitHub Actions belum dijalankan untuk perubahan ini.

Pertanyaan operasi yang dijawab log: operasi HTTP mana yang gagal, seberapa sering 4xx/429/5xx terjadi, berapa durasi request, dan record mana yang berkaitan melalui `requestId`. Ini access log, bukan ledger audit keamanan atau tracing penuh.

## Verifikasi yang benar-benar dijalankan

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | Run akhir 108/108 lulus, tanpa skip; mencakup lima tes logging dan satu tes batas backup. Jumlah keseluruhan mencakup tes dari perubahan paralel Claude. |
| `npm run test:backend` | 73/73 lulus, tanpa skip, sekitar 177 detik pada stack lokal. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Lulus. Build tetap memberi warning font yang diselesaikan saat runtime dan chunk >500 kB. |
| `git diff --check` | Lulus; peringatan normalisasi LF/CRLF pada file lain tidak menghasilkan whitespace error. |
| Backup, checksum, restore akhir | Archive `.tmp/backups/stage2-final-owners.dump` dipulihkan ke database baru `stage2_restore_owners_20261114`. |
| Kesetaraan hasil restore | Seluruh 56 tabel cocok berdasarkan sorted-row fingerprints: 29 public, 27 auth. Seluruh 150 record metadata ownership, effective ACL dan RLS cocok. ACL default dinormalisasi sebelum dibandingkan. |
| Penolakan operasi tidak aman | Archive korup satu byte, overwrite archive, restore ke target existing dan `postgres` ditolak. |
| Logging | Tes mencakup ID invalid/newline, stream tetap utuh, header immutable, exception tanpa kebocoran, sink gagal, propagasi Auth/RPC, origin/preflight, 413, upstream gagal, URL malformed, dan abort tanpa log ganda. |
| Record runtime | 1.223 event JSON lengkap diperiksa: hanya field allowlist dan UUID kanonis; 287 ID mempunyai lebih dari satu operasi, menghubungkan function dengan panggilan internal. Satu fragmen akhir capture stdout PowerShell dikecualikan karena terpotong. Request lokal tambahan menghasilkan 400 dan ID response sama dengan log gateway. |

Bukti lokal tersimpan di `.tmp/backend-stage2-2026-11-14/`: `backend-regression.log`, `unit-final.log`, `lint-final.log`, `typecheck-final.log`, `build.log`, `restore-drill-final.json`, `verify-final-restore.py`, `gateway-log-check.json`, dan `live-request.json`. Archive/manifest berada dalam `.tmp` yang terverifikasi diabaikan Git; tidak diunggah. Database drill dipertahankan dan database asal tidak ditimpa.

## Penerapan dan batas

Panduan perintah: [backend-operations.md](../backend-operations.md). Gateway lokal telah dimulai ulang dengan kode final. Untuk hosted Edge, deploy keempat fungsi beserta shared module setelah migration tahap 1 tersedia; belum ada perubahan hosted oleh tahap ini. Workflow baru perlu dipush dan dijalankan untuk memperoleh hasil CI nyata.

Backup ini manual dan lokal. Belum ada jadwal/retensi, penyimpanan terenkripsi di luar laptop, hosted PITR atau latihan pemulihan layanan hosted. Archive tidak mencakup global roles, signing keys/config, email, object storage, AI, dan blockchain. Kesetaraan database tidak membuktikan login/sesi hosted akan pulih; kunci/config dan pengujian aplikasi tetap diperlukan. Restore gagal dapat meninggalkan database baru kosong; retry memakai nama baru, tanpa menghapus target secara otomatis. Checksum membuktikan integritas, bukan asal tepercaya archive.

Log stdout belum mempunyai retensi/collector/alert tersendiri. Durasi Edge mengukur eksekusi handler, bukan pengiriman stream. Abort setelah Response dikembalikan tidak terukur oleh wrapper; generic 500 karena exception tak terduga tidak merefleksikan origin CORS sehingga browser mungkin tidak bisa membacanya. ID dari caller bersifat diagnostik dan bisa berulang; jangan gunakan untuk otorisasi/idempotensi. ID diteruskan ke Auth/PostgREST, tetapi tidak otomatis menjamin log upstream menyimpannya, dan tidak diteruskan ke provider AI.

## Cakupan target produk

Skor [audit diagram](2026-11-13-backend-readiness.md) tetap **27/40 = 67,5% (dibulatkan 68%)**. Hardening dan operasi tidak dihitung sebagai use case bisnis baru, sehingga tahap 1/2 tidak menaikkan persentase secara buatan. Angka ini mengukur cakupan fungsional diagram, bukan persentase kesiapan enterprise.

Prioritas backend selanjutnya yang langsung berguna: API jurnal tindakan perawatan dan ekspor/perbandingan histori dengan batas akses owner, pagination/rentang waktu, serta bukti sumber data. Kesiapan enterprise juga membutuhkan isolasi organisasi/tim, provisioning/rotasi kunci perangkat, dan recovery hosted teruji sesuai kebutuhan pelanggan. Implementasi UI serta pilihan vendor/infrastruktur produksi berada di luar tahap ini.

## Batas file

Implementasi tahap 2 berada pada `scripts/database-backup.mjs`, `scripts/backend-gateway.mjs`, `_shared/observability.ts`, empat `index.ts` dan penambahan correlation header di empat `handler.ts`, dua tes baru, workflow Checks, dokumen operasi dan laporan ini. Sebagian file gateway/handler/workflow juga memuat perubahan tahap 1. Perubahan `src`, aset, package files dan tes UI yang dikerjakan paralel dipertahankan; bukan hasil kerja backend tahap 2.
