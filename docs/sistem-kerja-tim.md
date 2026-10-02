# Sistem kerja tim Smart Agro

Panduan untuk Malik, Noval, Yola, Fransisco, dan Teofilus. Disusun 26 September 2026 berdasarkan proyek lokal dan klarifikasi tim: 4–6 jam per orang per minggu, perangkat IoT belum tersedia, AI serta blockchain wajib masuk demo.

Rekomendasi: satu board Trello, satu pemilik per tugas, review terpisah dari pelaksana, dan evaluasi mingguan. Pertahankan simulator yang sudah berjalan. Tiga minggu pertama menghasilkan demo perangkat lunak dengan AI nyata serta transaksi blockchain pada jaringan uji. Integrasi sensor menyusul setelah fondasi siap.

## 1 Kondisi proyek dan lingkup demo

| Bagian | Temuan | Dampak pekerjaan |
| --- | --- | --- |
| Aplikasi | React 18, TypeScript, Vite, Tailwind, Radix, Framer Motion, Lenis; versi 1.10.0. | Lanjutkan aplikasi; tidak perlu mengganti framework. |
| Halaman | Dashboard, Simulasi, Bandingkan sesi, Status perangkat, Terminal. | Tambahkan dua interaksi: penjelasan AI dan bukti blockchain. |
| Keputusan | Mesin aturan dan regresi linear lokal dalam TypeScript serta Python. | Aturan menjadi dasar keputusan; integrasi model AI merupakan pekerjaan baru. |
| Data | Sesi sintetis, localStorage, ekspor/impor JSON, waktu UTC. | Cukup untuk demo satu laptop; belum mendukung akun atau penyimpanan bersama. |
| IoT | Validator dan pratinjau berkas JSON tersedia; paket belum masuk riwayat keputusan. | Firmware, penerima data langsung dan pemetaan data nyata belum dibangun. |
| Blockchain | Belum ditemukan implementasi wallet/transaksi/smart contract pada aplikasi. | Bangun satu alur pencatatan hash, tanpa token atau kontrak kompleks. |
| Dokumen | Blueprint awal mencakup RS485, EC/NPK dan pemupukan. Makalah SmartAgro serta kode kini fokus satu pot, kelembapan, suhu dan pH. | Tetapkan satu lingkup acuan; jangan menjalankan semua versi proposal bersamaan. |
| Setup tim | Git berada di `simulasi-web`; tes membutuhkan `simulasi_pot.py` dari folder induk di luar Git aplikasi. README menunjuk makalah yang tidak ditemukan dengan nama tersebut. | Prioritas Noval minggu pertama: paket onboarding lengkap dan rujukan dokumen benar. |

`Makalah_SmartAgro.docx` memuat penulis tim dan substansi dekat dengan `Project_Skripsi_Final.docx`. Usulan acuan: makalah tersebut, README aplikasi dan kontrak telemetri. Malik mengesahkan lingkup bersama kebutuhan klien yang dibawa Yola. Versi lama tetap dipertahankan sebagai referensi. Permintaan AI/blockchain menjadi tambahan lingkup demo, karena dokumen lama menunda pembelajaran mesin.

**Hasil wajib tiga minggu:** satu sesi sintetis dapat ditelusuri dari data, keputusan aturan, penjelasan model AI, sampai pencatatan hash pada blockchain. Snapshot yang sama harus dipakai sepanjang alur. Sesi lama tetap dapat dipulihkan; kegagalan tidak menghapus data.

**Ditunda:** sensor fisik, streaming MQTT, otomatisasi pompa, dosis pupuk, diagnosis foto, pelatihan model sendiri, multiakun, mobile native, marketplace, pembayaran, token dan mainnet. AI serta blockchain tetap masuk demo dengan bentuk minimum berikut.

**AI — tombol “Jelaskan rekomendasi”.** Backend memvalidasi snapshot sesi, menghitung ulang keputusan dengan mesin aturan, lalu memberi model keputusan dan bukti terpilih. Model menjelaskan alasan dalam bahasa Indonesia. Tindakan utama tetap berasal dari aturan; model tidak mengubah sensor, menyimpulkan NPK, menentukan dosis atau mengendalikan perangkat.

Catat model, versi prompt, waktu respons dan identitas snapshot. Batasi ukuran masukan, panjang keluaran, frekuensi dan waktu tunggu. Nama media/isi JSON diperlakukan sebagai data, bukan instruksi. Respons salah format atau bertentangan dengan batas tugas ditolak. Saat gagal, tampilkan pesan gagal dan pertahankan penjelasan aturan. Validasi format tidak menjamin kebenaran isi; Yola dan Malik tetap menguji contoh keluaran.

