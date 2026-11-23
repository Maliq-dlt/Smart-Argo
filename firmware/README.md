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
| Baterai | GPIO32 ADC1 | Pembagi 47k/47k dari B+ BMS ke ground, titik tengah ke GPIO32. Sel penuh 4,2 V terbaca sekitar 2,1 V di pin; arus pembagi sekitar 45 uA. Isi batteryDivider = 2.0. Biarkan 0 bila belum dipasang. |
| INA228 surya | SDA GPIO21, SCL GPIO22, alamat 0x40 (A0, A1 ke GND) | VS ke 3,3 V. Shunt di jalur keluaran CN3791 ke baterai (panen surya). |
| INA228 beban | SDA GPIO21, SCL GPIO22, alamat 0x41 (A0 ke VS) | VS ke 3,3 V. Shunt di jalur baterai/BMS ke MT3608 (beban). |
| Tombol setup | GPIO0 (BOOT) | Bawaan DevKit. Tekan EN, lalu tahan BOOT 2 detik untuk membuka jaringan setup Wi-Fi. |
| pH + DMS | GPIO35 ADC1 | DMS sesuai suplai pada manual. Sambungkan hanya setelah keluaran analog dan rentangnya terverifikasi. Targetkan 0,1 sampai di bawah 3,0 V pada ADC di seluruh kondisi. Probe pH tidak terhubung langsung ke ESP32. |

Ukur tegangan keluaran DMS dengan multimeter sebelum menyambungkannya. Pembagi 47k/47k di RAB membagi dua tegangan ideal, tetapi impedansi sumber memengaruhi akurasi ADC. Verifikasi hasil ADC terhadap multimeter setelah rangkaian final. Jika DMS memakai keluaran digital/serial, ikuti protokol resmi varian tersebut dan biarkan kanal pH berstatus belum diukur sampai adapter yang sesuai tersedia.

Pantau serial pada 115200 baud. Masukkan nilai median mV dari media kering dan kondisi basah acuan ke moistureDryMv dan moistureWetMv. Sebut hasilnya indeks lembap, bukan kadar air volumetrik. Jika manual probe mengizinkan kalibrasi dengan buffer, siapkan pH 4,01 dan 6,86 sesuai label dan temperatur. Isi phLowMv/phHighMv dengan tegangan ADC aktual masing-masing. Probe yang dirancang untuk tanah padat dapat membutuhkan prosedur yang berbeda. Konfirmasi metode pengukuran tanah dan interval stabilisasi dari penjual. Kalibrasi kosong atau indeks lembap nol menghasilkan status pH not_measured. Media yang kering tidak menyediakan kontak yang andal untuk probe pH tanah. Bus suhu diharapkan berisi satu DS18B20 sesuai RAB agar identitas probe tanah pasti. Build tanpa DeviceConfig.h hanya mencetak diagnostik USB, tanpa koneksi Wi-Fi atau pengiriman data.

### Uji kalibrasi lewat Wi-Fi perangkat

Di jaringan setup berpassword, baca median mV langsung melalui `GET /api/calibration`. Kontrak untuk halaman portal ada di [API perawatan](../docs/sensor-care-api.md). Catat titik kering dan basah untuk kelembapan, lalu buffer 4,01 dan 6,86 untuk pH bila petunjuk probe mengizinkannya. Tunggu ADC stabil di tiap titik. Perangkat menerima 100 sampai 2999 mV, dengan selisih kering dikurangi basah setidaknya 100 mV dan selisih absolut kedua buffer setidaknya 50 mV.

Pada ESP32 fisik, cek pasangan valid, penolakan titik di luar rentang, dan restart setelah titik pertama serta setelah pasangan tersimpan. Pastikan pasangan sebelumnya bertahan ketika penulisan gagal. Setelah sinkronisasi jam, ulangi satu kalibrasi dan cocokkan tanggal dalam paket bertanda tangan dengan `my_unit_health`. Pengukuran yang dilakukan sebelum sinkronisasi tetap dapat dipakai dengan tanggal kosong.

## Build dan commissioning

Setelah perangkat terpasang, jalankan [uji bangku](UJI-BANGKU.md) dan isi tabel hasilnya sebelum memindahkan perangkat ke pot.

Jalankan dari root repo dengan Arduino CLI dan ESP32 core yang ditentukan. Konfigurasikan direktori cache CLI di dalam workspace bila lingkungan membatasinya. Pada Windows, gunakan jalur pendek tanpa spasi untuk cache toolchain, misalnya alias drive sementara ke folder cache di workspace.

    arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
    arduino-cli core install esp32:esp32@2.0.17 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
    arduino-cli lib install OneWire@2.3.8 DallasTemperature@4.0.4 Crypto@0.4.0 ArduinoJson@7.4.2
    arduino-cli compile --fqbn esp32:esp32:esp32 firmware/smart_agro

