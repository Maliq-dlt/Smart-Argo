# Spesifikasi rancangan Smart Agro revisi 2

Dokumen ini memisahkan kebutuhan pemilik proyek, usulan implementasi, dan batas kemampuan saat ini. Seluruh layanan produk fisik masih rancangan. Kode aplikasi tidak diubah oleh revisi diagram.

## 1. Dua varian produk

| Aspek | Satu produk, satu pot | Satu produk, satu kebun |
| --- | --- | --- |
| Sasaran | Kolektor, tanaman eksotik, pemula pertama menanam | Kebun kecil dan petani skala menengah |
| Unit pengamatan | Satu pot aktif | Beberapa zona, pot atau bedeng |
| Profil | Spesies/varietas, media dan fase satu tanaman | Profil per zona; tidak selalu satu jenis tanaman |
| Perangkat | Satu kit dengan titik sensor pada pot | Kontroler/gateway dan beberapa titik sensor |
| Energi | Ukuran panel/baterai berdasarkan beban kit | Ukuran berdasarkan seluruh sensor, gateway dan komunikasi |
| Tampilan | Detail tanaman dan maskotnya | Ringkasan kebun, peringatan per zona, lalu detail tanaman |

Satu bacaan tidak dianggap mewakili seluruh kebun. Setiap pengukuran harus diketahui titik sensor dan unitnya. Varian produk memengaruhi batas unit aktif; mode tampilan tidak dapat mengubah kit satu pot menjadi kit kebun tanpa kemampuan hardware yang sesuai.

## 2. Aktor dan katalog use case

Aktor menggambarkan pengguna atau sistem eksternal. Malik, Noval, Yola, Fransisco dan Teofilus tetap anggota tim pengembang; nama mereka tidak menjadi aktor diagram. Pemilik juga dapat menjadi kontributor, tetapi hak kurator/operator diberikan melalui otorisasi khusus.

Diagram berisi 20 tujuan pengguna. Tidak semua langkah teknis dijadikan oval agar diagram tetap terbaca. Input tervalidasi, otorisasi dan pencatatan audit merupakan prasyarat bersama untuk operasi yang mengubah data.