**Blockchain — bukti integritas satu catatan.** Finalkan berkas JSON berisi `source: simulation`, versi catatan, snapshot data, keputusan aturan, hasil AI dan waktu pencatatan. Simpan byte UTF-8 berkas tersebut tanpa mengubahnya. Hitung SHA-256 melalui Web Crypto atau `node:crypto`.

Pakai wallet khusus demo pada testnet Ethereum, dengan Sepolia sebagai kandidat awal. Transaksi bernilai nol ke alamat wallet sendiri membawa hash pada bidang data. Smart contract tidak diperlukan untuk bukti ini. Catatan lengkap berada di luar blockchain. Simpan berkas, hash, chain ID, hash transaksi dan nomor blok. Format ulang JSON juga mengubah hash karena verifikasi memakai byte berkas yang persis sama.

Status “tercatat” hanya muncul setelah receipt sukses dan data transaksi pada chain yang dipilih cocok dengan hash. Uji berkas diubah, wallet menolak, jaringan salah dan transaksi pending. Bukti menunjukkan kecocokan catatan dengan hash tercatat; bukan kebenaran sensor, AI, atau tanggal kejadian.

Gunakan wallet demo tanpa dana nyata. Seed phrase dan private key tetap berada di wallet, tidak dibagikan melalui Git atau Trello. Pengguna memeriksa dan menyetujui setiap transaksi. API key AI hanya berada di backend; jangan gunakan variabel `VITE_*` untuk secret.

**Gerbang akses minggu pertama:** satu respons model nyata dan satu transaksi uji harus berhasil. Jika faucet/RPC tidak tersedia, pilih devnet lokal yang benar-benar menambang transaksi dan beri label “blockchain lokal”. Hash lokal tanpa transaksi tidak memenuhi target. Respons statis tidak memenuhi target AI. Jika akses model belum siap, Malik menyelesaikan akses atau menyesuaikan tanggal bersama klien.

## 2 Pembagian peran

| Anggota | Tanggung jawab | Hasil yang dimiliki | Batas peran |
| --- | --- | --- | --- |
| Malik — Project Lead dan AI/blockchain | Prioritas, scope, biaya, kriteria demo; perilaku AI dan alur pencatatan blockchain. | Backlog berprioritas, prompt/evaluasi model, bukti transaksi, keputusan rilis. | Tidak memberi tugas frontend/backend di luar koordinasi Noval; tidak menyetujui kode sendiri. |
| Noval — Technical Lead dan integrasi | Memecah pekerjaan teknis, menyepakati kontrak, review PR, membantu hambatan, menjaga build. | Onboarding, pemeriksaan otomatis, integrasi lintas modul dan build demo. | Bukan pelaksana utama seluruh frontend/backend. Menangani sambungan modul dan masalah sulit. |
| Yola — Penghubung klien, penerimaan pengguna, persiapan IoT | Menggali kebutuhan, menyusun UAT, memeriksa hasil, menyiapkan spesifikasi sensor. | Catatan kebutuhan, hasil uji pengguna, BOM/datasheet dan rencana kalibrasi. | Tidak menjanjikan fitur/tanggal sebelum disetujui Malik. Tanpa perangkat, fokus kebutuhan serta pengujian. |
| Fransisco — Frontend Developer | Tampilan, interaksi AI/bukti, loading/error, responsivitas dan aksesibilitas. | Komponen terhubung ke data/API nyata dan bukti uji browser. | Memiliki UI; perubahan kontrak API/aturan dibahas dengan Teofilus dan Noval. |
| Teofilus — Backend Developer dan dokumentasi sistem | API demo, validasi, sambungan server ke model, metadata bukti, use case dan diagram. | Endpoint berjalan, tes API, kontrak dan diagram sesuai kode. | Memiliki backend; tidak dibebani seluruh dokumentasi tim atau firmware. |

Pemilik modul menulis catatan modulnya. Teofilus menyatukan diagram, bukan menulis semuanya. Setelah perangkat tersedia, Yola memiliki pekerjaan firmware/perangkat dengan pendampingan Noval.

Review: kode Malik ditinjau Noval; kode Noval ditinjau Malik; kode Fransisco dan Teofilus ditinjau Noval, dengan Malik sebagai cadangan sesuai kemampuan. Yola memeriksa penerimaan pengguna. Review tambahan hanya untuk perubahan batas modul atau risiko khusus.

