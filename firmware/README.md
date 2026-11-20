# Node tanah Smart Agro

Firmware untuk satu ESP32-WROOM DevKit 38 pin dan satu titik ukur. Acuan belanja adalah RAB_IoT_Smart_Agro_Lengkap.xlsx di folder proyek. Gunakan USB untuk uji meja terlebih dahulu. Semua pembacaan merujuk ke unit yang sudah terdaftar pada backend.

## RAB dan keputusan pembelian

| Bagian | RAB | Keputusan |
| --- | ---: | --- |
| Komponen inti dan rakit | Rp694.650 | Termasuk harga estimasi Rp300.000 untuk sensor pH + DMS. Konfirmasi varian, pinout, tipe output dan prosedur pengukuran ke penjual. |
| Opsional | Rp57.000 | Box Rp35.000 untuk pemasangan outdoor. INA219 Rp22.000 hanya jika dibutuhkan untuk memeriksa satu jalur daya. |
| Total | Rp751.650 | Harga estimasi Rp411.000. Ongkir di luar total. Jika pH + DMS menjadi Rp600.000, total menjadi Rp1.051.650. |

Panel 9 V 2 W dan baterai nominal 14,8 Wh belum menetapkan durasi operasi. Sebagai ilustrasi, 2 W x 4 jam matahari efektif x 70% menghasilkan 5,6 Wh/hari. Beban konstan 50 mA pada 5 V memakai 6 Wh/hari sebelum rugi boost. Ukur arus dari seluruh rangkaian pada mode tidur dan saat koneksi Wi-Fi/TLS. Modul DMS, regulator, LED dan CP2102 bisa tetap menarik arus saat ESP32 tidur. Periksa suplai 5 V di bawah beban, pengisian CN3791 khusus varian 9 V dan terminal proteksi BMS 1S menurut diagram modul. Gunakan sel sejenis yang sehat dan minta perakit kompeten memeriksa kecocokan sebelum dipasang paralel. Cek sirkuit pengisian pada varian DS3231 yang dikirim. Suplai 3,3 V tidak mengisi LIR2032 sampai 4,2 V, dan resistor/dioda modul generik tidak membuktikan pengisian sesuai spesifikasi sel. Jaga perangkat dan sambungan kabel terlindung dari air.

Satu INA219 mengukur satu jalur. [Bukti energi](../docs/energy-rewards.md) membutuhkan data panen dan beban yang terpisah pada jendela 15 menit. Firmware memakai interval 30 menit untuk sensor tanah. Firmware mengirim data pemantauan dan tidak mengendalikan pompa.

## Rakit dan kalibrasi di meja

| Sinyal | ESP32 WROOM | Suplai dan syarat |
| --- | --- | --- |
| HW-390 | GPIO34 ADC1 | 3,3 V dan ground bersama. Cek rentang output. |
| DS18B20 | GPIO27 | 3,3 V dengan pull-up 4,7 kOhm ke 3,3 V. Cek adapter kit dan pinout probe. |
| DS3231 | SDA GPIO21, SCL GPIO22 | I2C dengan pull-up ke 3,3 V. |
| pH + DMS | GPIO35 ADC1 | DMS sesuai suplai pada manual. Sambungkan hanya setelah keluaran analog dan rentangnya terverifikasi. Targetkan 0,1 sampai di bawah 3,0 V pada ADC di seluruh kondisi. Probe pH tidak terhubung langsung ke ESP32. |

Ukur tegangan keluaran DMS dengan multimeter sebelum menyambungkannya. Pembagi 47k/47k di RAB membagi dua tegangan ideal, tetapi impedansi sumber memengaruhi akurasi ADC. Verifikasi hasil ADC terhadap multimeter setelah rangkaian final. Jika DMS memakai keluaran digital/serial, ikuti protokol resmi varian tersebut dan biarkan kanal pH berstatus belum diukur sampai adapter yang sesuai tersedia.

Pantau serial pada 115200 baud. Masukkan nilai median mV dari media kering dan kondisi basah acuan ke moistureDryMv dan moistureWetMv. Sebut hasilnya indeks lembap, bukan kadar air volumetrik. Jika manual probe mengizinkan kalibrasi dengan buffer, siapkan pH 4,01 dan 6,86 sesuai label dan temperatur. Isi phLowMv/phHighMv dengan tegangan ADC aktual masing-masing. Probe yang dirancang untuk tanah padat dapat membutuhkan prosedur yang berbeda. Konfirmasi metode pengukuran tanah dan interval stabilisasi dari penjual. Kalibrasi kosong atau indeks lembap nol menghasilkan status pH not_measured. Media yang kering tidak menyediakan kontak yang andal untuk probe pH tanah. Bus suhu diharapkan berisi satu DS18B20 sesuai RAB agar identitas probe tanah pasti. Build tanpa DeviceConfig.h hanya mencetak diagnostik USB, tanpa koneksi Wi-Fi atau pengiriman data.

## Build dan commissioning