| ID | Aktor dan prasyarat | Alur dan hasil | Alternatif penting |
| --- | --- | --- | --- |
| APP-01 | Pengguna terdaftar atau calon pengguna | Buat akun, masuk, keluar, pulihkan akses melalui penyedia autentikasi | Kode QR produk tidak menjadi password tetap; kegagalan login dibatasi |
| APP-02 | Pemilik dengan produk aktif | Buat unit pot/zona dan pilih profil tanaman sesuai varian | Tolak unit berlebih pada kit satu pot; pemindahan sensor mempertahankan riwayat lokasi |
| APP-03 | Pemilik berhak membaca unit | Lihat pengukuran, tren, energi dan status perangkat | Tampilkan umur/kualitas data; usang atau null bukan angka nol |
| APP-04 | Pemilik dan unit yang sah | Catat waktu, jenis, jumlah dan konteks tindakan | Catatan tidak menulis ulang pengukuran lama; catatan manual belum cukup untuk reward |
| APP-05 | Pemilik; data dan profil tersedia atau diketahui kekurangannya | Maskot merespons status; AI menjelaskan snapshot dan menjawab sesuai konteks | Timeout AI tidak mengacak emosi; data tidak cukup ditampilkan terus terang |
| APP-06 | Pemilik berhak pada data yang dipilih | Bandingkan dan ekspor riwayat miliknya | Simulator sudah mendukung sesi lokal; ekspor akun cloud merupakan perluasan |
| ID-01 | Pembeli/pemilik; ID produk tersedia | Periksa tanda tangan penerbit, registrasi dan pencabutan; bila perangkat tersedia, periksa challenge | QR terdaftar saja tidak membuktikan barang di tangan asli; koneksi gagal berarti belum terverifikasi |
| ID-02 | Akun aktif; produk sah belum dimiliki | Kode tersegel dan bukti penguasaan perangkat lolos; konsumsi kode dan ikat pemilik atomik | Dua permintaan serentak hanya menghasilkan satu pemilik; pengulangan aman |
| ID-03 | Pemilik lama atau pemohon pemulihan dengan bukti memadai | Transfer melalui persetujuan dan autentikasi ulang; kasus hilang akses ditinjau dukungan | Kode aktivasi lama tetap terpakai; cabut sesi/kunci pengikatan pemilik lama |
| ID-04 | Operator penerbit berwenang | Daftarkan ID unik, kunci publik perangkat dan manifest produk resmi | Identitas belum dianggap aktif sebelum bukti penerbitan memenuhi kebijakan konfirmasi |
| ID-05 | Operator berwenang; alasan tercatat | Cabut identitas/perangkat yang bocor atau bermasalah dan publikasikan status | Pencabutan bukan penghapusan jejak; kesalahan penanganan perlu proses pemulihan terpisah |
| RW-01 | Pemilik | Lihat saldo tersedia, saldo ditahan, riwayat dan versi aturan hadiah | Kredit pending dipisahkan dari saldo yang dapat ditukar |
| RW-02 | Pemilik sah pada saat aktivitas terjadi | Ajukan bukti; sistem memeriksa kelayakan dan mencatat kredit unik | Bukti ganda, data simulasi atau sumber tak tepercaya tidak dikreditkan |
| RW-03 | Saldo dan produk katalog tersedia | Reservasi saldo/stok, ajukan penukaran, lihat status pemenuhan | Gagal reservasi tidak mengubah saldo; pembatalan sebelum pemenuhan melepas reservasi |
| RW-04 | Operator program | Tinjau anomali dan keberatan dengan jejak keputusan | Koreksi melalui entry kompensasi; jangan menghapus ledger lama |
| RW-05 | Operator program | Atur katalog, biaya poin, batas stok dan pemenuhan pesanan | Pesanan dan pemenuhan idempoten; satu penukaran tidak dikirim dua kali |
| KB-01 | Pengguna, termasuk pembaca tanpa produk | Baca profil terbit, ruang lingkup, sumber dan tingkat bukti | Profil yang belum ditinjau tidak tampil sebagai acuan tervalidasi |
| KB-02 | Kontributor dengan izin membagikan datanya | Kirim data, metode, bukti, konteks dan lisensi ke antrian tinjauan | Data pribadi atau tanpa izin diblokir dari publikasi |
| KB-03 | Penulis kontribusi | Perbaiki versi pengajuan sesuai catatan kurator | Riwayat revisi dan sumber tetap terlacak |
| KB-04 | Kurator agronomi berwenang | Nilai bukti dan pengujian; terbitkan versi profil yang sesuai konteks | Kontributor tidak menyetujui pengajuannya sendiri; penolakan disertai alasan |

## 3. QR, akun dan blockchain

### Aktivasi yang disarankan

QR publik berisi ID/tautan produk dan manifest bertanda tangan, bukan rahasia login. Kode aktivasi rahasia ditempatkan di dalam kemasan tersegel atau lapisan gosok. Kode dibuat dengan generator kriptografis, disarankan minimal 128 bit entropi, dan DB menyimpan hash-nya. Kode tidak ditulis pada blockchain, log, analitik atau URL yang dibagikan.

Perangkat memiliki pasangan kunci yang terdaftar pada penerbit. Backend memberikan nonce berumur pendek, terikat ke produk, akun, sesi dan maksud aktivasi. Perangkat membuktikan penguasaan kunci; pairing lokal atau tindakan fisik diperlukan untuk mendukung bukti penguasaan fisik. Nonce hanya dipakai sekali. Verifikasi mencakup registrasi/pencabutan produk, tanda tangan, kedaluwarsa, batas percobaan dan status kode.