## 3 Koordinasi dan persetujuan

1. Yola mencatat kebutuhan klien di Trello: masalah pengguna, contoh penggunaan, kriteria penerimaan. Semua anggota boleh mengusulkan kartu.
2. Malik menetapkan prioritas dan batas hasil. Masukan baru tidak otomatis menjadi komitmen minggu berjalan.
3. Noval bersama pelaksana menentukan pendekatan, dependensi, satu pemilik dan satu reviewer. Pecah tugas menjadi maksimum 3 jam kerja fokus per kartu.
4. Pemilik mengambil kartu Ready, mengerjakan cabang Git, menjalankan pemeriksaan dan melampirkan PR/hasil.
5. Reviewer memeriksa kode, kriteria dan bukti. Perbaikan kembali ke pemilik; tidak ada review mandiri.
6. Yola menguji pekerjaan yang menyentuh alur pengguna. Pekerjaan teknis internal cukup dibuktikan kepada reviewer sesuai kriteria kartu.
7. Noval menggabungkan kode yang disetujui dan menyiapkan build. Pemilik memindahkan kartu ke Done setelah bukti lengkap. Malik menyetujui milestone/rilis; klien memberi penerimaan melalui Yola.

| Keputusan | Penentu akhir | Masukan |
| --- | --- | --- |
| Prioritas, scope, tanggal, biaya | Malik | Yola untuk klien; Noval untuk kapasitas teknis |
| Kontrak API, struktur kode, integrasi | Noval | Pemilik modul terkait |
| Lulus review kode | Reviewer selain penulis | Tes dan kriteria kartu |
| Lulus kriteria pengguna | Yola | Kebutuhan yang disepakati dan bukti UAT |
| Rilis/demo publik | Malik | Build Noval dan penerimaan Yola |

Umumkan slot review tiap minggu. Target jawaban paling lambat satu hari kerja setelah slot review yang disepakati, bukan kewajiban selalu online. Terhambat lebih dari 30 menit kerja aktif: tulis masalah, percobaan dan bantuan yang dibutuhkan. Noval menangani hambatan teknis; Malik menangani lingkup, akses dan biaya.

Jika estimasi meleset, pecah hasil atau tukar prioritas. AI dan blockchain tetap wajib; kurangi kosmetik, jumlah variasi atau hosting publik lebih dahulu.

## 4 Pengaturan Trello

**Board:** `Smart Agro | Demo 3 Minggu`. Satu board untuk produk, kode, dokumentasi dan IoT. Deskripsi board memuat repositori, dokumen acuan, slot kerja dan definisi Done.

| List | Aturan |
| --- | --- |
| Inbox / Backlog | Ide dan pekerjaan nanti; belum dijanjikan. |
| Ready minggu ini | Kriteria, pemilik/reviewer, dependensi dan kapasitas sudah jelas; prioritas tertinggi di atas. |
| Doing | Maksimum satu kartu per orang dan tiga kartu aktif untuk tim. Anggota lain dapat review, uji atau menyelesaikan kebutuhan. |
| Review | Ada hasil/PR dan cara uji; maksimum dua kartu. Kosongkan antrean sebelum mengambil fitur baru. |
| Uji / Demo | Lolos review, menunggu uji pengguna/integrasi; maksimum dua kartu. |
| Done | Kriteria dan bukti lengkap; kode sudah digabungkan. |

Terhambat: kartu tetap pada status asal, tambah label `BLOCKED`, penyebab, pemilik penyelesaian dan waktu pemeriksaan berikutnya.

Label: `Frontend`, `Backend`, `AI`, `Blockchain`, `IoT`, `Dokumen`, `Bug`, `BLOCKED`. Gunakan teks selain warna. Prioritas pada judul: `P0` demo berhenti/secret bocor/data hilang; `P1` syarat wajib demo; `P2` tambahan. Format judul: `[W2-03][P1][AI] Penjelasan rekomendasi dari model`.

Satu member Trello menjadi pemilik; reviewer tertulis dalam deskripsi. Checklist, komentar, lampiran dan due date standar cukup; tidak perlu Power-Up atau custom field berbayar.

### Template kartu

