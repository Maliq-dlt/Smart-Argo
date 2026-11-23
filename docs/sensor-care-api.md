# API perawatan Smart Agro untuk web dan Android

Setelah sesi aktif dan `ensure_my_account` berhasil, gunakan `POST /rest/v1/rpc/<nama>` dengan JSON, `apikey` publik dan token pengguna di `Authorization: Bearer …`. Periksa `ok` pada hasil RPC. Kode `unauthorized` berarti sesi sudah tidak berlaku, `account_required` berarti akun belum dibuat, dan `unit_unavailable` berarti unit tidak tersedia bagi pengguna. Semua waktu peristiwa memakai ISO 8601 dengan offset.

## Ringkasan, perkiraan dan usulan

| RPC dan argumen | Hasil saat berhasil |
| --- | --- |
| `my_overview()` | `{ok,plants,devices:{total,issues}}`. Satu elemen per siklus tanaman aktif, dengan `slot_id, unit_id, name, tag, species_id, place, moisture, measured_at, band, band_source, state, outlook`. `tag` misalnya `CB-12`. `band_source` (juga di dalam `outlook`) sama dengan milik `my_watering_outlook`. Status tanaman dapat berupa `below`, `ok`, `above`, `learning`, `no_reading`, atau `no_device`. Masalah perangkat memakai `unit_id,device_id,kind,since,detail` dengan jenis `battery_low`, `gap`, atau `silent`. `gap` hanya muncul bila ada sedikitnya tiga jeda kiriman lebih dari 90 menit dalam 7 hari (tanda sinyal Wi-Fi lemah di tempat pot); `since` = awal jeda pertama, `detail` = `{count,last_resumed_at}`. Jeda tunggal yang sudah pulih hanya ada di `upload_gaps` milik `my_unit_health`. Akun baru memperoleh daftar kosong. |
| `set_my_slot_unit(p_slot_id,p_unit_id)` | Menghubungkan slot milik pengguna dengan unit aktif miliknya. Kirim `p_unit_id:null` untuk melepas. Jika unit sudah terhubung ke slot lain, respons berisi `unit_already_assigned`. Lepaskan dari slot lama dahulu. |
| `my_watering_outlook(p_unit_id,p_timezone?)` | `{ok,outlook:{state,since,from,to,rate_per_hour,band,band_source}}`. Nilai yang belum tersedia adalah `null`. `band_source` bernilai `profile` (profil kurasi yang divalidasi untuk pot ini; label "Profil kurasi untuk pot ini"), `own_pattern` (pola pot itu sendiri; label "Berdasarkan pola pot Anda"), atau `null` selama pita belum ada. Zona IANA bawaan `Asia/Jakarta` sama dengan Ringkasan. Laju dinyatakan dalam poin indeks kelembapan per jam. |
| `my_unlogged_rises(p_unit_id,p_days?)` | `{ok,rises:[{from,to,delta}]}`. Pilih 1–30 hari, bawaan 3. Satu usulan mewakili kenaikan beruntun minimal lima poin. Bacaan gagal dan jeda lebih dari dua jam memutus rangkaian. Siram tercatat dalam jarak dua jam dari rentang kenaikan menyaring usulan. |
| `dismiss_my_rise(p_unit_id,p_at)` | Kirim waktu `to` dari usulan. Pengabaian berlaku untuk akun, kepemilikan, unit dan probe tersebut di web serta Android. Pengulangan untuk peristiwa yang sama aman. Pembacaan dan pengabaian usulan tidak membuat entri jurnal. |

Pita kelembapan berasal dari profil terbit yang sudah divalidasi untuk pot tersebut. Profil tervalidasi terikat pada kalibrasi sensor satu pot, sehingga tidak dipinjam pot lain. Tanpa profil seperti itu, apa pun spesiesnya (termasuk cabai dan bawang merah), pita baru terbentuk setelah ambang Fase 5 terpenuhi pada siklus aktif: bacaan selama 7 hari, 3 inspeksi, dan 2 siram terukur (ada bacaan 2 jam sebelum dan 3 jam sesudahnya). Pita itu berasal dari minimal tiga bacaan dalam enam jam setelah inspeksi bercatatan `sehat`. Sebelum ambang terpenuhi, tanaman tetap `learning`: tanpa perkiraan dan tanpa email `soil_dry`. Bacaan dan tren dibatasi masa kepemilikan serta penempatan probe.

