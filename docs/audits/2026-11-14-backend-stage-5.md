# Backend tahap 5 — rotasi dan pencabutan identitas perangkat

Tanggal: 14 November 2026 (Asia/Jakarta). Melanjutkan [tahap 4](2026-11-14-backend-stage-4.md). Scope pengguna tetap backend saja; UI dikerjakan Claude. Tidak menambah dependency atau mengubah handler/format paket ingest.

## Hasil

Operator sekarang dapat merotasi public key perangkat, mencabut perangkat, dan mencabut produk melalui RPC dengan TOTP baru, request UUID dan alasan. Audit immutable menyimpan actor, payload dan hasil awal; histori public key menjaga bukti tanda tangan lama serta menolak penggunaan ulang kunci antarperangkat.

**Cakupan diagram tetap 29/40 = 72,5% (~73%).** Tahap ini memperkuat backend ID-05 dan pemeliharaan identitas. UI operator dan penerapan hosted belum dilakukan; ID-04 belum mempunyai issuer manifest/provisioning yang terverifikasi. Angka tersebut tetap bukan persentase kesiapan enterprise atau hardware.

## Implementasi dan kontrak

Satu migration baru, `20261114070000_device_lifecycle.sql`, menambah `device_key_history` dan `registry_event`, keduanya RLS/private. Trigger mencatat kunci dari provisioning/perubahan berikutnya; primary key public key menolak reuse global antarperangkat, termasuk kunci yang retired. Legacy seed hanya memuat kunci yang diketahui saat migration, bukan rekonstruksi rotasi sebelum itu. Audit dan key history tidak dapat diubah/dihapus melalui jalur aplikasi.

Tiga RPC tulis adalah `operator_rotate_device_key`, `operator_revoke_device`, dan `operator_revoke_product`; `operator_registry_history` membaca audit dengan pagination ID menurun, maksimal 100 event. Respons hanya memuat fingerprint kunci; identitas actor, request payload dan public key aktual tetap privat. Fingerprint adalah SHA256 atas teks UTF-8 public key agar legacy key dapat diidentifikasi konsisten.

Semua mutasi memakai helper privat terbatas pada tiga operasi tersebut. Request ID unik per actor dipakai bersama lintas operasi. Advisory lock actor/request didapat lebih dulu. Request yang sudah tercatat menjalankan gate otorisasi lalu langsung mengembalikan hasil awal atau conflict, tanpa mengambil resource lock atau menerapkan mutasi lagi. Request baru mengunci product/device `FOR NO KEY UPDATE`, lalu gate operator/TOTP dan mutasi beserta audit dalam satu transaksi. Urutan ini kompatibel dengan FK nonce yang dibuat ketika issuer account terkunci; upgrade lock public key dilakukan sesudah gate.

Rotasi memakai expected-current-key agar perubahan bersamaan dari kunci lama yang sama hanya mempunyai satu pemenang. New key harus raw 32 byte Base64 kanonis, belum pernah terdaftar. Unique constraint menjadi arbiter ketika dua perangkat memilih key yang sama; kegagalan tersebut membatalkan subtransaksi perubahan key. Kegagalan audit membatalkan seluruh mutasi beserta key history. Retry sukses tetap memerlukan sesi/role/MFA saat ini dan mengembalikan hasil historis, walau kunci atau status sudah berubah sesudahnya.

Pemeriksaan final claim/telemetry/energy yang sudah ada kembali memeriksa key/status di bawah lock yang sama. Karena itu request yang telanjur diverifikasi memakai key lama tidak dapat disimpan setelah rotasi menang. Pending nonce tidak dihapus; challenge hanya dapat diselesaikan dengan signature key yang sedang berlaku. Tidak ada reset ownership, boot/sequence deduplication atau kode aktivasi.

Revokasi mengubah status target saja. Product/device yang revoked efektif memblokir aktivasi dan ingest yang bergantung padanya. Meter energi mempunyai key terpisah; registrasi meter, ownership, measurement, ledger dan bukti historis tidak ditulis ulang atau dihapus. Tidak ada RPC reaktivasi atau perintah hardware. Admin database tetap merupakan trust boundary di luar API ini.

Kontrak argumen, hasil, error, retry dan batas operasional tersedia di [API lifecycle](../device-lifecycle-api.md).

## Verifikasi yang dijalankan