```text
Judul: [W?-??][P1][Area] Hasil yang harus terlihat
Tujuan pengguna:
Pemilik:
Reviewer:
Penguji penerimaan:
Estimasi fokus: ... jam, maksimum 3 jam
Slot kerja / tenggat:
Dependensi: tautan kartu, atau tidak ada

Cakupan:
Kriteria penerimaan yang dapat diuji:
1.
2.
3.
Cara verifikasi:
Bukti: PR / berkas / tangkapan layar / log / transaksi
Batas atau risiko:

[ ] Input/dependensi siap
[ ] Kriteria terpenuhi
[ ] Kasus gagal relevan diuji
[ ] Review selain penulis selesai
[ ] Kontrak/dokumen sesuai perubahan
[ ] Bukti penerimaan terlampir

Jika terhambat: masalah / percobaan / bantuan siapa / kapan diperiksa
```

### Contoh kartu siap disalin

**`[W1-N][P1] Proyek dapat dijalankan anggota lain`** — Noval; reviewer Malik; penguji Teofilus; 3 jam. Dependensi: akses Git. Selesai jika sumber Python ikut dibagikan dalam paket/repo tim, jalur tes dan README sesuai, serta anggota kedua menjalankan test/lint/typecheck/build. Pertahankan pemeriksaan parity. Bukti: PR dan hasil command anggota kedua.

**`[W2-M][P1][AI] Jelaskan hasil satu snapshot`** — Malik; reviewer Noval; penguji Yola; 3 jam termasuk sambungan transaksi pada rencana minggu kedua. Dependensi: API Teofilus dan akses model. Selesai jika model nyata merespons, identitas model/prompt/snapshot tercatat, tindakan aturan tetap utuh, serta data basi dan pH kosong tidak menghasilkan dosis. Saat model gagal, sesi tetap tersimpan. Bukti: respons yang disanitasi dan lima hasil uji. Pisahkan subpekerjaan wallet ke checklist dengan pemilik tetap Malik.

**`[W2-T][P1][Backend] API dan bukti dapat diverifikasi`** — Teofilus; reviewer Noval; penguji Yola; 3 jam. Dependensi: model, format catatan, contoh transaksi Malik. Selesai jika timeout/limit bekerja, hash berkas cocok dengan data transaksi pada chain yang benar, receipt pending tidak menjadi sukses, dan berkas yang diubah gagal cocok. Bukti: tes API, berkas/hash/receipt dan uji perubahan. Malik tetap pemilik pengiriman transaksi.

## 5 Tools minimum

| Kebutuhan | Pilihan | Cara pakai |
| --- | --- | --- |
| Tugas | Trello gratis | Sumber status dan prioritas; hindari backlog ganda. |
| Komunikasi | Satu grup WhatsApp; Google Meet | Keputusan penting diringkas pada kartu. Tidak perlu Slack/Discord sekaligus. |
| Desain | Figma Starter atau Penpot | Satu berkas perubahan UI; gunakan komponen aplikasi yang sudah ada. |
| Dokumentasi | Markdown di Git; Google Drive/Docs untuk klien | Satu dokumen acuan dan log keputusan. Versi lama diberi status arsip melalui indeks, tidak dihapus. |
| Diagram | Mermaid atau diagrams.net | Use case dan satu diagram alur data; semua pemilik memvalidasi bagiannya. |
| Kode | GitHub, VS Code; GitHub Desktop opsional | Cabang singkat, PR kecil, satu persetujuan sebelum merge. Kuota Actions/aturan cabang mengikuti paket repositori. |
| Pemeriksaan | Node test runner, ESLint, TypeScript, Vite | Sudah terpasang; pertahankan. CI dijalankan setelah kebutuhan Python tersedia dalam paket tim. |
| API | `curl.exe` atau Hoppscotch | Contoh request tanpa secret; Postman berbayar tidak diperlukan. |
| UI | Browser, DevTools, skrip Playwright yang sudah ada | Uji keyboard, ponsel, error dan pemulihan. Dokumentasikan instalasi Playwright agar tidak bergantung runtime satu orang. |
| AI | Satu API model | Pilih akses yang benar-benar tersedia, tetapkan batas biaya dan panggil lewat backend. |
| Blockchain | Wallet demo, satu testnet; devnet bila perlu | Buktikan akses RPC/faucet minggu pertama; token uji tidak perlu dibeli. |
| Demo | Laptop presenter, frontend/backend lokal | Pilihan utama tiga minggu. Hosting statis yang sudah digunakan boleh dipertahankan untuk simulator. |
| Tahap selanjutnya | PostgreSQL/Supabase | Saat perlu akun dan data bersama; belum wajib untuk demo satu laptop. |

Paket gratis bisa membatasi editor, kuota atau penggunaan; harga/kuota terkini belum diperiksa. Pilih satu alat per kebutuhan. Usulan plafon API AI: Rp100.000 untuk tiga minggu, ditetapkan Malik sebelum biaya diaktifkan. Ini batas internal, bukan estimasi harga vendor.