Operasi konsumsi kode dan nonce, pembuatan kepemilikan aktif dan penulisan pekerjaan outbox dilakukan dalam **satu transaksi DB**. Constraint satu pemilik aktif menangani dua klaim serentak. Jika transaksi gagal, keseluruhan operasi dibatalkan. Batasi percobaan per akun, perangkat dan sumber jaringan tanpa membuat produk mudah dikunci penyerang. Login berikutnya memakai akun, idealnya penyedia autentikasi dengan passkey atau MFA.

QR dapat difoto atau disalin. Satu kode tersegel dapat dicuri sebelum pemilik sah mengklaimnya. Kunci perangkat juga dapat diekstrak jika perlindungan hardware lemah; karena itu secure element, provisioning aman, deteksi anomali dan pencabutan tetap dibutuhkan. Blockchain tidak menjamin produk mustahil dikloning. Tanpa hardware yang dapat membuktikan kunci secara aman, hasil demo harus disebut verifikasi identitas digital, bukan pembuktian keaslian fisik.

### Pembagian tanggung jawab

| Kebutuhan | Mekanisme utama | Peran blockchain |
| --- | --- | --- |
| Kerahasiaan data pengguna | TLS, otorisasi per pemilik, penyimpanan privat, enkripsi dan pengelolaan kunci | Tidak menyimpan data pribadi terbuka |
| Login dan pemulihan akun | Penyedia autentikasi, sesi aman, MFA/passkey, autentikasi ulang | Bukan pengganti autentikasi |
| Aktivasi sekali pakai | Kode tersegel, challenge perangkat, transaksi DB dan constraint unik | Bukti audit peristiwa yang telah disahkan |
| Registrasi keaslian produk | Manifest bertanda tangan dari penerbit berwenang dan identitas perangkat | Registri produk/penerbit dan status pencabutan yang dapat diperiksa |
| Integritas catatan | Snapshot byte tetap, hash/komitmen dan provenance | Anchor komitmen; tidak membuktikan sensor atau AI benar |
| Hadiah awal | Ledger poin internal sebagai sumber saldo resmi | Dapat meng-anker ringkasan ledger; bukan saldo kedua yang dapat dibelanjakan |

Metadata pemilik, email, password, kode aktivasi dan kunci privat tetap di luar chain. Hindari pula hash langsung atas data pribadi berentropi rendah: hash dapat ditebak. Jika komitmen atas catatan privat diperlukan, gunakan skema dengan nonce acak yang tersimpan privat serta kebijakan pengungkapan yang jelas.

Artefak yang telah di-hash dipertahankan byte-nya. Chain ID, alamat kontrak/tujuan, versi skema, hash transaksi, receipt dan nomor blok disimpan terpisah. Gunakan penanda tangan penerbit untuk registrasi produk, bukan sembarang wallet pembeli. Outbox memiliki ID event unik; worker memeriksa transaksi sebelumnya sebelum mengirim ulang. Pending bukan sukses. Verifikasi memeriksa jaringan, penerbit, tujuan/kontrak, receipt, event/data, digest, serta konfirmasi/reorganisasi menurut kebijakan jaringan. Kegagalan anchor tidak membatalkan konsumsi kode di DB atau membuat kode kembali dapat digunakan.

## 4. Energi panel surya dan baterai

Rancangan awal adalah sistem PV dengan penyimpanan baterai. Panel menghasilkan energi; baterai menyimpannya dan menyuplai beban ketika diperlukan. Belum ada permintaan sumber PLN. Istilah hybrid di sini tidak berarti baterai menciptakan energi.

Jalur gambar bersifat konseptual, bukan petunjuk perakitan. Pengendali pengisian, BMS/proteksi, regulator, sekering dan manajemen jalur daya harus sesuai dengan panel, kimia baterai dan beban. Jangan menyambungkan panel dan baterai langsung hanya berdasarkan panah diagram. Proteksi arus, suhu dan tegangan kritis harus bekerja di hardware; firmware bukan satu-satunya pengaman.

Ukur beban sebelum memilih ukuran:

- `E_harian_Wh = jumlah(P_mode_W × durasi_mode_jam)`; total durasi mode satu hari 24 jam.
- `Kapasitas_baterai_Wh >= E_harian_Wh × hari_otonomi / (fraksi_kapasitas_terpakai × efisiensi_jalur_baterai)`.
- `Panel_Wp >= E_harian_Wh / (jam_matahari_puncak_lokasi × efisiensi_sistem_surya)`, kemudian kaji pemulihan energi baterai setelah hari mendung dan margin desain.

Angka Wp, Wh, Ah, ambang SOC dan lama otonomi belum ditentukan karena sensor, koneksi, lokasi serta baterai belum tersedia. Ah hanya bermakna bersama tegangan nominal. Komunikasi/gateway, frekuensi pengambilan data dan kemungkinan shading harus masuk perhitungan. Kit kebun dihitung berdasarkan seluruh titik sensornya; ukurannya tidak sekadar dikalikan dari kit satu pot.

Bedakan energi panen panel, energi beban, pengisian/pengosongan baterai, SOC, dan kualitas meter. Pengosongan baterai bukan panen surya baru. Saat daya rendah, kurangi komunikasi dan buffer data; saat fault/kritis, gunakan penghentian aman sesuai spesifikasi hardware. Tidak ada beban mining Proof-of-Work dalam rancangan ini.

## 5. Hadiah berkebun dan penukaran

Pilihan pemilik proyek sudah jelas: hadiah token/poin dari aktivitas dan energi terverifikasi, bukan mining komputasi berat. Usulan tahap awal adalah poin nontransferabel dengan ledger di backend. Nama koin, rasio hadiah dan penukaran, batas emisi hadiah, anggaran subsidi serta kapasitas stok masih perlu diputuskan. Belum ada janji nilai uang atau keuntungan.

Klaim harus memiliki event stabil, pemilik yang berhak pada waktu kejadian, perangkat terdaftar, bukti yang layak dan versi kebijakan. Tanda tangan membuktikan asal pesan dari kunci tertentu; tanda tangan saja tidak membuktikan sensor benar atau pengguna benar-benar merawat tanaman. Gunakan kualitas sensor/meter, kontinuitas data, batas wajar, deteksi anomali dan tinjauan bila perlu. Pengakuan manual “sudah menyiram” tidak cukup untuk memberi hadiah yang dapat ditukar.

Jendela energi menggunakan periode kanonik dan identitas meter/boot, sehingga pengiriman ulang atau periode tumpang tindih tidak menghasilkan kredit baru. Jangan memberi hadiah dari energi yang sengaja dibuang, isi ulang baterai dari sumber yang tidak diketahui, atau jumlah penyiraman tanpa kebutuhan tanaman. Kebijakan harus mencegah aktivitas berlebihan yang merusak tanaman dan penghitungan bukti yang sama sebagai beberapa klaim.

`source=simulation`, data contoh, data gagal validasi dan nilai meter yang belum terverifikasi tidak memperoleh kredit nyata. Demonstrasi UI dapat menampilkan saldo demo yang diberi label dan disimpan terpisah; saldo demo tidak dapat ditukar dengan stok nyata.

Saldo tersedia dihitung dari entry ledger yang telah disahkan, dikurangi reservasi aktif. Kredit, ID bukti dan versi aturan dicatat atomik. Satu event sumber hanya memperoleh satu kredit; koreksi memakai entry kompensasi. Penukaran menahan saldo dan stok secara atomik, menggunakan ID permintaan stabil, lalu menyelesaikan debit saat pemenuhan disahkan. Pembatalan sebelum pemenuhan melepas reservasi. Refund setelah pemenuhan merupakan transaksi kompensasi tersendiri, bukan menghapus transaksi lama. Dua klik atau retry jaringan tidak boleh menghasilkan dua pesanan/pengiriman.

Blockchain dapat menyimpan komitmen audit ledger. Jika kelak koin sungguhan diterbitkan, putuskan mint/burn, hak transfer, custody, biaya jaringan dan proses penukaran sebelum membangun kontraknya. Pilih satu sumber saldo yang berwenang: token on-chain yang dapat dibelanjakan tidak boleh sekaligus memiliki saldo DB terpisah yang juga dapat dibelanjakan. Aktivasi QR tetap terpisah dari insentif token.

