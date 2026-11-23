# Uji bangku perangkat Smart Agro

Panduan ini membuktikan bahwa satu ESP32 yang sudah dirakit benar-benar mengirim bacaan yang masuk akal ke aplikasi. Sejauh ini firmware baru terbukti bisa dikompilasi. Semua yang ada di bawah belum pernah diuji pada perangkat nyata.

Kerjakan di meja dulu, belum di pot. Rakit sesuai tabel di [README](README.md#rakit-dan-kalibrasi-di-meja), lalu build, provisioning, dan upload sesuai [Build dan commissioning](README.md#build-dan-commissioning).

**Alat:** multimeter, termometer biasa, segelas air, tanah kering, buffer pH 4,01 dan 6,86, router Wi-Fi 2,4 GHz, aplikasi Smart Agro (web live atau APK) dengan akun pemilik unit, kabel USB ke laptop.

**Monitor serial:** 115200 baud. Kutipan pesan di bawah berasal langsung dari `smart_agro.ino`.

## Langkah

1. **Nyala pertama.** Sambungkan USB dan buka monitor serial. Pesan `Moisture ADC: … mV`, `Battery: … mV at the pin, … V`, dan `pH ADC: … mV` (bila pH terpasang) muncul tanpa `Telemetry could not be encoded` atau `Telemetry could not be committed to flash`.
2. **Jaringan setup.** Tekan EN, lalu tahan BOOT selama 2 detik. Serial menulis `Setup network SmartAgro-xxxx open at http://192.168.4.1/ for 10 minutes.` Sambungkan HP ke `SmartAgro-xxxx` dengan sandi pada label (keluaran `node firmware/provision.mjs`). Halaman setup terbuka sendiri sebagai halaman masuk jaringan, atau buka `http://192.168.4.1/`.
3. **Kalibrasi kelembapan.** Saat pemasangan pertama, buka `http://192.168.4.1/calibrate` atau gunakan **Siapkan perangkat** di Android. Ambil titik kering di udara, kemudian titik basah dengan probe di air sampai batas yang diizinkan produsennya. Tunggu nilai stabil pada setiap titik. Pastikan respons titik kedua `saved:true` dan `GET /api/calibration` mengembalikan `moisture_saved:true`. Bila RTC belum sinkron, tanggal kalibrasi dapat kosong. Setiap langkah kalibrasi memperpanjang waktu portal sepuluh menit.
4. **Simpan Wi-Fi rumah.** Isi SSID (1-32 byte) dan sandi (kosong atau 8-63 byte). Simpan setelah kalibrasi karena ESP32 memulai ulang. Catat waktu kiriman pertama pada akun pemilik.
5. **Respons kelembapan.** Tancapkan probe di tanah kering, tunggu satu bacaan, lalu siram. Indeks di aplikasi harus naik pada bacaan berikutnya.
6. **Suhu tanah.** Letakkan DS18B20 dan termometer berdampingan di tanah yang sama. Selisihnya harus ≤ 1 °C.
7. **pH.** Celupkan probe ke buffer 4,01 lalu 6,86 (bilas di antaranya), dan catat bacaannya. Belum ada ambang lulus. Hasil ini menentukan pilihan sensor pH (rencana perbaikan, Tugas 3).
8. **Baterai.** Ukur tegangan sel di kutub B+ BMS dengan multimeter, lalu bandingkan dengan tegangan baterai di aplikasi (kartu Perangkat atau Diagnostik). Catat selisihnya; targetnya ≤ 0,1 V.
9. **Wi-Fi putus.** Matikan router selama 2 jam, lalu nyalakan lagi. Bacaan terbaru harus tiba lebih dulu, lalu antrean lama menyusul. Aplikasi tidak boleh lama menampilkan "Bacaan lama". Di serial tidak ada `Server rejected an envelope permanently`.
10. **Jam.** Cabut semua daya (USB dan baterai) selama 1 jam lalu nyalakan. Waktu bacaan sesudahnya di aplikasi harus benar. `RTC did not advance since the last wake. Waiting for SNTP.` boleh muncul sekali, tetapi tidak boleh berulang.
11. **Meter energi** (hanya bila dua INA228 terpasang dan meter sudah didaftarkan operator). Jendela energi 15 menit harus muncul di ruang kerja energi.

12. **Derau dan perubahan media.** Pada probe yang terpasang tetap, catat mV minimum dan maksimum selama 60 detik pada media yang sama. Ulangi sesudah menyiram dan membiarkan kelebihan air mengalir. Catat jenis media, posisi probe, waktu dan volume siram. Simpan pengukuran per pot agar kurator bisa membandingkan rentang derau dengan perubahan yang benar-benar menyertai siram.
13. **Tidur dan bangun.** Dengan meter aktif, catat waktu bangun dan arus papan di antara tiga batas seperempat jam. Cocokkan dengan timestamp DS3231, paket energi dan jadwal kiriman tanah. Bedakan arus seluruh papan dari arus modul pH yang tetap diberi daya.
14. **Saran sampai ke HP.** Untuk satu siklus cabai atau bawang, catat sekurangnya tujuh hari, tiga inspeksi (termasuk observasi `sehat`) dan dua penyiraman bervolume dengan bacaan sebelum/sesudah. Aktifkan notifikasi di akun uji. Rekam waktu bacaan, status RPC, email dan notifikasi Android berikutnya serta kondisi media pada saat itu. Biarkan kolom kosong bila peristiwa belum terjadi.

## Hasil

Isi tabel ini, lalu kirim ke agen yang sedang bekerja. Setiap uji yang gagal menjadi tugas perbaikan baru di `docs/superpowers/plans/2026-11-23-perbaikan-hasil-analisis.md`.

| No | Uji | Harapan | Hasil | Lulus |
| --- | --- | --- | --- | --- |
| 1 | Nyala pertama | Tiga baris ADC, tanpa galat telemetri | | |
| 2 | Jaringan setup | SSID `SmartAgro-xxxx`, halaman setup terbuka | | |
| 3 | Kalibrasi kelembapan | Pasangan tersimpan, cap waktu sesuai status RTC | | |
| 4 | Simpan Wi-Fi | Kiriman pertama muncul di akun pemilik | | |
| 5 | Respons kelembapan | Indeks naik setelah disiram | | |
| 6 | Suhu tanah | Selisih ≤ 1 °C | | |
| 7 | pH buffer | Bacaan 4,01 = …, 6,86 = … | | — |
| 8 | Baterai | Selisih ≤ 0,1 V | | |
| 9 | Wi-Fi putus 2 jam | Terbaru dulu, antrean tuntas | | |
| 10 | Jam setelah cabut daya | Waktu bacaan benar | | |
| 11 | Meter energi | Jendela 15 menit muncul | | |
| 12 | Derau probe | Rentang mV per kondisi dan media tercatat | | |
| 13 | Tidur dan bangun | Waktu bangun dan arus dibandingkan catatan alat ukur | | |
| 14 | Saran perawatan | Kondisi media dan waktu peringatan pada akun yang sama tercatat | | |