Backend minimum memakai Node.js/TypeScript, HTTP, `fetch` dan crypto bawaan. Framework/SDK baru hanya ditambahkan bila mengurangi pekerjaan nyata. Hosting statis tidak menjalankan backend AI. Demo daring memerlukan server/function dan pengaturan akses; untuk tiga minggu, ikat server lokal ke loopback laptop presenter. Jangan membuka endpoint berbiaya ke publik tanpa autentikasi serta pembatasan penggunaan.

## 6 Kapasitas dan rutinitas

Lima orang × 4–6 jam = 20–30 jam per minggu. Komitmen hanya 20 jam, bukan 30. Selama tiga minggu: 60 jam terencana, maksimum 90 jam bila tambahan waktu tersedia.

Per orang per minggu: sekitar 3 jam hasil utama, 30 menit rapat bersama, 15 menit update, 15 menit review/koordinasi. Waktu review/integrasi tambahan Noval masuk hasil utamanya, sehingga target fitur Noval lebih kecil. Sisa sampai 2 jam menjadi cadangan hambatan, belajar dan perbaikan.

Contoh slot: Selasa 90 menit dan Kamis 90 menit, ditambah rapat/update/review. Slot boleh berbeda; setiap anggota menuliskan ketersediaannya. Tidak perlu rapat harian untuk kapasitas ini.

| Waktu | Rutinitas | Hasil |
| --- | --- | --- |
| Mulai slot kerja, 2 menit | Tulis kartu, target dan bantuan yang dibutuhkan | Tim tahu pekerjaan aktif. |
| Akhir slot, 2 menit | Perbarui bukti, status, sisa estimasi, hambatan | Hindari “80% selesai” tanpa hasil yang bisa dilihat. |
| Sekali seminggu, 30 menit | Demo 10 menit; evaluasi 5 menit; rencana/kapasitas 15 menit | Satu target minggu berikutnya dan satu perbaikan cara kerja. |
| Tengah minggu | Noval/Malik memeriksa hambatan secara asinkron | Keputusan bantuan atau pengurangan scope; panggilan 10 menit hanya bila perlu. |
| Akhir minggu | Yola menyampaikan hasil ke klien setelah isi disetujui Malik | Hasil nyata, keterbatasan dan keputusan yang dibutuhkan. |

### Template pembagian tugas

```text
Target minggu:
Hasil wajib untuk demo:
Nama | Jam tersedia | Kartu utama | Reviewer | Dependensi | Bukti
Malik |
Noval |
Yola |
Fransisco |
Teofilus |
Cadangan yang benar-benar tersedia:
Fitur ditunda:
Keputusan yang diperlukan sebelum mulai:
```

### Template progres

```text
Nama / tanggal / kartu:
Selesai: hasil dan tautan bukti
Berikutnya: langkah pada slot kerja berikutnya
Terhambat: masalah, percobaan, bantuan siapa
Sisa estimasi: ... jam
```

### Template rapat dan evaluasi

```text
Demo: target diterima / belum diterima + bukti
Evaluasi: penyebab hambatan / selisih estimasi / satu perbaikan
Rencana: kartu prioritas / pemilik / reviewer / kapasitas
Keputusan klien yang mengubah prioritas:
Perbaikan cara kerja: pemilik dan tenggat
```

Pantau hasil yang diterima, kartu terhambat, waktu tunggu review dan cacat penghambat demo. Jumlah commit, baris kode dan jam online bukan ukuran kontribusi.

## 7 Rencana tiga minggu

Minggu dihitung sejak kickoff. Setiap baris merupakan kartu utama sekitar 3 jam fokus, ditambah 1 jam rutinitas/review. Pecah kartu jika terlalu besar setelah dibahas. Jalankan sesuai dependensi; tidak semua kartu dimulai bersamaan.

### Minggu pertama — dasar yang sama dan bukti akses

