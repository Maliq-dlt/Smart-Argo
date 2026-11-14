# Backend tahap 4 — akses operator dan kurator

Tanggal: 14 November 2026 (Asia/Jakarta). Melanjutkan [tahap 3](2026-11-14-backend-stage-3.md). Scope pengguna: bertahap, backend saja; UI menjadi pekerjaan Claude. Tidak menambah dependency.

## Hasil

Role operator atau kurator saja sekarang tidak cukup untuk menggunakan hak istimewa. Pembacaan antrean lintas akun memerlukan sesi Auth aktif, factor TOTP verified dan token AAL2. Tujuh operasi tulis juga memerlukan bukti TOTP dalam lima menit terakhir. Role dan sesi diperiksa kembali setelah menunggu lock, sebelum mutasi atau retry sukses.

**Cakupan diagram tetap 29/40 = 72,5% (~73%)**, mengikuti [rubrik audit awal](2026-11-13-backend-readiness.md) dan hasil tahap 3. Penguatan keamanan ini tidak menyelesaikan use case produk tambahan. APP-04/APP-06 masih parsial: backend jurnal/histori tersedia, integrasi UI belum dilakukan oleh pekerjaan ini. Angka tersebut bukan ukuran kesiapan enterprise, hardware atau deployment hosted.

## Perubahan

- `20261114040000_privileged_access.sql`: helper private `privileged_role_active(text)` untuk read dan `privileged_write_gate(text)` untuk write, serta penggantian dua RPC registrasi/revokasi meter. Session/role/factor berasal dari database, bukan role pada input caller. Bukti `amr` yang kosong, malformed, kedaluwarsa atau bertanggal masa depan ditolak. Freshness memakai `clock_timestamp()` sesudah menunggu lock, bukan waktu awal transaksi.
- `20261114050000_reward_privileges.sql`: gate akhir pada perubahan policy, katalog, fulfillment dan kompensasi. `reward_workspace` memakai role yang tersaring. Alur debit, stok, idempotensi dan ledger dipertahankan.
- `20261114060000_curation_privileges.sql`: filter operator/curator pada `my_curation_roles`, sehingga workspace energi/kurasi dan policy RLS kurasi ikut membatasi scope. Role owner/contributor tetap mengikuti otorisasi biasa. Review memakai gate akhir; larangan self-review dan konflik revisi dipertahankan.
- Fixture energi, reward dan kurasi memakai enrollment/verification TOTP nyata melalui GoTrue. Suite `privileged-access.integration.mjs` ditambahkan pada script backend serial yang sudah dipakai CI.
- [Kontrak akses privileged](../privileged-access.md) mendokumentasikan syarat Auth, tujuh RPC, kode penolakan, step-up dan batas recovery. Tidak menambah endpoint atau UI enrollment.

Gate write bersifat VOLATILE agar query sesudah lock memperoleh snapshot baru. Ia mengunci account actor, factor TOTP terurut, lalu sesi. Urutan factor sebelum sesi mengikuti GoTrue yang melepas factor sebelum menurunkan assurance sesi; review awal menemukan dan memperbaiki potensi deadlock bila urutan dibalik. Fulfillment/kompensasi mengunci actor dan penerima dalam urutan UUID. Review memakai `FOR NO KEY UPDATE` pada profile/contribution agar serialisasi approval tetap ada dan FK key-share submission tidak membuat siklus lock account/profile.

Read privileged tidak mensyaratkan freshness lima menit. Write privileged tidak memakai hold 24 jam; hold pada redemption/transfer tetap kebijakan terpisah. Helper tidak dapat dipanggil langsung oleh anon/authenticated. Semua signature RPC dan grant domain yang sudah ada dipertahankan.

## Verifikasi yang dijalankan

| Command/check | Hasil |
| --- | --- |
| `npm run test:backend` — run terakhir | **95/95 lulus**, 0 fail/skip, sekitar 221 detik. Semua 11 file integrasi berjalan serial. |
| `node --test tests/privileged-access.integration.mjs` | **6/6 lulus**; juga tercakup pada run penuh terakhir. |
| `node --test tests/account-activation.integration.mjs` | **11/11 lulus** pada pengulangan terpisah, kemudian lulus lagi dalam run penuh. |
| `npm test` | **112/112 lulus**, tanpa skip. |
| `npm run lint` | Lulus. ESLint empat file integrasi dijalankan lagi sesudah edit terakhir dan lulus. |
| `npm run typecheck` dan `npm run build` | Lulus. Build masih memberi warning font runtime dan chunk >500 kB pada frontend yang sudah ada. |
| `git diff --check` dan pemeriksaan whitespace file baru | Lulus; Git memberi peringatan normalisasi LF/CRLF pada beberapa file existing. |
| Fresh migration check | **18 migrasi** diterapkan dari nol ke `stage4_fresh_0e79a3d4c75b`; 29 tabel domain seluruhnya RLS, Auth kosong, helper private, tujuh RPC tetap authenticated-only. Hash migration cocok dengan source akhir. DB dipertahankan. |
| Ledger stack lokal | Seluruh 18 migrasi tercatat. Tiga migrasi tahap 4 beserta ledger dan NOTIFY schema diterapkan secara transaksional. |
| `npm audit --json` | Exit 1: **0 critical, 0 high, 7 entri paket moderate** pada rantai dev tooling `typescript-eslint`/`minimatch`. Bukan hasil bersih; tidak menjalankan forced remediation. |

