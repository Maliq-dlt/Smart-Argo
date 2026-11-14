# Backend tahap 3 — jurnal perawatan dan histori akun

Tanggal: 14 November 2026 (Asia/Jakarta). Melanjutkan [tahap 2](2026-11-14-backend-stage-2.md). Scope dari pengguna: backend saja; UI dikerjakan Claude. Tidak menambah dependency.

## Hasil untuk pengguna

Backend akun sekarang dapat menyimpan catatan siraman, pupuk, pemeriksaan dan catatan umum; membaca histori sensor dengan pagination; membandingkan dua periode; serta mengunduh CSV pengukuran. Catatan perawatan manual tidak mengubah data sensor atau memberi kredit reward. Kedua alur baru siap dipanggil UI melalui [kontrak API](../care-history-api.md); frontend belum dihubungkan oleh pekerjaan ini.

**Cakupan produk terhadap 20 use case diagram naik dari 27/40 (67,5%) menjadi 29/40 (72,5%, dibulatkan 73%).** Rubrik tetap sama dengan [audit awal](2026-11-13-backend-readiness.md). APP-04 dan APP-06 masing-masing naik dari 0 menjadi 1: backend persisten dan tes lokal tersedia, integrasi UI masih belum ada. Hasil baru: 9 tersedia ×2 +11 parsial ×1 +0 belum ×0. Tidak menaikkan keduanya menjadi2 hanya karena API selesai. Angka ini bukan persentase kesiapan enterprise/hardware atau deployment hosted.

## Implementasi

- Migration `20261114020000_care_journal.sql`: satu tabel privat dengan RLS/no direct caller grants; RPC `append_my_care_journal` dan `read_my_care_journal`. Waktu/jenis/jumlah/catatan divalidasi, author diturunkan dari sesi, record terikat ownership aktif. Request UUID unik per account menjaga idempotensi; payload valid yang berubah ditolak. Batas20 entry baru/menit/account lintas produk, retry tepat dikecualikan. Pagination tuple timestamp/UUID, maksimal100/rentang31hari, snapshot menahan catatan backdated yang baru masuk. Akses caller bersifat append-only.
- Migration `20261114030000_history_reporting.sql`: indeks pagination pengukuran; RPC `read_my_measurement_history` maksimal500/rentang31hari; cursor harus memuat snapshot dan merujuk data unit/rentang yang sama. Product/account/session locks menjaga urutan dengan ingestion/transfer. Filter waktu observasi serta penerimaan melindungi data pemilik sebelumnya.
- RPC `compare_my_measurement_history`: dua rentang nonoverlap, masing-masing maksimal31hari; gabungan maksimal20000 measurement, kelebihan ditolak. Count quality dan unsynced tetap dilaporkan. Min/max/avg hanya dari sumber device, qualityok, clock synced dan nilai finite. Data kosong/gagal tidak menjadi nol; `avg_delta` null jika salah satu periode tidak mempunyai data eligible.
- Edge `history-export`: Auth memvalidasi caller, setiap halaman RPC memakai bearer asli pengguna agar gate sesi/MFA/ownership tetap berlaku. File CSV berkolom tetap, UTF-8 BOM, CRLF, quote escaping, proteksi formula spreadsheet, filename konstan, no-store/nosniff. Maksimal10halaman/5000baris/4MiB dan deadline fetch15detik; kelebihan menghasilkan error tanpa file parsial. Tidak mengekspor payload/signature/publickey/accountPII.
- Gateway mendaftarkan fungsi kelima, meneruskan header unduhan/metadata; observability mengenal operasi `history-export`. `supabase/config.toml` mencatat validasi JWT di handler. Script `npm run test:backend` ditambah dua suite baru, sehingga job CI backend yang sudah ada ikut menjalankannya. Perubahan milik tahap3 pada `package.json` hanya baris script tersebut; dependency changes yang tampak pada working tree milik pekerjaan Claude sebelumnya dipertahankan.

Rentang seluruh API memakai [from,to). Catatan watering mewajibkan jumlahml; jenis lain hanya notes. Batas ini dan normalisasi timestamp/notes/CSV diuraikan dalam kontrak API, termasuk error domain RPC yang tetap mengikuti konvensi `{ok:false,code,message}` pada HTTP200.

## Verifikasi nyata