| Anggota | Fokus dan alokasi 3 jam | Target hasil |
| --- | --- | --- |
| Malik | W1-M: scope/model/jaringan 45 menit; panggilan model 60 menit; transaksi hash percobaan dan format catatan 75 menit. | Scope satu halaman, respons AI nyata, transaksi testnet/devnet nyata dan batas biaya. |
| Noval | W1-N: cek setup anggota 45 menit; paket Python/README 75 menit; kontrak integrasi dan pemeriksaan dasar 60 menit. | Anggota kedua dapat menjalankan proyek; kepemilikan modul dan jalur integrasi jelas. |
| Yola | W1-Y: kebutuhan klien 45 menit; lima kasus UAT 75 menit; datasheet dan kebutuhan alat acuan 60 menit. | Lima kasus dengan hasil diharapkan; daftar sensor untuk nanti; label sintetis jelas. |
| Fransisco | W1-F: telusuri alur 45 menit; rancangan dua interaksi 45 menit; snapshot tetap dan ekspor melalui alur sesi 90 menit. | Rancangan penjelasan/bukti disepakati; snapshot demo bisa diekspor tanpa data berubah. |
| Teofilus | W1-T: use case dan kontrak 60 menit; server lokal/health check 60 menit; validasi dan tes awal 60 menit. | Server dapat dijalankan, input rusak ditolak, kontrak AI dan bukti disepakati. |

**Target tim:** sumber dan setup bisa dibagikan; akses AI dan blockchain terbukti; format snapshot serta lima kasus disepakati. Jika layanan belum siap, selesaikan akses sebelum menambah UI. Penyiapan CI menyusul setelah paket tes dapat dijalankan ulang.

### Minggu kedua — satu alur lengkap

| Anggota | Fokus dan alokasi 3 jam | Target hasil |
| --- | --- | --- |
| Malik | W2-M: prompt berbasis bukti dan lima evaluasi 90 menit; alur wallet untuk hash snapshot final 90 menit. | AI menjelaskan aturan; catatan yang sama menghasilkan hash transaksi. |
| Noval | W2-N: integrasi frontend/API/wallet 90 menit; review dan CI atau skrip pemeriksaan berulang 90 menit. | Satu jalur utuh berjalan, kontrak antarmodul konsisten. |
| Yola | W2-Y: uji lima kasus 90 menit; uji pemahaman satu calon pengguna/klien bila tersedia 60 menit; prioritas isu 30 menit. | Hasil lulus/gagal dengan bukti. Uji anggota tim ditulis sebagai uji internal. |
| Fransisco | W2-F: integrasi penjelasan AI 90 menit; status wallet/pending/tercatat/gagal 90 menit. | UI memakai respons nyata; hasil tetap terkait snapshot yang benar walau simulasi berjalan. |
| Teofilus | W2-T: endpoint model dan timeout/limit 90 menit; ekspor metadata dan verifikasi hash/receipt 90 menit. | API tidak membocorkan key; berkas/hash/transaksi cocok; kegagalan tidak dilaporkan sukses. |

**Target tim:** satu demo lengkap dari simulator sampai AI dan transaksi tercatat. Gunakan kembali skenario bawaan. Jika belum terhubung, cadangan minggu ketiga diarahkan ke integrasi.

### Minggu ketiga — uji kegagalan dan demo

| Anggota | Fokus dan alokasi 3 jam | Target hasil |
| --- | --- | --- |
| Malik | W3-M: evaluasi AI sepuluh skenario/batas klaim 90 menit; transaksi akhir, cerita demo dan rilis 90 menit. | Tabel evaluasi AI, bukti blockchain yang bisa diperiksa ulang, keputusan rilis. |
| Noval | W3-N: perbaiki penghambat dan jalankan pemeriksaan 90 menit; paket serta latihan pada lingkungan anggota kedua 90 menit. | Build lolos, startup/pemulihan dipraktikkan, tidak bergantung path pribadi. |
| Yola | W3-Y: UAT 90 menit; panduan/laporan klien 60 menit; daftar pengadaan lanjutan 30 menit. | Hasil penerimaan, keterbatasan dan spesifikasi pengadaan tanpa pembelian prematur. |
| Fransisco | W3-F: loading/error, keyboard, layar kecil 90 menit; perbaikan UAT dan regresi sesi 90 menit. | Alur jelas di desktop/ponsel; navigasi, sesi, ekspor tetap bekerja. |
| Teofilus | W3-T: uji invalid input, timeout, secret dan metadata 90 menit; diagram/panduan API dan verifikasi 90 menit. | Kontrak sesuai implementasi; catatan bisa diverifikasi setelah restart. |

**Gerbang rilis:** tidak ada P0 terbuka; seluruh hasil wajib bagian 1 terpenuhi; AI berasal dari model nyata; receipt transaksi sukses dan uji perubahan berkas terbukti; pemeriksaan relevan lulus. Kegagalan layanan saat presentasi dijelaskan sebagai gangguan. Rekaman/receipt sebelumnya boleh menjadi cadangan dengan waktu jelas, bukan diklaim sebagai hasil baru.