Run penuh pertama menghasilkan 92/95 lulus: dua subtest aktivasi timeout dan parent suite ikut gagal. Durasi request mencapai sekitar 29 dan 26 menit. Windows Kernel-Power/Power-Troubleshooter mencatat Modern Standby dan sleep/resume pada interval yang sama; gateway juga mencatat jeda tersebut. Pengulangan aktivasi dan run penuh terakhir lulus tanpa perubahan kode atau timeout. Log kegagalan awal tetap disimpan, tidak digabung sebagai hasil lulus.

Suite keamanan membuktikan role tanpa MFA ditolak pada ketujuh operasi valid; token AAL1 lama ditolak; missing/object/empty/malformed/future/stale AMR ditolak; scope read AAL2 tetap tersedia setelah freshness write habis; antrean lintas akun dan RLS disaring; owner/contributor tetap bekerja; dan helper tidak dapat dipanggil langsung. Uji konkurensi menahan lock PostgreSQL secara deterministik, mencabut role/sesi saat RPC menunggu, lalu membuktikan meter tetap active. Uji urutan pelepasan factor menggunakan transaksi lokal factor DELETE lalu session downgrade untuk meniru urutan GoTrue; request menolak tanpa deadlock. Ini bukan uji UI unenrollment hosted.

Auth signup, TOTP verification, PostgREST, gateway dan transaksi PostgreSQL dijalankan nyata secara lokal. Account dengan role khusus, meter, profile dan bukti agronomi dibuat sebagai fixture sintetis melalui admin lokal. Pengujian tidak membuktikan akurasi sensor atau agronomi, kalibrasi fisik, kompetensi kurator, provider AI berbayar atau performa enterprise.

Bukti tersimpan di `.tmp/backend-stage4-2026-11-14/`: `backend-final.log`, `backend-initial-timeouts.log`, `activation-rerun.log`, `privileged-targeted.log`, `unit-final.log`, `lint-final.log`, `typecheck-final.log`, `build-final.log`, `fresh-migrations-result.json`, `verify-fresh-migrations.py`, `apply-migrations.log`, `dependency-audit.json`, `sleep-events.json` dan `source-hashes.json`.

## Penerapan dan batas

Perubahan sudah diterapkan pada stack lokal. Tidak ada push, deployment Edge/schema Supabase cloud, atau perubahan UI dari tahap ini. Perubahan UI/aset/dependency Claude pada working tree dipertahankan; delta tahap 4 pada `package.json` hanya penambahan suite pada `test:backend`. Riwayat kerja tahap 1–3 yang belum di-commit juga dipertahankan.

Urutan rilis: pastikan tahap sebelumnya tersedia, terapkan migration `20261114040000`, `20261114050000`, lalu `20261114060000`, reload schema PostgREST, dan gunakan token AAL2 hasil challenge/verify TOTP. Fresh TOTP diperlukan lagi setelah lima menit untuk write. Tetapkan prosedur recovery authenticator dan verifikasi account operator/kurator hosted sebelum menerapkan kebijakan pada layanan aktif. Belum ada hasil GitHub Actions untuk perubahan ini.

Advisory dev tooling yang dilaporkan audit adalah [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): potensi DoS pada pemrosesan glob minimatch. Jalurnya melalui alat lint di devDependencies; backend tidak menerima glob caller melalui jalur ini. Pembaruan tooling/lockfile ditunda ke perubahan terpisah agar tidak menimpa dependency yang sedang dikerjakan Claude atau memakai saran downgrade major otomatis. Tinjau paling lambat 21 November 2026 atau sebelum rilis, mana yang lebih awal. Audit advisory tidak menggantikan review keamanan aplikasi.

Prioritas backend berikut yang relevan untuk pilot: lifecycle credential perangkat (provisioning, rotasi, revokasi operasional), lalu monitoring perangkat offline dan retensi data. Isolasi organisasi/tim tetap kebutuhan enterprise terpisah. Fitur tersebut belum diimplementasikan oleh tahap ini.

## Batas file tahap 4

- Tiga migration baru `20261114040000`/`20261114050000`/`20261114060000`.
- Perubahan fixture pada `tests/energy.integration.mjs`, `tests/reward.integration.mjs`, `tests/curation.integration.mjs` dan suite baru `tests/privileged-access.integration.mjs`.
- Satu baris script `test:backend` pada `package.json`.
- `docs/privileged-access.md` dan laporan ini.
