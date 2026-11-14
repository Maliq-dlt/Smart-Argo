# API lifecycle identitas produk dan kunci perangkat

Kontrak backend tahap 5. UI ditangani terpisah. Gunakan `POST /rest/v1/rpc/<nama>` dengan bearer pengguna, `apikey` publik proyek, dan JSON. Jangan mengirim service-role key atau private key perangkat dari caller.

## Otorisasi

Ketiga RPC tulis memerlukan role `operator` yang diberikan server, sesi aktif, faktor TOTP terverifikasi, AAL2, dan kode TOTP berumur maksimum lima menit. Untuk request baru, urutan lock adalah advisory lock transaction yang dibatasi actor + request UUID, lalu product/device dengan `FOR NO KEY UPDATE`, lalu gate account actor, faktor, dan sesi, sebelum perubahan serta audit. Untuk request historis, setelah advisory lock dan pencarian event, gate dijalankan sebelum hasil awal atau konflik dikembalikan; cabang ini tidak mengambil lock resource bisnis dan tidak melakukan mutasi. Lock resource yang tidak mengubah key tetap kompatibel dengan pemeriksaan foreign key nonce aktivasi; gate request baru dijalankan setelah resource terkunci. Pembacaan histori memerlukan operator, sesi aktif, faktor terverifikasi dan AAL2; tidak memerlukan kode TOTP baru setiap pembacaan.

Seperti RPC lain, HTTP 200 dapat memuat `{ok:false,code,message}`. Caller wajib mengecek `ok`; jangan memakai teks `message` sebagai kontrak. Argumen/tipe yang tidak dapat diparse atau hak execute yang tidak tersedia dapat menghasilkan HTTP 4xx dari PostgREST. Kode domain: `invalid_request`, `invalid_key`, `key_conflict`, `key_unavailable`, `device_unavailable`, `product_unavailable`, `request_conflict`; kode otorisasi: `unauthorized`, `forbidden`, `mfa_required`, `step_up_required`.

## Rotasi kunci perangkat

`operator_rotate_device_key(p_device_id uuid, p_expected_public_key text, p_new_public_key text, p_request_id uuid, p_reason text)`

Caller memasok public key lama yang diharapkan dan public key baru. Pemeriksaan expected key mencegah penimpaan rotasi pihak lain. Public key baru menggunakan Ed25519 raw 32 byte dalam Base64 kanonis. Expected public key lama dibandingkan persis sebagai teks opaque 1 sampai 1000 karakter agar identitas legacy tetap dapat diganti; caller tidak boleh menormalisasi nilainya. Pasangan kunci dibuat dan dipasang di perangkat melalui proses provisioning di luar backend; private key tidak boleh masuk payload, log, atau histori API.

Rotasi adalah pengesahan operator, bukan pembuktian penguasaan private key baru oleh hardware. Backend tidak mengklaim secure element, pairing fisik, kalibrasi, atau keaslian perangkat telah diuji. Operator wajib memastikan pemasangan kunci sebelum memakai identitas baru untuk pengiriman data.

`device_key_history` menyimpan riwayat kunci secara immutable dan public key unik secara global, termasuk yang sudah tidak aktif. Migration memasukkan kunci legacy yang tersedia saat ini; ini bukan rekonstruksi seluruh riwayat kunci sebelum migration. Public key lama tidak dapat dipakai ulang sebagai identitas baru; trigger database juga menegakkan riwayat dan keunikan global pada perubahan kunci berikutnya.

Challenge aktivasi yang masih pending dapat tetap tersimpan. Penyelesaiannya hanya sah dengan signature dari kunci perangkat yang sedang berlaku; rotasi tidak mengaktifkan ulang kode aktivasi yang sudah terpakai. Paket yang diverifikasi memakai kunci lama tetapi menunggu resource lock tidak boleh lolos setelah rotasi: backend mengulang pemeriksaan kunci saat menyimpan.

## Pencabutan

- `operator_revoke_device(p_device_id uuid, p_request_id uuid, p_reason text)`
- `operator_revoke_product(p_product_id uuid, p_request_id uuid, p_reason text)`

