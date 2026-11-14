# API jurnal perawatan dan histori akun

Kontrak backend tahap 3, 14 November 2026. Gunakan base URL Supabase/gateway yang dikonfigurasi. Semua request memakai `Authorization: Bearer <access_token>`, `apikey` publik proyek, dan `Content-Type: application/json`. Jangan mengirim service-role key dari browser. UI dikerjakan terpisah oleh Claude.

## Otorisasi dan error

RPC PostgreSQL memeriksa sesi aktif, MFA bila factor sudah terverifikasi, dan ownership aktif pada tiap panggilan. Record jurnal terikat ID ownership saat dibuat. Pengukuran harus mempunyai waktu observasi **dan** penerimaan sesudah awal ownership aktif. Pemilik baru mulai dengan histori privat kosong; pemilik lama kehilangan akses. Timestamp disimpan sebagai `timestamptz`; semua rentang memakai **[from,to)** dan maksimum 31 hari.

Ikuti pola RPC yang sudah ada: hasil domain HTTP 200 dapat berisi `{ "ok": false, "code": "...", "message": "..." }`. Caller wajib mengecek `ok`. UUID/tipe timestamp yang tidak dapat diparse, argumen RPC yang tidak dikenal dan role tanpa execute dapat ditolak PostgREST dengan HTTP 4xx. Jangan bergantung pada teks `message`.

Kode jurnal: `unauthorized`, `unit_unavailable`, `invalid_request`, `request_conflict`, `rate_limited`. Kode histori/perbandingan: `unauthorized`, `unit_unavailable`, `invalid_range`, `invalid_cursor`, `range_too_large`. Keberadaan ID unit milik orang lain tidak memberi akses ke datanya.

## Menulis jurnal

`POST /rest/v1/rpc/append_my_care_journal`

```json
{
  "p_unit_id": "<uuid unit>",
  "p_request_id": "<uuid baru untuk satu tindakan>",
  "p_kind": "watering",
  "p_observed_at": "2026-11-14T01:00:00.000Z",
  "p_amount_ml": 200,
  "p_notes": "Siraman manual setelah pemeriksaan media."
}
```

`p_kind`: `watering`, `fertilizing`, `inspection`, `note`. Watering wajib mempunyai `p_amount_ml` >0 dan <=100000; jenis lainnya memakai null/argumen tidak diisi. Notes di-trim, maksimum 2000 karakter/8000 byte; wajib terisi untuk `note`. Timestamp harus finite, sejak awal ownership aktif, maksimum lima menit di masa depan. Tidak ada argumen author/account/ownership dari caller.

Simpan satu `p_request_id` untuk satu maksud tindakan dan gunakan kembali saat retry. Kombinasi account+request unik; payload sama mengembalikan record awal dengan `idempotent: true`. Payload valid yang berbeda menghasilkan `request_conflict`; perbandingan notes memakai hasil trim. Retry tetap memerlukan sesi sah dan ownership yang sama. Hasil normal: `{ok:true, entry:{id,unit_id,kind,observed_at,created_at,amount_ml,notes}, idempotent:false}`. Maksimum 20 entry baru/menit/account, termasuk lintas produk; retry tepat tidak memakai slot baru.

Jurnal bersifat append-only bagi caller API. Tindakan ini menyimpan laporan pengguna; tidak mengubah pengukuran, menyalakan pompa, mengubah prediksi, ataupun memberi kredit reward. Untuk koreksi, tambahkan catatan baru dengan konteks koreksinya. Catatan mundur waktunya tetap dibatasi periode ownership.

## Membaca jurnal

`POST /rest/v1/rpc/read_my_care_journal`

Argumen: `p_unit_id` wajib; `p_from`, `p_to`, `p_snapshot_as_of`, `p_before_observed_at`, `p_before_id` opsional; `p_limit` default50, rentang1–100. Default `to` adalah snapshot server dan `from=to-31hari`. Hasil `{ok:true,entries:[...],snapshot_as_of,next_cursor:{observed_at,id}|null}`.

Urut menurun berdasarkan `(observed_at,id)`. Untuk halaman berikutnya pertahankan filter semula dan `snapshot_as_of`, lalu isi kedua cursor dari `next_cursor`. Snapshot membatasi `created_at`, sehingga entry baru yang di-backdate tidak masuk ke pagination yang sedang berlangsung. Timestamp/UUID cursor harus dikirim berpasangan. Null `next_cursor` menandai akhir halaman.

## Histori sensor

`POST /rest/v1/rpc/read_my_measurement_history`

Argumen wajib: `p_unit_id`, `p_from`, `p_to`. Opsional: `p_limit` default100,1–500; `p_cursor_at`, `p_cursor_id`, `p_snapshot_as_of`. Cursor memerlukan snapshot dan harus merujuk pengukuran di unit/rentang/cutoff yang sama.

Hasil `{ok:true,unit_id,from,to,snapshot_as_of,readings:[...],next_cursor:{measured_at,id}|null}`. Untuk halaman berikutnya pertahankan unit/rentang/snapshot, lalu kirim `p_cursor_at=next_cursor.measured_at` dan `p_cursor_id=next_cursor.id`.