| Command/check | Hasil |
| --- | --- |
| `npm run test:backend` | **88/88 lulus**, tanpa skip, sekitar201detik. Mencakup delapan suite lama dan dua suite jurnal/histori baru. |
| `npm test` | **112/112 lulus**, tanpa skip; empat tes export baru termasuk batas jumlah/byte, snapshot berubah, data malformed, token caller, CSV formula/quote/newline dan null/nol. |
| `npm run lint` | Lulus. |
| `npm run typecheck` dan typecheck di `npm run build` | Lulus. |
| `npm run build` | Lulus; warning yang sudah ada untuk font yang diselesaikan runtime dan chunk >500kB tetap ada. |
| `git diff --check` | Lulus; peringatan LF/CRLF pada file lain dicatat sebagai normalisasi line ending. |
| Fresh migration check | Seluruh **15 migrasi** diterapkan dari nol ke DB independen `stage3_fresh_9918f1cfc735`;29tabel domain seluruhnya RLS; grants RPC dan privasi tabel jurnal serta indeks diuji. Auth testDB kosong. Hash SHA256 setiap migration disimpan. |
| Integrasi fitur baru | Care8/8 dan history/CSV7/7 termasuk dalam run akhir88: concurrent exact retry/conflict, quota lintas produk, batas input, paging timestamp ties, snapshot backdated, MFA nyata lewat GoTrue, sesi dicabut, transfer aktual dan isolasi kedua timestamp pengukuran. |
| File CSV melalui HTTP sebenarnya | Content-disposition/metadata,14kolom, jumlahreading, null/error kosong vs nol aktual, denial anonymous/nonowner/MFA/revocation, formerowner dan file header-only recipient diuji pada gateway/Auth/PostgREST lokal. |
| Review | Dua review read-only terhadap akses, grants, locking, field log/CSV dan konsistensi kontrak tidak menemukan blocker tambahan; catatan kontrak range/snapshot/delta diperbaiki sebelum run akhir. |

Suite memakai fixture lokal dan kunci synthetic yang diberi label; sebagian setup registry/profile/ownership dibuat dengan SQL admin lokal. Signature ingest, Auth, transaksi, MFA dan transfer API yang disebut di atas dijalankan sebenarnya. Ini bukan uji sensor fisik, provider AI berbayar, login Google interaktif, load test ataupun uji browser UI.

Bukti berada di `.tmp/backend-stage3-2026-11-14/`: `backend-final.log`, `unit-final.log`, `lint-final.log`, `build-final.log`, `fresh-migrations-result.json`, `verify-fresh-migrations.py`, `logging-summary.json`, dan `source-hashes.json`. Gateway capture memakai append file sink di launcher uji dalam `.tmp`; format access log tetap field allowlist. Source DB lokal menerima migration dan fixture uji; database pengguna tidak dihapus atau ditimpa. Fresh DB dipertahankan.

## Penerapan dan batas pekerjaan

Dua migration sudah diterapkan pada stack lokal dan dicatat dalam migration ledger secara transaksional. Gateway lokal dimulai ulang dengan handler baru. Tidak ada push, deployment Edge, perubahan schema/data bisnis Supabase cloud, atau UI yang dikerjakan tahap3.

Urutan rilis: pastikan migration sebelumnya termasuk tahap1 tersedia → apply `20261114020000_care_journal.sql` dan `20261114030000_history_reporting.sql` → reload schema PostgREST → deploy `history-export` beserta shared code → Claude menghubungkan UI sesuai kontrak. Jangan memasang handler sebelum RPC tersedia. Belum ada hasil GitHub Actions untuk perubahan ini.

Ekspor dibatasi sinkron; bila kebutuhan nyata melebihi5000baris/4MiB, pertimbangkan job ekspor dengan batas akses dan penyimpanan privat. Snapshot berbasis timestamp yang diserialisasi dengan ingestion normal bukan retained MVCC snapshot terhadap perubahan privileged manual. Belum ada retensi/hapus jurnal otomatis atau versi terstruktur untuk koreksi; caller dapat menambah note koreksi. Pengaturan recovery/PITR hosted dan isolasi organisasi/tim masih mengikuti kebutuhan pilot/enterprise yang dibahas audit awal. Tidak ada klaim keduanya sudah selesai.

## Batas file milik tahap3

- Dua migration baru `20261114020000`/`20261114030000`.
- `supabase/functions/history-export/handler.ts` dan `index.ts`.
- Tambahan rute/header pada `scripts/backend-gateway.mjs`, satu operation pada `_shared/observability.ts`, satu config fungsi di `supabase/config.toml`.
- `tests/care-journal.integration.mjs`, `tests/history-reporting.integration.mjs`, `tests/historyExport.test.ts`, tambahan dua suite pada satu baris script `package.json`.
- `docs/care-history-api.md` dan laporan ini.

Perubahan UI/aset/dependency dan dokumen lain dari pekerjaan paralel tetap dipertahankan. Tahap1/2 belum di-commit sehingga diff gabungan beberapa file juga memuat perbaikan sebelumnya; daftar ini menjelaskan delta tahap3.