| Command/check | Hasil |
| --- | --- |
| `npm run test:backend` | **106/106 lulus**, tanpa fail/skip, sekitar 275 detik; 12 file integrasi berjalan serial. |
| `node --test tests/device-lifecycle.integration.mjs` | **11/11 lulus** pada run khusus; lulus lagi dalam run penuh. |
| `npm test` | **112/112 lulus**, tanpa skip. |
| `npm run lint` | Lulus. ESLint file integrasi baru juga lulus sesudah edit terakhir. |
| `npm run typecheck` dan `npm run build` | Lulus; warning frontend untuk font runtime dan chunk >500 kB tetap ada. |
| `git diff --check` dan whitespace file baru | Lulus; beberapa file existing memberi peringatan normalisasi LF/CRLF. |
| Fresh migration check | **19 migrasi** dipasang dari nol ke `stage5_fresh_a7c0d319964a`; **31 tabel domain seluruhnya RLS**; helper privat, empat RPC authenticated-only, tabel audit/key history tertutup dari caller, trigger history aktif. Auth fresh DB kosong; database dipertahankan. |
| `npm audit --json` | Exit 1: 0 critical, 0 high, **7 entri paket moderate** pada rantai tooling lint `typescript-eslint`/`minimatch`, sama seperti tahap 4. Tidak menjalankan forced remediation. |

Suite baru menjalankan signature Ed25519, Auth, TOTP verification, PostgREST dan transaksi lokal nyata. Cakupan: canonical/invalid/current/retired/cross-device key, concurrent exact retry dan CAS, payload conflict lintas operasi, replay hasil setelah rotasi/revokasi, old-key ingest/finalization ditolak, new-key ingest dan pending claim berhasil, transfer mengisolasi ownership epoch, revoke memblokir telemetry/energy dan memperbarui status publik tanpa identitas pemilik. Audit pagination dan immutability diuji.

Uji kegagalan audit memastikan key dan key-history ikut rollback, lalu request yang sama berhasil setelah fault injection dilepas. Uji lock deterministik membuktikan FK nonce tidak deadlock dengan maintenance yang menunggu issuer account; pencabutan role/sesi saat menunggu product mencegah mutasi dan audit. Registrasi perangkat baru dengan kunci retired juga ditolak oleh trigger/constraint. Fixture registry, agronomi dan meter tetap sintetis; tidak ada pengujian perangkat fisik atau kalibrasi.

Bukti berada di `.tmp/backend-stage5-2026-11-14/`: `backend-final.log`, `lifecycle-targeted.log`, `unit-final.log`, `lint-final.log`, `typecheck-final.log`, `build-final.log`, `dependency-audit.json`, `fresh-migrations-result.json`, `verify-fresh-migrations.py`, `apply-migration.log`, `local-migration-ledger.log`, dan `source-hashes.json`.

## Penerapan dan batas

Migration sudah diterapkan secara transaksional pada stack lokal bersama ledger dan schema notification. Tidak ada push, perubahan schema/data bisnis Supabase cloud, atau deployment Edge. Tidak ada perubahan UI, dependency baru, atau penimpaan pekerjaan Claude. Perubahan tahap 1–4 yang belum di-commit tetap dipertahankan.

Untuk rilis hosted: pastikan migrasi sebelumnya lengkap, apply `20261114070000_device_lifecycle.sql`, reload schema PostgREST, lalu uji dengan operator AAL2 dan TOTP segar. Tidak perlu mengubah format paket atau handler Edge untuk gate key/status yang ada. Belum ada hasil GitHub Actions untuk perubahan ini.

Rotasi ini adalah pengesahan operator, **bukan proof of possession private key baru, keaslian hardware, atau verifikasi issuer manifest**. Pemasangan pasangan kunci baru pada perangkat dilakukan di luar backend; salah memasang key dapat menghentikan pengiriman data. Private key tidak dikirim ke API. Dedicated meter key dan kalibrasinya tetap terpisah. Riwayat sebelum migration sebatas key yang masih tersimpan saat seed; tidak mengklaim provenance yang hilang dapat dipulihkan. Sequence event memakai bigint native; caller yang kelak mencapai ID di luar batas integer presisi JavaScript perlu mempertahankan representasi string/desimal.

Temuan moderate tooling mengikuti triase dan tenggat review tahap 4 (21 November 2026 atau sebelum rilis). Native audit tersebut bukan hasil security scan aplikasi yang menyeluruh. Tidak ada klaim kesiapan enterprise, multi-tenant organization, retensi otomatis, atau recovery hardware telah selesai.

Prioritas backend berikutnya yang relevan: monitoring last-seen/offline secara read-only, dengan status koneksi terpisah dari revokasi administratif. Otomatis menandai `device.status='offline'` akan menolak paket saat perangkat kembali; jangan memakai status tersebut sebagai pengukur kesehatan koneksi.

## Batas file tahap 5

- `supabase/migrations/20261114070000_device_lifecycle.sql`.
- `tests/device-lifecycle.integration.mjs`.
- Penambahan satu suite pada satu baris `test:backend` di `package.json`.
- `docs/device-lifecycle-api.md` dan laporan ini.