1. Untuk provisioning lab, jalankan node firmware/provision.mjs sekali per ESP32. Skrip menulis konfigurasi lokal yang diabaikan Git dan menampilkan public key, tanpa menimpa konfigurasi yang ada. Perlakukan konfigurasi dan binary hasil kompilasi sebagai berkas privat karena binary juga memuat seed perangkat dan kredensial Wi-Fi. Simpan cadangan terenkripsi di luar source yang dibagikan. Provisioning produksi perlu penyimpanan kunci yang dikendalikan dan Flash Encryption/Secure Boot bila perlindungan dari ekstraksi fisik dibutuhkan.
2. Daftarkan public key melalui [alur provisioning](../docs/IMPLEMENTATION_PHASES.md). Isi deviceId dan unitId UUID milik perangkat/pot yang sama, endpoint HTTPS lengkap ke /functions/v1/telemetry-ingest, CA PEM tepercaya yang menandatangani rantai endpoint, serta SSID/kata sandi Wi-Fi 2,4 GHz bila ingin menanamnya lewat USB. Konfirmasi aktivasi dan penempatan perangkat pada akun. QR Android untuk kepemilikan. Cetak sandi setup dari provision.mjs di label perangkat.
3. Build kembali dan upload file hasil build ke port yang benar melalui perintah upload Arduino CLI. Cek serial dan log backend pada pot uji. Lepaskan Wi-Fi satu interval lalu sambungkan lagi. Output yang diharapkan adalah paket tertunda terkirim ulang melalui HTTPS dengan identitas asli. Uji cabut probe, RTC kehilangan jam, restart daya, dan batas ADC sebelum pemasangan.
4. Wi-Fi tanpa USB (RAB "BLE/AP pairing", dipilih SoftAP karena tidak butuh aplikasi tambahan): bila belum ada Wi-Fi tersimpan, atau setelah EN lalu BOOT ditahan 2 detik, perangkat membuka jaringan WPA2 SmartAgro-xxxx (empat karakter awal ID perangkat yang tampil di aplikasi) dengan sandi dari label. Sambungkan HP, buka halaman yang muncul atau http://192.168.4.1/, pilih Wi-Fi rumah, lalu Simpan. Data disimpan di NVS dan mengalahkan Wi-Fi hasil kompilasi; perangkat memulai ulang dan langsung mengirim. Jaringan setup tertutup sendiri setelah 10 menit dan tidak pernah dibuka saat bangun dari deep sleep. Kredensial di NVS belum dienkripsi; aktifkan enkripsi flash dan NVS untuk unit produksi.
5. Baru pindah ke sistem baterai/panel setelah ukur konsumsi tidur, drop tegangan saat Wi-Fi, dan perilaku pengisian. Jalankan uji pelaporan beberapa hari di lokasi nyata.

Node menyinkronkan waktu UTC dengan SNTP dan memakai DS3231 sebagai cadangan ketika jam pernah disinkronkan dan flag oscillator-stop bersih. Jika RTC tidak maju setelah deep sleep, node menunggu SNTP. Saat sumber waktu belum tepercaya, node menahan pengiriman. Paket mengikuti [telemetry-v2](../docs/telemetry-v2.md) dan ditandatangani Ed25519. LittleFS menyimpan 48 paket asli (24 jam pada interval 30 menit). Setiap paket ditulis ke berkas sementara dan dipindah ke antrean sebelum dikirim. Jika antrean penuh, perangkat mempertahankan paket tersimpan dan mencatat sampel baru yang dilewati di serial. Maksimum delapan permintaan per bangun membatasi waktu radio aktif. Sampel bangun ini dikirim lebih dulu, lalu antrean lama dari yang tertua, sehingga aplikasi langsung menampilkan bacaan terkini begitu Wi-Fi pulih; server menerima urutan ini karena setiap paket membawa boot ID sendiri. Saat antrean penuh, antrean dikuras dulu dan sampel baru disimpan hanya bila sudah ada ruang. Paket waktu/payload/urutan yang ditolak permanen dicatat di serial sebelum dibuang. Gangguan jaringan dan penolakan provisioning mempertahankan paket. Paket NVS dari firmware lama diproses lebih dahulu. Paket lokal yang rusak atau lebih tua dari tujuh hari dikeluarkan dengan log serial. Kirim ulang setelah gagal hapus mengikuti kontrak idempotensi server: identitas dan byte tetap sama. Setiap bangun membuat satu paket dengan boot ID baru dan sequence 1. Partisi filesystem bawaan dipakai tanpa memformat data yang sudah ada. Pindah pot dalam produk yang sama tidak butuh flash ulang: setelah pemilik memasang perangkat di unit baru lewat aplikasi, server mencatat paket ke unit tempat perangkat terpasang pada jam pengukuran (migrasi 20261121000000); unitId di konfigurasi hanya dipakai selama perangkat belum dipasang. Paket untuk unit yang diarsipkan dijawab 409 unit_archived dan dibuang, bukan diulang. Pindah ke produk atau akun lain tetap butuh provisioning ulang setelah antrean lama selesai. Tegangan baterai dikirim sebagai objek battery opsional dan tampil di Diagnostik sensor aplikasi; di bawah 3,4 V muncul peringatan Baterai lemah. Tegangan diukur saat Wi-Fi menyala, jadi sedikit lebih rendah dari tegangan istirahat.