Pencabutan mengubah status target dan mencatat alasan serta actor pada audit privat. Status product/device efektif memblokir aktivasi dan ingest telemetri/energi yang bergantung padanya. Tidak perlu mengubah massal status meter energi: meter mempunyai kunci dan lifecycle tersendiri, sedangkan ingest tetap memeriksa status parent product/device.

Tidak ada RPC reaktivasi atau reaktivasi otomatis, perpindahan ownership, penghapusan histori, perubahan ledger, kompensasi reward, atau pengiriman perintah hardware dari operasi ini. Riwayat bukti yang sudah tersimpan tetap dipertahankan. Pencabutan administratif berbeda dari koneksi terputus; jangan otomatis menetapkan status perangkat `offline` berdasarkan last-seen karena status nonaktif akan menolak paket pemulihan berikutnya.

## Retry dan audit

Gunakan satu `p_request_id` UUID untuk satu maksud operasi. Ruang idempotensi adalah actor account + request UUID yang sama untuk ketiga RPC tulis. Perbandingan payload memakai alasan yang dinormalisasi dengan `btrim`; public key lama tetap dibandingkan persis. Payload berbeda, termasuk pemakaian UUID untuk operasi lain, menghasilkan `request_conflict`. Retry payload yang sama mengembalikan hasil awal yang tersimpan, walaupun status/kunci kemudian berubah; keberhasilan retry tidak menerapkan ulang perubahan. Retry tetap harus memenuhi gate otorisasi aktif.

Hasil sukses ketiga operasi:

```text
{ok:true,event_id,action,product_id,device_id,registry_status,device_status,public_key_fingerprint}
```

`action` adalah `rotate_device_key`, `revoke_device`, atau `revoke_product`. `device_id`, `device_status`, dan `public_key_fingerprint` dapat null bila tidak relevan. Tidak ada public key aktual atau identitas pribadi actor pada respons. Fingerprint adalah SHA-256 atas teks public key dalam UTF-8, bukan atas byte hasil decode Base64, sehingga key legacy opaque tetap mempunyai fingerprint yang konsisten.

`registry_event` adalah audit privat yang menyimpan actor, operasi, alasan, public key lama/baru yang relevan, dan hasil awal. `device_key_history` serta audit tidak menyediakan jalur perubahan langsung bagi caller API. Jangan memakai audit privat sebagai endpoint publik atau memasukkan informasi pribadi ke alasan operasi.

## Membaca histori registry

`operator_registry_history(p_product_id uuid, p_before_id bigint DEFAULT NULL, p_limit integer DEFAULT 50)`

Hasil: `{ok:true,events:[{id,action,device_id,reason,created_at,old_key_fingerprint,new_key_fingerprint}],next_cursor}`. `next_cursor` adalah bigint atau null pada akhir histori. Limit 1 sampai 100. Pagination menggunakan ID event menurun dengan batas eksklusif `id < p_before_id`. `next_cursor` berisi ID terakhir yang dikembalikan hanya jika masih ada baris berikutnya; jika tidak, nilainya null. Untuk halaman selanjutnya kirim `next_cursor` sebagai `p_before_id` dan pertahankan product yang sama. Endpoint hanya untuk operator terotorisasi. Tampilan histori memuat fingerprint kunci, bukan public key aktual, identitas pribadi actor, atau data pribadi pemilik. Ini tidak mengubah status registry publik menjadi bukti keaslian fisik.

## Batas penerapan

Kontrak ini tidak menyediakan issuer signing service, verifikasi manifest penerbit, pengiriman kunci privat ke perangkat, pemulihan hardware, atau pembuktian possession kunci baru. Tidak ada guard permanen database yang melarang administrator melakukan repair status; pembatasan reaktivasi berlaku pada API ini. Administrator berprivilege dapat melakukan perbaikan terkontrol atau memperbaiki fixture, dengan tanggung jawab menjaga invariant dan audit. Kunci meter energi tetap terpisah dari kunci perangkat untuk aktivasi/telemetri. Integrasi UI, deployment hosted, dan verifikasi perangkat fisik perlu diperiksa tersendiri; dokumen ini tidak menyatakan pengujian tersebut telah dilakukan.