Setiap reading: `id`, `unit_id`, `device_id`, `packet_id`, `sensor_id`, `quality_status`, `value_nullable`, `error_message`, `measured_at`, `received_at`, `source`, `clock_status`, `sequence`, `boot_id`. Data berasal dari ingest perangkat bertanda tangan. Nilai null tetap null; gagal ukur tidak menjadi nol. Payload asli, signature dan public key tidak diekspos oleh endpoint ini.

Cutoff berdasarkan waktu penerimaan server, diambil setelah product lock yang dipakai ingestion/transfer. Ingestion normal yang baru selesai sesudah snapshot tidak masuk halaman berikutnya. Ini bukan snapshot MVCC tersimpan terhadap perubahan manual oleh administrator. Privileged maintenance harus menjaga invariant dan kesesuaian timestamp.

## Perbandingan dua periode

`POST /rest/v1/rpc/compare_my_measurement_history`

Argumen wajib `p_unit_id`, `p_first_from`, `p_first_to`, `p_second_from`, `p_second_to`; opsional `p_snapshot_as_of`. Kedua rentang wajib tidak overlap, masing-masing <=31 hari. Maksimum gabungan20000 measurement; bila lebih besar, API menolak dengan `range_too_large` dan caller perlu memperkecil rentang.

Hasil memuat unit/rentang/snapshot dan `sensors:[{sensor_id,first,second,avg_delta}]`. Tiap sisi mempunyai `total_count`, `ok_count`, `error_count`, `not_measured_count`, `unsynced_count`, `eligible_count`, `min`, `max`, `avg`. Statistik numerik hanya memakai nilai finite dari sumber device, quality `ok`, clock `synced`. `unsynced_count` bisa beririsan dengan kelompok quality. Periode tanpa bukti eligible menghasilkan null pada statistik; `avg_delta=second.avg-first.avg` bernilai numerik bila keduanya punya data eligible, dan null bila salah satu tidak punya. Selisih rata-rata adalah deskripsi data; bukan bukti tindakan perawatan menyebabkan perubahan.

## File CSV

`POST /functions/v1/history-export`

```json
{
  "unit_id": "<uuid unit>",
  "from": "2026-11-01T00:00:00.000Z",
  "to": "2026-11-02T00:00:00.000Z"
}
```

Untuk Edge export, `from/to` harus UTC kanonis persis format `YYYY-MM-DDTHH:mm:ss.sssZ`; pilih rentang <=31 hari. Maksimum4096 byte body. `x-request-id` opsional mengikuti aturan logging tahap2.

HTTP200 menghasilkan `text/csv; charset=utf-8`, UTF-8 BOM, CRLF, `Content-Disposition: attachment; filename="smart-agro-history.csv"`, `Cache-Control:no-store`, dan `X-Content-Type-Options:nosniff`. Header `x-history-row-count` menyatakan jumlah reading dan `x-history-snapshot-as-of` menyatakan cutoff; keduanya diekspos untuk origin browser yang diizinkan. Kolom tetap: `id,unit_id,device_id,packet_id,sensor_id,source,quality_status,value_nullable,error_message,measured_at,received_at,clock_status,sequence,boot_id`.

Null menjadi sel kosong; nol tetap angka nol. Nilai string yang dapat dibaca spreadsheet sebagai formula diberi prefiks apostrof; quote/newline di-escape. Field teks yang diawali apostrof proteksi perlu dipertahankan saat impor. Hanya kolom tetap yang diekspor.

Ekspor memakai beberapa halaman RPC dengan bearer pengguna asli dan satu cutoff, maksimum10 halaman,5000 baris atau4MiB, deadline fetch gabungan15detik. Batas terlampaui menghasilkan HTTP413 `export_too_large`; tidak ada file parsial. HTTP401 untuk sesi/MFA,403 untuk unit tak berhak,400/405/415 untuk input/method/content-type dan503 untuk gangguan upstream. File kosong tetap berisi header CSV. Body error mengikuti `{ok:false,code,message}`.

## Penerapan dan verifikasi

Terapkan migration tahap1/2 yang menjadi prasyarat, lalu `20261114020000_care_journal.sql` dan `20261114030000_history_reporting.sql`, reload schema PostgREST, kemudian deploy `history-export` beserta `_shared/observability.ts`. `supabase/config.toml` mematikan gateway JWT check fungsi tersebut karena handler memvalidasi token melalui Auth dan RPC mengulang gate sesi/MFA/ownership. Gateway lokal sudah mendaftarkan rute baru; image Docker menyalin direktori functions yang sama.

`npm run test:backend` mencakup suite jurnal dan histori/CSV; `npm test` mencakup validasi dan batas export. Belum ada UI, deployment hosted, export job asinkron, retensi/hapus jurnal otomatis, atau klaim perangkat fisik diuji dari tahap ini. File CSV yang diunduh berisi data sensor privat; keputusan penyimpanan setelah unduh berada pada pemilik file.