`below` hanya butuh bacaan segar (maksimal 75 menit) pada atau di bawah batas, tanpa siram tercatat sesudahnya. Perkiraan `window` memakai riwayat pengukuran sedikitnya 24 jam dan bacaan terakhir berusia maksimal 75 menit. Setelah siram, kenaikan terdeteksi, bacaan gagal, atau jeda lebih dari dua jam, server menunggu rangkaian baru. Untuk `window`, diperlukan sedikitnya enam bacaan valid, dua penurunan sejak rangkaian dimulai (langkah datar karena derau tidak mematikannya), dan laju kering siang yang positif. Jendela waktu memakai rentang ±25% dari proyeksi dan pembulatan 30 menit. `below` menyertakan waktu awal rangkaian pada atau di bawah batas. `waiting` berarti data belum cukup dan `learning` berarti pita belum tersedia. Bacaan sebelum cap kalibrasi kelembapan terbaru yang sah tidak ikut dalam pola pot, laju kering, atau usulan siram. Laju kering dihitung dari total penurunan dibagi total durasi pasangan siang yang memenuhi syarat. Pada Ringkasan, probe tanpa bacaan segar dan valid mendapat `state:no_reading`. Slot tanpa probe mendapat `outlook:null`.

## Kesehatan perangkat dan kalibrasi

`my_unit_health(p_unit_id,p_days?,p_timezone?,p_device_id?)` menerima rentang 1–30 hari (bawaan 7) dan zona IANA (bawaan `Asia/Jakarta`). Untuk pot dengan beberapa probe, kirim UUID perangkat yang dipilih. Tanpa pilihan, server memprioritaskan penempatan aktif dan bacaan terakhir. Perangkat di luar penempatan mengembalikan `device_unavailable`.

| Kolom | Isi |
| --- | --- |
| `device_id, checked_at, timezone` | Probe yang digunakan, waktu evaluasi, serta zona agregasi. |
| `battery, battery_days_left` | Daftar `{at,volts}` dan estimasi hari menuju 3,4 V. Estimasi membutuhkan tren menurun, minimal 12 bacaan dan bentang 24 jam. Kenaikan lebih dari 0,05 V antara dua bacaan dianggap pengisian; derau ADC yang lebih kecil diabaikan. Pengisian, data usang, atau rangkaian terlalu pendek menghasilkan `null`. |
| `packets, upload_gaps` | Waktu paket diterima server serta jeda di atas 90 menit. `{from,to,ongoing}` membedakan jeda yang telah berakhir dari perangkat yang masih diam. |
| `energy_days` | `{day,solar_wh,load_wh,windows}` per tanggal lokal awal jendela meter terverifikasi. Satu hari penuh berisi 96 jendela 15 menit. Angka bersumber dari penghitung energi saat perangkat berada di penempatan tersebut. |
| `calibration` | `null` atau `{moisture_at,ph_at}` dari paket bertanda tangan. Tanggal satu sensor bisa `null`. |

Di jaringan Wi-Fi ESP32, buka `http://192.168.4.1/calibrate`. Halaman memanggil `GET /api/calibration` untuk menampilkan mV dan waktu kalibrasi. `POST /api/calibration` memakai header `X-Smart-Agro-Setup: 1` dan form `point=dry|wet|ph4|ph686`. Respons `saved:false` menunggu titik pasangan. ESP32 menyimpan pasangan valid secara atomik di NVS. Untuk langkah pengukuran fisik lihat [panduan firmware](../firmware/README.md).

## Aksi pemilik dan Urungkan

| Aksi | RPC |
| --- | --- |
| Nama, arsip, pulihkan | `rename_my_unit(p_unit_id,p_label)`, `archive_my_unit(p_unit_id)`, `restore_my_unit(p_unit_id)` |
| Pindah perangkat | `place_my_device(p_device_id,p_unit_id)`. Kiriman mengikuti penempatan pada waktu pengukuran. |
| Berbagi komunitas | `set_slot_sharing`, `share_my_cycle`, `unshare_my_cycle`, `community_knowledge` |
| Catat siram | `append_my_care_journal(p_unit_id,p_request_id,p_kind,p_observed_at,p_amount_ml,p_notes)` |