**Presentasi 5–7 menit:** Yola menjelaskan kebutuhan serta sumber sintetis; Fransisco menunjukkan dua riwayat dengan nilai akhir sama; Teofilus menjelaskan validasi singkat; Malik menunjukkan AI dan blockchain; Noval menunjukkan verifikasi ulang serta batas sistem. Satu presenter boleh membawakan keseluruhan alur bila lebih lancar.

## 8 Definisi siap dan selesai

**Ready:** hasil jelas, satu pemilik/reviewer, maksimum 3 jam fokus, dependensi siap, kriteria serta cara uji tertulis. Kartu “buat backend” atau “belajar blockchain” harus dipersempit menjadi hasil yang bisa diperiksa.

**Done:** hasil berjalan, kasus normal/gagal relevan diuji, review selain penulis selesai, kode digabungkan, kontrak/dokumen sesuai dan bukti terlampir. Done kartu berbeda dari persetujuan rilis.

| Area | Pemeriksaan minimum |
| --- | --- |
| Fondasi | Node test, lint, typecheck, build dan parity Python. |
| AI | Model nyata; data basi/pH null/profil belum sah; data berisi instruksi tidak mengubah tugas model; timeout/429; output salah ditolak; tidak ada dosis atau diagnosis. |
| Blockchain | Hash cocok; perubahan satu nilai tidak cocok; jaringan salah; wallet menolak; pending; receipt gagal/tidak ditemukan; verifikasi setelah refresh. |
| UI | Keyboard, layar kecil, label sumber, loading/error; respons AI lama tidak ditempel pada sesi baru. |
| API | Jenis/rentang/ukuran input, origin/metode yang diizinkan, timeout dan pembatasan permintaan; key tidak muncul dalam log/bundle. |
| Data | Snapshot tetap; sumber simulasi dipertahankan; gagal operasi tidak menghapus sesi/bukti lama. |

Tes deterministik boleh mengendalikan respons layanan untuk menguji error. Bukti fungsi AI tetap memakai model nyata dan dicatat terpisah. localStorage cukup untuk demo terbatas; ekspor berkas bukti sebelum mengganti browser/origin.

Rencana mengandalkan kemampuan dasar Git dan JavaScript/TypeScript. Jika AI atau blockchain benar-benar dipelajari dari nol, 60 jam merupakan target ketat. Gunakan cadangan untuk belajar/integrasi, potong fitur tambahan, dan revisi tanggal bila hasil wajib belum tercapai. Jangan mengubah hasil palsu menjadi bukti demi tenggat.

## 9 Kebutuhan selanjutnya

| Kebutuhan | Pemilik | Kapan dan bukti siap |
| --- | --- | --- |
| Dokumen acuan dan log keputusan | Malik, dibantu Yola | Minggu 1; satu sumber resmi dan penambahan scope AI/blockchain tercatat. |
| Onboarding dan pemeriksaan otomatis | Noval | Minggu 1–3; anggota kedua dapat menjalankan sumber yang dibagikan. |
| Use case, diagram, API dan format bukti | Teofilus + Malik | Minggu 1, disesuaikan minggu 3; contoh sukses/gagal, versi dan aturan hash jelas. |
| Skenario UAT dan laporan klien | Yola | Sejak minggu 1; hasil serta perubahan terhubung ke kartu. |
| Layanan dan batas biaya AI | Malik | Minggu 1; akun aktif, batas penggunaan dan pemilik pembayaran. |
| Laptop/jaringan demo | Noval | Minggu 1–3; frontend/backend lokal diuji, internet untuk AI/testnet dan panduan restart tersedia. |
| Sensor dan alat acuan | Yola, review Noval | Setelah demo; ESP32, kapasitif, DS18B20, pH tanah + DMS dipilih berdasar datasheet unit. |
| Firmware dan transport | Yola + Noval | Setelah alat tersedia; nilai mentah, CRC/error, NTP/RTC, reconnect dan identitas perangkat. Pilih satu transport; HTTP bisa cukup untuk satu node. |
| Penerimaan serta riwayat nyata | Teofilus | Sesudah format sensor teruji; autentikasi, TLS, deduplikasi, urutan paket, waktu terima, status per sensor dan backup. |
| Adaptasi mesin keputusan | Malik + Noval | Sebelum data nyata masuk; `Sample.valid` kini satu status bersama, sedangkan telemetri membawa status per sensor/null. Jangan mengisi angka palsu untuk menyesuaikan tipe lama. |
| Data bersama dan akun | Teofilus + Noval | Saat perlu lintas perangkat/pengguna; DB, migrasi, hak akses, backup dan uji pemulihan. |
| Validasi agronomi | Yola + pendamping kompeten | Sebelum klaim operasional; kalibrasi, media, varietas, fase observasi, siklus dan pembanding. |

