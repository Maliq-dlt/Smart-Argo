# Kontrak paket perangkat v1

Status implementasi: validator JSON dan pratinjau berkas berjalan di browser. Belum ada perangkat, endpoint, firmware, streaming, atau kendali aktuator. Makalah dasar memakai tiga parameter dan tidak memakai pompa; status tetesan merupakan perluasan rancangan.

`public/telemetry-example.json` adalah contoh eksplisit (`source: "example"`), bukan hasil pembacaan perangkat. Buka **Statistik → Perangkat & paket data → Buka paket JSON**. Validasi gagal mempertahankan paket sebelumnya. Paket dan galat disimpan bersama sesi, tetapi tidak dimasukkan ke sampel atau keputusan agronomi simulasi.

## Bidang wajib

| Bidang | Makna |
| --- | --- |
| `schema_version` | Angka `1`. |
| `source` | `device` untuk berkas hasil perangkat, `example` untuk contoh. Keduanya tetap pratinjau berkas, bukan bukti koneksi hidup. |
| `device_id`, `sample_id` | Teks 1–120 karakter. Firmware perlu ID sampel unik termasuk identitas boot agar reset tidak menggandakan urutan. |
| `measured_at` | Timestamp ISO 8601 lengkap dengan `Z` atau offset UTC. Dinormalisasi ke UTC saat impor. Jam tanpa zona ditolak. |
| `sensors.moisture` | Indeks kelembapan kapasitif 0–100, bukan kapasitansi dalam farad atau kadar air volumetrik. |
| `sensors.soil_temperature` | Suhu tanah −20 sampai 60 °C sesuai rentang kontrak simulator. |
| `sensors.soil_ph` | pH 0–14. Tidak diukur berarti `null`; jangan menyalin nilai lama sebagai pengukuran baru. |
| `drip` | Status tetesan dengan bidang wajib di bawah. |

Setiap sensor mempunyai `status: "ok" | "error" | "not_measured"` dan `value`. Status `ok` wajib memiliki angka hingga dalam rentang. Status lain wajib `value: null`. Status `error` wajib `error` berupa teks 1–240 karakter. Status `ok` adalah laporan perangkat, bukan bukti kalibrasi; acuan lokal tetap harus divalidasi sebelum rekomendasi agronomi.

`drip` memiliki `installed` (boolean), `command` dan `feedback` (`on`, `off`, `unknown`), `flow_ml_min` (angka 0–100.000 atau `null`), serta `fault` (teks 1–240 karakter atau `null`). Jika tidak terpasang: command/feedback `unknown`, flow/fault `null`.

Perintah ON bukan bukti katup terbuka. Umpan balik aktuator dan sensor aliran harus terpisah. Tanpa sensor aliran, kirim `flow_ml_min: null`; aplikasi menyatakan aliran belum terverifikasi. Aliran nol saat ON atau aliran positif saat OFF memicu pemeriksaan, bukan diagnosis pasti. Firmware kelak perlu waktu tunggu, ambang aliran terkalibrasi, dan beberapa pembacaan sebelum melaporkan fault. Jangan mengarang umpan balik dari perintah.

## Diagnostik saat ini

- Paket lebih tua dari 5 menit ditandai usang; lebih dari 5 menit di masa depan ditandai masalah jam. Pembanding adalah jam perangkat pengguna, belum server waktu otoritatif.
- Status sensor error ditampilkan per komponen; pH yang tidak diukur tetap terpisah dari error.
- Fault tetesan diteruskan sesuai laporan perangkat. Perintah berbeda dari umpan balik memicu pemeriksaan.
- Galat saat impor paket muncul di terminal sebagai **Pratinjau perangkat**, dengan waktu impor pada sesi simulasi. Waktu pengukuran UTC asli tetap tercantum dalam pesan/paket. Setelah itu panel mengevaluasi umur paket setiap 30 detik; tidak mengaku menerima paket baru.
- Pratinjau maksimum 64 KB per berkas. Hanya paket terakhir disimpan per sesi; pengimporan ulang merupakan aksi manual, bukan ingestion streaming yang menjamin deduplikasi.

## Integrasi perangkat berikutnya

Pilih HTTP/SSE/WebSocket atau gateway MQTT setelah board, DMS, aktuator, sensor aliran, dan koneksi tersedia. Gateway perlu autentikasi, TLS, batas ukuran, ID perangkat/pot, deduplikasi sample_id, penanganan paket di luar urutan, waktu terima server, dan validasi jam perangkat. CORS mengikuti origin hosting. Jangan menyimpan credential di bundle frontend.

Firmware menggunakan NTP/RTC sesuai ketersediaan perangkat dan mengirim UTC, status sinkronisasi, serta umur pengukuran yang sebenarnya. UI hanya mengubah tampilan zona; offset manual tidak memperbaiki jam perangkat yang salah. Perintah fisik memerlukan acknowledgment, timeout, batas durasi/volume, dan kondisi aman di firmware. Pratinjau ini tidak mengirim perintah.

Fase bunga/buah tidak dapat disimpulkan dari tiga sensor ini. Rentang HST aplikasi merupakan ilustrasi. Untuk mendekati tanaman nyata, kumpulkan tanggal tanam, varietas, fase hasil observasi/foto, kalibrasi sensor, dan respons perawatan; kemudian validasi model menggunakan data tersebut. Tidak ada klaim kesetaraan pertumbuhan 1:1.