Program go green adalah tujuan. Dampak lingkungan harus dinilai dari energi dan umur perangkat, baterai, pemeliharaan, distribusi produk serta hasil program; jumlah poin tidak membuktikan pengurangan emisi.

## 6. AI dan maskot 2D

“Data center” pada tahap awal berarti layanan backend dan DB terkelola atau server yang sesuai kebutuhan. Tim tidak perlu membangun fasilitas pusat data fisik. Pemisahan tugasnya:

- Ingestion memeriksa identitas, schema, waktu, urutan, ukuran dan asal data.
- Paket yang sah dapat memuat sensor `error` atau `not_measured`; simpan statusnya dan gunakan hanya data yang layak untuk tiap aturan. Paket ditolak tidak menimpa data lama.
- Mesin aturan menilai kondisi berdasarkan profil dan kalibrasi lokal; statistik/tren memiliki batas kelayakan.
- AI menjelaskan snapshot, merangkum riwayat, dan menjawab pertanyaan dengan data yang memang tersedia. Model prediksi baru memerlukan data berlabel dan evaluasi tersendiri.
- Maskot 2D mengubah hasil terstruktur menjadi ekspresi/animasi, label teks dan alasan yang konsisten.

| Kondisi | Ekspresi yang disarankan | Penjelasan pengguna |
| --- | --- | --- |
| Data usang, hilang, gagal, atau profil belum layak | Bingung/menunggu | Kondisi belum dapat dinilai; tunjukkan sensor dan waktu terakhir |
| Tidak ada kondisi terkonfirmasi yang memerlukan pemeriksaan | Tenang/senang | Lanjutkan pengamatan; bukan jaminan tanaman sehat |
| Media kering atau kondisi perlu pemeriksaan | Sedih/perlu perhatian | Tampilkan penyebab, bukti dan pemeriksaan yang disarankan |
| Kondisi prioritas/peringatan terkonfirmasi | Waspada; ekspresi marah dapat dipakai sebagai gaya maskot | Jelaskan kondisi terukur tanpa menyalahkan pengguna |

Emosi merupakan metafora antarmuka, bukan klaim bahwa emosi biologis tanaman telah diukur. Keadaan tidak diacak pada data yang sama. Jika demo memakai data sintetis, label sintetis tetap terlihat. Status kualitas data mempunyai prioritas; perubahan ekspresi perlu aturan transisi agar tidak berkedip akibat noise sensor.

Simpan ID snapshot, data sumber, waktu, versi profil/aturan, model dan versi prompt. Backend membatasi konteks ke unit milik pengguna; AI tidak mendapat akses DB bebas. Input chat dan kontribusi komunitas dianggap data tidak tepercaya, bukan instruksi sistem. Periksa keluaran sebelum ditampilkan. AI tidak mengubah ledger, kepemilikan, kalibrasi, atau mengendalikan perangkat fisik secara langsung.

Maskot menyediakan teks alternatif kondisi dan alasan; informasi tidak bergantung pada warna atau animasi saja. Sediakan pilihan mengurangi animasi. Percakapan tidak boleh menyembunyikan peringatan sensor.

## 7. Kontribusi ahli dan open source

Kode sumber terbuka dan data terbuka adalah keputusan berbeda. Tentukan lisensi kode bersama pemilik haknya. Kontribusi dataset/profil membutuhkan lisensi atau izin berbagi sendiri, atribusi dan asal data. Telemetri pribadi pengguna tidak otomatis menjadi dataset publik.

Pengajuan memuat spesies/varietas, media, pot/zona, fase, iklim/konteks lokasi, waktu, metode ukur, kalibrasi, sumber dan keterbatasan. Periksa data pribadi, izin, struktur dan duplikasi sebelum masuk antrian. Kurator yang berwenang menilai bukti serta pengujian; pengaju tidak menerbitkan profilnya sendiri sebagai acuan yang sudah disahkan.