Makalah memperkirakan rakitan satu pot Rp486.000 dengan batas Rp500.000. Ini angka dokumen, bukan penawaran harga terkini. Alat ukur acuan, ongkir dan pengondisi pH tambahan belum tentu tercakup. Yola memeriksa harga, manual serta alat pinjaman sebelum Malik menyetujui pengadaan.

Sebelum merakit, pastikan tegangan, pin, jenis keluaran dan kalibrasi DMS sesuai manual unit. Jangan menghubungkan keluaran 5 V langsung ke GPIO ESP32. Lepaskan daya sebelum mengubah kabel dan jauhkan rangkaian dari air. Skema RS485 lama tidak dapat langsung dipakai pada rancangan tiga sensor sekarang.

**Keterampilan:** semua anggota memakai Trello, Git, PR dan laporan bukti. Fransisco fokus state asinkron, API dan aksesibilitas. Teofilus fokus validasi, error dan penyimpanan. Malik fokus evaluasi model, snapshot/hash, wallet dan receipt. Noval fokus review, integrasi dan reproduksibilitas. Yola fokus kebutuhan pengguna, UAT, datasheet, mutu pengukuran dan kalibrasi. Belajar lewat satu kartu nyata, bukan menguasai seluruh stack sekaligus.

## 10 Bukti analisis dan verifikasi

Inventaris mencakup 12 DOCX dan 5 PDF; teksnya diekstrak, lalu bagian scope, implementasi dan pengujian dibandingkan. Dokumen utama, blueprint, README, kontrak telemetri, mesin keputusan/sesi, integrasi, komponen, konfigurasi dan tes menjadi dasar rencana. Ini bukan audit tiap baris dependency atau audit visual seluruh halaman dokumen. Contoh skripsi bidang kesehatan serta panduan gaya Oxford diperlakukan sebagai referensi penulisan, bukan kebutuhan fitur. Variasi rancangan dalam `dumb` tidak otomatis berlaku bersamaan.

Graph kode cocok dengan commit aplikasi saat diperiksa. Repositori aplikasi bersih sebelum panduan ditambahkan. Kode dan dependency tidak diubah dalam penyusunan panduan ini.

Verifikasi dijalankan dengan Node v24.14.1 dan Python runtime lokal; cache serta hasil pemeriksaan berada di workspace.

| Command dari folder aplikasi | Hasil 26 September 2026 |
| --- | --- |
| `npm test` | Lulus 36/36, termasuk kesetaraan keputusan dan bukti 110 kasus Python. |
| `npm run lint` | Lulus, exit code 0. |
| `npm run typecheck` | Lulus, exit code 0. |
| `npm run build -- --outDir .tmp/team-plan-build` | Lulus; output pemeriksaan berada di folder sementara. |
| `python ../simulasi_pot.py --self-test` | Lulus; 10 skenario serta pemeriksaan batas. Eksekusi memakai path Python eksplisit. |

Regresi browser tidak dijalankan ulang dalam analisis ini. Deployment publik, hardware, integrasi model AI dan transaksi blockchain baru belum diverifikasi; semuanya merupakan rencana berikutnya, bukan kemampuan yang sudah selesai. Tes sekarang membuktikan baseline perangkat lunak yang diuji.

Rujukan utama workspace:

- [Makalah SmartAgro](<D:/Portofolio Project/Agricultur/Makalah_SmartAgro.docx>)
- [README aplikasi](<D:/Portofolio Project/Agricultur/simulasi-web/README.md>)
- [Kontrak telemetri](<D:/Portofolio Project/Agricultur/simulasi-web/docs/telemetry-v1.md>)
- [Mesin aturan TypeScript](<D:/Portofolio Project/Agricultur/simulasi-web/src/lib/agronomyEngine.ts>)
- [Acuan Python](<D:/Portofolio Project/Agricultur/simulasi_pot.py>)

Mulai pada kickoff: Malik mengunci target satu alur demo; Noval memastikan setup anggota kedua; Yola memasukkan lima kasus penerimaan; Fransisco menetapkan posisi dua interaksi; Teofilus menyepakati kontrak snapshot/API. Hanya kartu yang memenuhi Ready masuk komitmen minggu pertama.