## APK yang memanfaatkan perangkat ini

| Prioritas | Pengalaman | Data yang dipakai |
| --- | --- | --- |
| 1 | Kartu status menampilkan waktu ukur, kapan diterima, status sensor dan alasan saat angka kosong. Tampilkan perangkat terhubung hanya berdasarkan bukti waktu data. | measured_at, received_at, clock_status, quality_status. Gunakan ambang data usang 75 menit yang sudah ada. |
| 2 | Grafik sentuh menandai jeda pengiriman dan perubahan setelah jurnal siram. Pengguna dapat mengetuk titik untuk melihat nilai dan waktu. | Sampel valid per sensor dan catatan perawatan. |
| 3 | Tanaman 2D berubah secara halus saat sampel baru masuk. Tingkat kelembapan memengaruhi warna media, fase tumbuh tetap berdasarkan umur dan observasi. | Indeks lembap valid, tanggal tanam, dan pengamatan pemilik. |
| 4 | Panduan pemasangan berakhir dengan tiga status sensor dan bacaan pertama. Kartu pot yang tidak ditempati perangkat tetap menampilkan jurnal/riwayat terakhir. | Penempatan perangkat dan riwayat unit. Satu set probe hanya membaca satu titik pada suatu waktu. |

Fitur seperti pH tetap muncul sebagai belum diukur saat datanya belum tersedia. Kelembapan tanah, suhu tanah, dan pH belum mengukur NPK, EC, atau penyakit. Tegangan baterai hanya perkiraan kasar sisa daya, bukan kapasitas terukur.

## Bukti energi dengan INA228

RAB perlu **dua** INA228 menggantikan satu INA219. Server energi ([energy-rewards](../docs/energy-rewards.md)) menerima jendela UTC tetap 15 menit berisi penghitung Wh kumulatif untuk panen surya dan beban. Satu INA228 tidak bisa memisahkan keduanya karena register ENERGY menjumlahkan daya ke dua arah, dan INA219 tidak punya akumulator. Dengan VS di rel 3,3 V DevKit, INA228 terus mengakumulasi selama ESP32 deep sleep (sekitar 0,6 mA per papan).

Isi `solarMeterAddress` 0x40, `loadMeterAddress` 0x41, `meterShuntOhms` sesuai shunt di papan (banyak papan INA228 memakai 15 mOhm), dan `meterMaxAmps` di atas arus puncak jalur beban saat Wi-Fi menyala (2 A cukup untuk 15 mOhm; amps x ohms harus di bawah 0,16384 V). `provision.mjs` membuat kunci meter terpisah dan mencetak public key-nya. Operator mendaftarkan kunci itu beserta referensi kalibrasi dan daya maksimum, lalu `meterId` dari server diisi dan firmware di-build ulang.

Dengan meter aktif, node bangun tiap seperempat jam UTC. Deep sleep berakhir satu menit lebih awal karena jam RTC ESP32 bisa meleset sekitar 5%, lalu light sleep sampai batas seperempat jam menurut DS3231. Penghitung dibaca dalam sekitar satu detik dari batas, sebelum Wi-Fi menyala. Bangun di :15 dan :45 hanya membaca meter tanpa radio; bacaan tanah dan Wi-Fi tetap tiap 30 menit dan mengirim jendela energi tertua lebih dulu. Antrean energi terpisah menampung 96 jendela (24 jam). Jendela hanya dibuat bila bacaan sebelumnya tepat seperempat jam sebelumnya dalam urutan hitung yang sama; bangun yang terlewat, jam yang belum tepercaya, atau meter yang kehilangan daya (kalibrasi hilang, penghitung mundur) memulai urutan baru dengan boot ID baru tanpa jendela palsu. `battery_soc_pct` dikirim null karena tegangan bukan state of charge. Server menolak jendela yang melebihi daya maksimum terdaftar.

Belum teruji pada perangkat keras: register INA228 mengikuti datasheet TI (ID pabrikan 0x5449, perangkat 0x228, SHUNT_CAL = 13107,2 x 10^6 x CURRENT_LSB x R, ENERGY 40-bit dengan LSB 16 x 3,2 x CURRENT_LSB joule). Bandingkan Wh satu hari dengan multimeter atau beban terukur sebelum mendaftarkan meter untuk reward.