Publikasikan profil dalam versi tetap dengan cakupan penggunaan dan tingkat bukti. “Ditinjau” tidak selalu berarti sudah terbukti pada semua kondisi lapangan. Evaluasi baru memakai versi yang sesuai; hasil lama tetap menunjuk versi asal. Jangan melatih ulang model secara otomatis dari setiap unggahan. Perubahan yang memengaruhi rekomendasi harus menjalani pengujian regresi dan penilaian agronomi sebelum dipakai.

## 8. Model data dan batas integritas

ERD merupakan rancangan logis, bukan schema aplikasi saat ini. Tiga gambar dipisah berdasarkan domain. Nama `account_id`, `device_id`, `profile_version_id` yang muncul pada gambar lain tetap merujuk entitas yang sama. Diagram tidak menampilkan seluruh kolom operasional, indeks, audit dan pekerjaan outbox.

| Invariant | Pelaksanaan yang diperlukan |
| --- | --- |
| Satu pemilik aktif per produk | Batas unik pada `product_id` untuk kepemilikan yang `end_at`-nya kosong, disertai transaksi transfer |
| Kode sekali pakai | Satu record aktivasi per produk; konsumsi bersyarat hanya jika belum digunakan dan semua validasi berhasil |
| Akun dengan banyak peran | Otorisasi dikelola server; pemilik dapat juga menjadi kontributor, tanpa otomatis mendapat hak kurator/operator |
| Kit satu pot | Maksimum satu `UNIT` aktif; kit kebun mempunyai beberapa unit sesuai kemampuan kit |
| Lokasi pengukuran sah | `device_id` dan `unit_id` harus berada pada produk yang sesuai; validasi juga saat sensor dipindah |
| Deduplikasi sensor | Kunci unik gabungan `(device_id, boot_id, sequence, sensor_id)`; `device_boot_seq_sensor` pada ERD merangkum kunci gabungan tersebut |
| Kualitas per sensor | `quality_status=ok` memerlukan angka hingga dan rentang yang valid; status lain memakai null dan alasan sesuai schema |
| Waktu dan asal | Simpan `measured_at`, `received_at`, status sinkronisasi serta source; timestamp dikendalikan aturan server, bukan dipercaya mentah |
| Profil yang dapat diaudit | Kombinasi `(profile_id, version)` unik; profil terbit tidak diedit diam-diam; snapshot menyimpan ID versi |
| Jendela energi | Meter, boot dan periode kanonik mengidentifikasi bukti; window tumpang tindih/duplikat tidak dikreditkan kembali |
| Satu kredit per bukti | `source_event_key` unik dan key kredit unik; event dan entry ledger dibuat atomik |
| Sumber entry ledger | Kredit merujuk event, debit merujuk penukaran; FK yang tidak digunakan nullable; reversal merujuk entry asal dalam schema rinci |
| Saldo tidak ganda | Ledger resmi + reservasi aktif; tidak ada saldo kedua yang dapat dibelanjakan dari anchor blockchain |
| Saldo dan stok tidak minus | Reservasi dilakukan dalam transaksi dengan penguncian/conditional update; stok sudah direservasi tidak ditawarkan kembali |
| Retry aman | Aktivasi, kredit, penukaran, pemenuhan dan outbox memakai ID idempoten dan hasil operasi terdahulu |
| Privasi | Otorisasi per unit/produk pada setiap akses; minimalisasi metadata pribadi yang dikirim ke AI dan blockchain |

`ACTIVATION.consumed_by` merujuk `ACCOUNT`; `UNIT.profile_version_id` dan `AI_SNAPSHOT.profile_version_id` merujuk `PROFILE_VERSION`; author/reviewer di domain pengetahuan merujuk `ACCOUNT`. Relasi lintas gambar itu tetap harus ditegakkan. Energi merupakan bukti opsional pada `REWARD_EVENT`: reward aktivitas yang diizinkan kebijakan dapat tidak memiliki window energi; klaim berbasis energi wajib memilikinya.