Jalankan dari root repo dengan Arduino CLI dan ESP32 core yang ditentukan. Konfigurasikan direktori cache CLI di dalam workspace bila lingkungan membatasinya. Pada Windows, gunakan jalur pendek tanpa spasi untuk cache toolchain, misalnya alias drive sementara ke folder cache di workspace.

    arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
    arduino-cli core install esp32:esp32@2.0.17 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
    arduino-cli lib install OneWire@2.3.8 DallasTemperature@4.0.4 Crypto@0.4.0 ArduinoJson@7.4.2
    arduino-cli compile --fqbn esp32:esp32:esp32 firmware/smart_agro

1. Untuk provisioning lab, jalankan node firmware/provision.mjs sekali per ESP32. Skrip menulis konfigurasi lokal yang diabaikan Git dan menampilkan public key, tanpa menimpa konfigurasi yang ada. Perlakukan konfigurasi dan binary hasil kompilasi sebagai berkas privat karena binary juga memuat seed perangkat dan kredensial Wi-Fi. Simpan cadangan terenkripsi di luar source yang dibagikan. Provisioning produksi perlu penyimpanan kunci yang dikendalikan dan Flash Encryption/Secure Boot bila perlindungan dari ekstraksi fisik dibutuhkan.
2. Daftarkan public key melalui [alur provisioning](../docs/IMPLEMENTATION_PHASES.md). Isi deviceId dan unitId UUID milik perangkat/pot yang sama, endpoint HTTPS lengkap ke /functions/v1/telemetry-ingest, CA PEM tepercaya yang menandatangani rantai endpoint, serta SSID/kata sandi Wi-Fi 2,4 GHz. Konfirmasi aktivasi dan penempatan perangkat pada akun. QR Android untuk kepemilikan, sementara node prototipe menerima Wi-Fi lewat commissioning USB.
3. Build kembali dan upload file hasil build ke port yang benar melalui perintah upload Arduino CLI. Cek serial dan log backend pada pot uji. Lepaskan Wi-Fi satu interval lalu sambungkan lagi. Output yang diharapkan adalah paket tertunda terkirim ulang melalui HTTPS dengan identitas asli. Uji cabut probe, RTC kehilangan jam, restart daya, dan batas ADC sebelum pemasangan.
4. Baru pindah ke sistem baterai/panel setelah ukur konsumsi tidur, drop tegangan saat Wi-Fi, dan perilaku pengisian. Jalankan uji pelaporan beberapa hari di lokasi nyata.

Node menyinkronkan waktu UTC dengan SNTP dan memakai DS3231 sebagai cadangan ketika jam pernah disinkronkan dan flag oscillator-stop bersih. Jika RTC tidak maju setelah deep sleep, node menunggu SNTP. Saat sumber waktu belum tepercaya, node menahan pengiriman. Paket mengikuti [telemetry-v2](../docs/telemetry-v2.md) dan ditandatangani Ed25519. LittleFS menyimpan 48 paket asli (24 jam pada interval 30 menit). Setiap paket ditulis ke berkas sementara dan dipindah ke antrean sebelum dikirim. Jika antrean penuh, perangkat mempertahankan paket tersimpan dan mencatat sampel baru yang dilewati di serial. Maksimum delapan permintaan per bangun membatasi waktu radio aktif. Paket waktu/payload/urutan yang ditolak permanen dicatat di serial sebelum dibuang. Gangguan jaringan dan penolakan provisioning mempertahankan paket. Paket NVS dari firmware lama diproses lebih dahulu. Paket lokal yang rusak atau lebih tua dari tujuh hari dikeluarkan dengan log serial. Kirim ulang setelah gagal hapus mengikuti kontrak idempotensi server: identitas dan byte tetap sama. Setiap bangun membuat satu paket dengan boot ID baru dan sequence 1. Partisi filesystem bawaan dipakai tanpa memformat data yang sudah ada. Saat memindah node ke pot/akun lain, pastikan antrean lama sudah selesai sebelum provisioning ulang.

## APK yang memanfaatkan perangkat ini

| Prioritas | Pengalaman | Data yang dipakai |
| --- | --- | --- |
| 1 | Kartu status menampilkan waktu ukur, kapan diterima, status sensor dan alasan saat angka kosong. Tampilkan perangkat terhubung hanya berdasarkan bukti waktu data. | measured_at, received_at, clock_status, quality_status. Gunakan ambang data usang 75 menit yang sudah ada. |
| 2 | Grafik sentuh menandai jeda pengiriman dan perubahan setelah jurnal siram. Pengguna dapat mengetuk titik untuk melihat nilai dan waktu. | Sampel valid per sensor dan catatan perawatan. |
| 3 | Tanaman 2D berubah secara halus saat sampel baru masuk. Tingkat kelembapan memengaruhi warna media, fase tumbuh tetap berdasarkan umur dan observasi. | Indeks lembap valid, tanggal tanam, dan pengamatan pemilik. |
| 4 | Panduan pemasangan berakhir dengan tiga status sensor dan bacaan pertama. Kartu pot yang tidak ditempati perangkat tetap menampilkan jurnal/riwayat terakhir. | Penempatan perangkat dan riwayat unit. Satu set probe hanya membaca satu titik pada suatu waktu. |

Fitur seperti pH tetap muncul sebagai belum diukur saat datanya belum tersedia. Kelembapan tanah, suhu tanah, dan pH belum mengukur NPK, EC, penyakit, atau kapasitas baterai.