Saat pengguna memilih **Catat**, minta volume aktual (lebih dari 0 sampai 100.000 mL). Untuk konfirmasi usulan, gunakan `p_kind:"watering"` dan `to` sebagai waktu pengamatan. Simpan tindakan selama lima detik di klien. **Urungkan** membatalkan pengiriman. Jika pengiriman sudah dimulai, ulangi dengan UUID permintaan dan isi yang sama. Pakai string kosong saat tidak ada catatan.

## Peringatan email dan penghapusan akun

`my_alert_preferences()` mengembalikan `{ok,email_enabled,kinds}`. Email mati secara bawaan. Simpan preferensi dengan `set_my_alert_preferences(p_email_enabled,p_kinds)`. Empat jenisnya ialah `soil_dry` (dua bacaan berturut-turut pada atau di bawah batas bawah pita), `battery_low` (kurang dari 3,4 V), `device_silent` (lebih dari 90 menit sejak kiriman terakhir di penempatan ini), dan `soil_hot` (minimal 35 °C selama tiga jam). Dua bacaan normal berturut-turut mengakhiri episode. Pengiriman memeriksa kembali preferensi, kepemilikan, permintaan hapus akun, serta alamat email terkonfirmasi.

Penjadwal memanggil `POST /functions/v1/alert-dispatch` dengan `Authorization: Bearer <ALERT_DISPATCH_SECRET>` (minimal 32 karakter). Edge Function menjalankan `purge_due_account_deletions`, mengevaluasi episode, lalu mengirim email melalui SMTP. Respons memuat `purged,sent,failed,uncertain,deferred`. Penghapusan yang jatuh tempo tetap diproses saat relay bermasalah.

Fungsi memakai `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALERT_DISPATCH_SECRET`, `SMTP_HOST`, dan `SMTP_FROM`. `ALERT_APP_URL` (opsional, URL https app live) menambahkan tautan `/#pengaturan-peringatan` agar penerima bisa mematikan peringatan; tanpa nilai yang sah, baris itu dihilangkan. Waktu di email ditulis dalam WIB (`23 Nov 14.30 WIB`). `battery_low` baru dianggap pulih setelah 24 jam tanpa bacaan di bawah 3,4 V dengan tegangan 3,6 V atau lebih, sehingga baterai surya yang turun tiap malam tidak mengirim email tiap malam. Sesuaikan `SMTP_PORT`, `SMTP_USER` serta `SMTP_PASSWORD` dengan relay. Bawaannya `SMTP_MODE=tls` pada port 465. Untuk relay STARTTLS pakai `SMTP_MODE=starttls` dengan port yang didukung relay (bawaan 2587). Supabase Edge terkelola memblokir koneksi keluar ke port 25 dan 587. Mode `local` hanya menerima loopback tanpa autentikasi. [Batas Edge Functions](https://supabase.com/docs/guides/functions/limits) Kredensial SMTP dan service key berada di lingkungan fungsi.

Workflow `.github/workflows/care-alerts.yml` berjalan pada menit 07 dan 37 UTC di branch default ketika variabel GitHub `SMART_AGRO_MAINTENANCE_ENABLED=true`. Workflow memerlukan variabel `SUPABASE_URL` dan secret `ALERT_DISPATCH_SECRET` yang sama dengan milik fungsi. Aktivasi produksi dilakukan sesudah migrasi, deployment fungsi, dan persetujuan pemilik.

Penolakan SMTP yang pasti melepas klaim untuk pengiriman berikutnya. Bila relay mungkin sudah menerima pesan, fungsi melaporkan `uncertain` dan menahan kirim ulang. Cocokkan `Message-ID` berbentuk `<ID_EPISODE@alerts.smart-agro>` dengan log relay. Episode tersebut memiliki `lease_until='infinity'` dan `notified_at IS NULL`. Setelah hasil terkonfirmasi, service role dapat memanggil `finish_alert_delivery(p_episode_id,p_token,p_sent)` menggunakan token klaim episode.