Kontrak `telemetry-v1.md` tetap menggambarkan pratinjau yang sudah ada. Telemetri energi, identitas bertanda tangan, sensor per zona dan ingestion nyata membutuhkan versi kontrak baru. Jangan menambahkan kolom baru secara diam-diam lalu menganggap validator v1 sudah mendukungnya. `Sample.valid` mesin sekarang juga belum menggantikan validitas per sensor pada produk nyata.

## 9. Tahapan realistis dan keputusan terbuka

Kapasitas sebelumnya 4–6 jam per orang per minggu: sekitar 20–30 jam tim per minggu. Jadwal perluasan demo belum dikonfirmasi ulang; urutan berikut adalah usulan prioritas, bukan komitmen bahwa seluruh visi selesai dalam tiga minggu.

| Tahap | Batas hasil yang disarankan |
| --- | --- |
| Demo tiga minggu | Satu pot/sesi sintetis, maskot dari status aturan, satu penjelasan AI nyata, dan satu anchor/verifikasi catatan di testnet. Tetap beri label sumber dan status kegagalan. |
| Fondasi produk | Akun, registry produk, klaim QR atomik, model unit/perangkat, otorisasi, telemetry v2 dan proses kurasi. Bukti fisik menunggu hardware. |
| Pilot hardware | Ukur beban, pilih panel/baterai, uji proteksi, kalibrasi sensor, pairing/kunci perangkat dan ingestion nyata. |
| Reward terbatas | Meter dan bukti tervalidasi, kebijakan tertulis, batas anggaran/stok, ledger dan penukaran terkontrol. |
| Perluasan | Multi-zona, lebih banyak profil teruji, komunitas, kemudian evaluasi kebutuhan token on-chain. |

Keputusan yang masih diperlukan sebelum implementasi: komponen/kimia baterai, otonomi dan lokasi; metode pairing serta perlindungan kunci; jumlah zona/sensor; aturan transfer/refund; nilai dan sumber pendanaan hadiah; target jaringan blockchain; penyedia AI, retensi data dan cakupan lisensi. Perubahan tersebut tidak menghambat penggunaan diagram sebagai rancangan, tetapi menentukan detail pembangunan.

## 10. Skenario penerimaan untuk implementasi berikutnya

Ini daftar uji yang harus dibangun saat fitur diimplementasikan; bukan klaim bahwa fitur-fitur tersebut sudah diuji sekarang.

| Skenario | Hasil yang diharapkan |
| --- | --- |
| Dua akun mengklaim kode yang sama bersamaan | Tepat satu kepemilikan aktif; akun lainnya menerima konflik |
| QR publik disalin tanpa kode tersegel/kunci perangkat | Identitas publik dapat ditampilkan; aktivasi ditolak |
| Nonce lama dipakai kembali atau dipindah ke akun lain | Ditolak tanpa mengonsumsi kode aktivasi |
| Transaksi blockchain timeout setelah DB sukses | Status bukti pending; kode tetap consumed; retry tidak mengaktifkan ulang |
| Paket yang sama dikirim setelah perangkat reconnect | Tidak menambah pengukuran/kredit duplikat |
| Meter tidak tersedia atau data simulasi | Status energi belum terverifikasi; tidak mendapat kredit nyata |
| Sensor usang tetapi AI memberi jawaban optimistis | Maskot tetap menampilkan data tidak cukup; keluaran yang bertentangan tidak dipakai |
| Dua penukaran bersamaan melebihi saldo/stok | Hanya reservasi yang dapat dipenuhi berhasil; tidak ada nilai negatif |
| Pengajuan ahli mengandung data tanpa izin atau instruksi berbahaya | Tidak masuk profil produksi; kurasi menilai sebagai data, bukan instruksi |
| Profil baru diterbitkan | Evaluasi baru dapat memakainya; catatan lama tetap menunjuk versi asal |
