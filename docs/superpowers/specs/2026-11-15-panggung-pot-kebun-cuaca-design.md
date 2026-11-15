# Rancangan: panggung tanaman baru, pot pribadi dan kebun, cuaca, serta belajar dari data

Tanggal: 2026-11-15. Status: **disetujui pengguna (2026-11-15)**. Fase 0 ditambahkan setelah hasil riset SMTP pengguna.
Dasar: permintaan pengguna 2026-11-15 (dua pesan), pilihan "B", dan koreksi tentang tanaman tanpa data. Rancangan akun/pot yang sudah ada (`2026-11-13-akun-pot-design.md`) tetap berlaku dan diperluas di sini.

## 1. Tujuan dan alasan

Smart Agro hari ini adalah prototipe untuk presentasi. Arah berikutnya adalah proyek asli, dengan dua jenis pengguna:

- **Pot pribadi:** orang yang ingin menanam (cabai, bawang, tetapi juga anggrek, peoni, dan bunga eksotik) tanpa mau repot menganalisis.
- **Kebun:** orang yang bertani di atap atau kebun terbuka, beberapa zona sekaligus, dengan cuaca sebagai faktor besar.

Tujuan pekerjaan ini:

1. Pot, tanaman, dan lensa akar di dashboard dirombak total, dengan animasi yang pantas.
2. Fondasi proyek asli dipasang **tidak aktif**, supaya simulasi tetap utuh untuk presentasi.
3. Satu dashboard bisa memegang banyak pot/zona; tanamannya bisa diganti tanpa merusak data.
4. Cuaca memengaruhi tampilan (hujan, mendung, terik) untuk penanaman di luar ruangan.
5. Rekomendasi untuk tanaman baru **berasal dari data**: lebih dulu dari pengamatan pengguna itu sendiri, lalu dari pengguna lain yang sudah berhasil. Tidak ada saran yang dikarang.

## 2. Bukan tujuan dan anti-tujuan

- Bukan: mengaktifkan backend baru di Supabase produksi, mengganti penyedia email, atau memasang kunci penerbit. Itu bagian aktivasi (Fase 8), dan hanya atas persetujuan.
- Bukan: mengubah aturan keputusan cabai dan bawang dari makalah. Cuaca **tidak** mengubah kode keputusan mesin; ia tampil sebagai konteks.
- Bukan: peta, drone, marketplace, atau diagnosis foto (di luar cakupan sesuai `docs/diagram/README.md`).
- **Anti-tujuan:** AI yang terdengar yakin tanpa bukti. Angka ambang untuk anggrek atau peoni tidak boleh muncul dari pengetahuan umum model.
- **Anti-tujuan:** demo yang rusak atau melambat karena fondasi baru.

## 3. Batasan

- Sistem desain tetap (Fraunces Soft + General Sans, palet Sage dan lumut, semua warna lewat token, tema terang dan gelap, reduced motion wajib).
- Tidak ada angka agronomi baru tanpa sumber. Angka di `scenarios.json` dan makalah adalah satu-satunya sumber untuk cabai dan bawang.
- Commit, push, dan deploy hanya jika diminta. Migrasi baru tidak diterapkan ke cloud tanpa persetujuan.
- Setiap fase menjalankan pemeriksaan wajib (lint, typecheck, unit, build, `git diff --check`), tes browser terkait, dan screenshot 1440/768/390/320 px, terang dan gelap.
- Hanya diuji di Chrome (batas yang sudah diketahui).

## 4. Pendekatan yang dipertimbangkan

### 4.1 Visual panggung tanaman

| Opsi | Isi | Catatan |
| --- | --- | --- |
| a | Mempertajam `PlantIllustration` yang ada | Murah, tetapi dua tanaman dikode keras (`onion: boolean`); anggrek dan peoni tidak muat |
| **b (dipilih)** | Renderer SVG berbasis data: satu komponen `PlantScene` dengan "bentuk tumbuh" (semak, roset, umbi) dan variasi pot/media, animasi Framer Motion + CSS | Ringan, tajam di semua ukuran, ikut tema, mudah menambah spesies lewat data |
| c | Three.js atau Rive untuk seluruh panggung | Berat, dan pengguna pernah menolak tampilan buram; Rive tetap dicadangkan untuk maskot |

### 4.2 Cuaca

| Opsi | Catatan |
| --- | --- |
| Google Weather API | Wajib kunci Google Cloud dengan penagihan aktif; saat dicek masih berstatus Preview tanpa biaya, tetapi tidak ada jaminan ke depan. Tidak perlu karena ada opsi gratis |
| Satu penyedia langsung | Terkunci pada syarat satu pihak |
| **Antarmuka + adapter (dipilih)** | Aplikasi hanya mengenal `WeatherSnapshot`. Penyedia bisa diganti tanpa menyentuh UI. Di demo, sumbernya "cuaca simulasi" |

Analisis penyedia gratis (syarat dibaca dari halaman resmi pada 2026-11-15; syarat bisa berubah):

| Penyedia | Gratis | Boleh komersial? | Batas | Cocok untuk |
| --- | --- | --- | --- | --- |
| **Open-Meteo** | Ya, tanpa kunci | **Tidak.** Gratis hanya untuk situs/aplikasi non-komersial tanpa iklan atau langganan. Produk komersial wajib paket berbayar | 10.000/hari, 5.000/jam, 600/menit; CC BY 4.0; dibatasi per IP, jadi hosting bersama bisa kena batas lebih awal | Prototipe dan presentasi |
| **BMKG** (`api.bmkg.go.id`) | Ya | Halaman data terbuka hanya mewajibkan atribusi "BMKG"; ketentuan penggunaan umum BMKG menyebut integrasi aplikasi pihak ketiga dan penggunaan komersial butuh izin tertulis | 60 permintaan/menit/IP | Target produk di Indonesia, setelah izin dikonfirmasi |
| **WeatherAPI.com** | Ya, dengan kunci | Halaman harga: "Free covers light use, including commercial apps" | 100.000 panggilan/bulan, prakiraan 3 hari; paket $7/bulan = 3 juta panggilan | Cadangan komersial |
| **MET Norway** | Ya | Ya (CC BY 4.0) | Wajib `User-Agent` yang mengidentifikasi aplikasi; ≤20 permintaan/detik per aplikasi | Cadangan; akurasi tropis belum saya uji |
| OpenWeatherMap | 1.000 panggilan/hari | Ya | One Call 3.0 mensyaratkan kartu terdaftar (hanya ditagih bila melewati batas) | Tidak diprioritaskan |

Keputusan saya: adapter pertama **Open-Meteo** (tanpa kunci, prakiraan per jam, cocok untuk pengembangan dan presentasi non-komersial). Target produk Indonesia adalah **BMKG** (per kelurahan, resmi), dengan syarat izin tertulis dan tabel kode wilayah `adm4`. **WeatherAPI.com** jadi cadangan komersial. Kuota tidak menjadi masalah karena hasil di-cache per lokasi (dibulatkan ke sel ±0,1°) dan diperbarui tiap 30–60 menit, bukan per pengguna.

### 4.3 Mode demo dan mode asli

| Opsi | Catatan |
| --- | --- |
| Dua aplikasi terpisah | Duplikasi dan dua kali perbaikan |
| **Satu kode, satu flag build (dipilih)** | `VITE_APP_MODE=demo\|live` (bawaan `demo`). Sudah ada pola serupa: `VITE_SIGN_IN_REQUIRED` dan `build:cloud`. `live` menyembunyikan Ruang tanam, opsi tamu, dan kontrol cuaca simulasi |
| Hanya konfigurasi server | Tidak cukup: Ruang tanam adalah halaman, bukan data |

### 4.4 Belajar dari data

| Opsi | Catatan |
| --- | --- |
| Model menjawab dari pengetahuannya | Persis anti-tujuan kita |
| Model membaca dokumen/RAG | Sumber tak terkurasi, sulit diaudit |
| **Statistik dari data nyata; model hanya menjelaskan (dipilih)** | Sama dengan pola `aiExplanation.ts`: mesin menghitung dan memutuskan, model memberi kata-kata, keluarannya diperiksa. Setiap saran menyebut asal datanya |

## 5. Model domain (ringkas)

- **Katalog tanaman (`species`)**: id, nama, kategori (`sayur_buah`, `hias`, `perkebunan`), bentuk tumbuh (`semak`, `roset`, `umbi`), media bawaan, spesifikasi visual (palet, jumlah daun, bunga/buah, fase), **tingkat bukti** (`kurasi` atau `belajar`), dan ambang kecukupan data (`minHari`, `minCheckin`). Cabai rawit dan bawang merah `kurasi` (dari makalah). Anggrek bulan dan peoni `belajar`.
- **Penempatan (`placement`)**: `indoor`, `outdoor`, `rooftop`. **Cuaca aktif bila penempatan bukan `indoor` dan lokasi diketahui.** Jadi variabel penentunya adalah penempatan, bukan "pot atau kebun".
- **Kebun (`site`)**: nama, lokasi (lat/lon kasar), penempatan. Berisi banyak slot. Pot pribadi adalah kebun dengan satu slot (tanpa lokasi bila di dalam ruangan).
- **Slot tanam (pot atau zona)**: tempat satu tanaman pada satu waktu. Di server dipetakan ke `garden_pot` dari rancangan akun-pot, dengan `unit_id` opsional bila terhubung perangkat (keputusan: bentuk pastinya diputuskan lagi di Fase 6 setelah membaca skema `unit`).
- **Siklus tanam (`plant_cycle`)**: satu spesies pada satu slot dari tanggal tanam sampai akhir, dengan hasil (`berhasil`, `gagal`, `dihentikan`). **Mengganti tanaman menutup siklus lama dan membuka siklus baru.** Riwayat tetap utuh dan berlabel spesies. Hanya siklus yang selesai, dengan satu spesies, dan berdurasi cukup yang boleh masuk data komunitas. Dengan begitu produk A yang "iseng" diganti dari cabai ke bawang tidak mencemari data.
- **Cuaca (`WeatherSnapshot`)**: kondisi (`cerah`, `berawan`, `mendung`, `hujan`, `badai`), suhu, kelembapan udara, tutupan awan, angin, curah hujan, dan prakiraan beberapa jam. Satu bentuk untuk semua penyedia.

## 6. Mode belajar (jawaban atas koreksi pengguna)

Pengguna menegaskan: tanaman tanpa data **bukan** halaman kosong yang bertuliskan "data belum ada". Pengguna melakukan sesuatu dulu, sistem mengumpulkan, baru merekomendasikan.

**Empat tingkat bukti.** Sistem memakai tingkat tertinggi yang tersedia dan selalu menampilkan labelnya.

| Tingkat | Sumber | Kapan | Contoh kalimat |
| --- | --- | --- | --- |
| 0 Mengamati | Tidak ada saran | Awal siklus | "Sedang belajar: hari 3 dari ±14. Terekam 41 bacaan, 2 siraman, 1 pengecekan. Butuh 2 pengecekan lagi." |
| 1 Pola pot Anda | Riwayat pot ini | Setelah ambang kecukupan terpenuhi | "Dalam 12 hari, kelembapan turun rata-rata 3 poin/jam di siang hari. Saat Anda menandai 'sehat', kelembapan 52–64%. Berdasarkan pola pot Anda, bukan standar tanaman." |
| 2 Pola komunitas | Siklus berhasil milik pengguna lain | Setelah cukup siklus dari cukup pemilik (opt-in) | "Dari 7 siklus anggrek yang berhasil (4 pemilik), siraman rata-rata tiap 5–6 hari. Belum dikurasi." |
| 3 Profil kurasi | `profile_version` terbit (alur kurasi yang sudah ada) | Setelah kurator menyetujui | Aturan mesin seperti cabai dan bawang |

**Yang dilakukan pengguna di tingkat 0:** pot memancarkan bacaan (sensor), pengguna mencatat siram dan pupuk di jurnal (`care_journal` sudah ada, termasuk jenis `inspection`), dan melakukan **pengecekan** singkat: sehat, biasa, atau bermasalah, dengan catatan opsional. Pengecekan adalah label hasil yang membuat data bisa dipelajari. Di akhir siklus, satu ketukan menandai hasil.

**Yang menghitung adalah kode, bukan model.** Fitur seperti rentang kelembapan saat "sehat", laju kering, dan respons terhadap siraman dihitung deterministik. Model hanya merangkai kalimat dan keluarannya diperiksa seperti `checkAiText`. Saran tingkat 1 hanya berbunyi "tetap dalam rentang yang pernah Anda tandai sehat"; ia tidak pernah mengklaim apa yang "optimal untuk spesies".

**Pencegahan data buruk (tingkat 2):** opt-in berbagi data, tanpa id akun atau lokasi tepat (hanya zona iklim kasar), ambang jumlah pemilik berbeda (anonimitas k), pemangkasan pencilan, siklus harus satu spesies dan berdurasi cukup, pengalaman dinilai dari rekam jejak (siklus berhasil), bukan pengakuan diri, dan kurator bisa mengecualikan sumber. Hasil agregat yang matang dapat diajukan sebagai kontribusi profil lewat alur kurasi yang sudah ada.

**Angka awal (keputusan saya, bisa diubah di katalog):** tingkat 1 setelah ≥7 hari rekaman, ≥3 pengecekan, ≥2 siraman terukur; tingkat 2 setelah ≥5 siklus berhasil dari ≥3 pemilik berbeda. Ini ambang kecukupan data, bukan klaim agronomi.

## 7. Fase pengerjaan

Setiap fase bisa dirilis sendiri dan berhenti dengan keadaan sehat. Fase 1–5 hanya frontend dan tampak di demo. Fase 6–7 adalah fondasi backend yang tidak aktif. Fase 8 adalah aktivasi.

| Fase | Isi | Tampak di demo | Aktif di produksi |
| --- | --- | --- | --- |
| 0 | Akun: daftar lengkap, verifikasi kode, email profesional | **Ya** | Ya (cloud Auth, atas persetujuan) |
| 1 | Katalog tanaman | Tidak | Ya (refaktor) |
| 2 | Panggung tanaman baru + Ruang tanam disatukan | **Ya, besar** | Ya |
| 3 | Cuaca | Ya (simulasi) | Hanya simulasi |
| 4 | Pot pribadi dan kebun, banyak profil, siklus tanam | Ya | Ya (lokal) |
| 5 | Mode belajar (tingkat 0–1) | Ya | Ya (lokal) |
| 6 | Persistensi server dan mode `live` | Tidak | Tidak |
| 7 | Pengetahuan komunitas (tingkat 2) | Tidak | Tidak |
| 8 | Aktivasi setelah presentasi | n/a | atas persetujuan |

### Fase 0. Akun, verifikasi kode, dan email

Latar: pengguna menguji SMTP dan hasilnya baik (email tiba di Gmail, tidak masuk Spam). Ia meminta alur daftar yang lazim di aplikasi profesional.

Temuan sebelum merancang:
- **Persiapan pertama sudah ada** untuk akun mana pun yang belum menyimpan pot (Google dan email), di gerbang `App.tsx`. Tesnya ada di `pot-setup-browser`. Bila akun uji langsung masuk dashboard, akun itu sudah menyimpan pot. Fase ini menambah tes untuk akun Google baru dan menjaga urutannya.
- Nama pengirim di cloud **sudah "Smart Agro"** (`smtp_sender_name`). Tulisan "saya" muncul karena Gmail menamai email dari akun yang sama dengan penerimanya "saya". Uji dengan penerima berbeda. Alamat pengirim tetap alamat Gmail sampai memakai domain sendiri (Fase 8).
- Cloud kini: kode OTP 8 angka berlaku 1 jam; templat reset sandi masih berbahasa Inggris.
- Nama tampilan diambil dari `full_name`, lalu `name`, lalu bagian depan email. Karena `full_name` Google didahulukan, nama yang diedit pengguna butuh kunci tersendiri (`display_name`) yang dibaca pertama.

Yang dibangun:
1. **Form Daftar:** Nama, Email, Kata sandi, **Konfirmasi kata sandi** (harus cocok, pesan jelas). Nama dikirim sebagai `user_metadata.display_name`.
2. **Layar kode** setelah Daftar: masukkan kode 6 angka dari email (`autocomplete="one-time-code"`, tempel diterima, **Kirim ulang** dengan jeda 60 detik, **Ganti email**). Verifikasi lewat `POST /auth/v1/verify` (tipe `signup`). Berhasil → Persiapan pertama → dashboard. Kode dipilih sebagai jalur utama karena bekerja lintas perangkat (daftar di laptop, baca email di ponsel) dan tidak bergantung pada tab yang sama; **tautan di email tetap ada sebagai cadangan** tanpa kode tambahan di aplikasi.
3. **Nama tampilan** (bukan username unik; nama unik butuh tabel dan pemeriksaan tersendiri): dibaca dari `display_name` dulu, bisa diubah di `#profil` (1–40 karakter, dirapikan, divalidasi seperti `parsePot`).
4. **Email profesional:** templat HTML berbahasa Indonesia untuk konfirmasi dan reset sandi. Berisi logo (PNG yang dihosting di `public/mail/`, karena Gmail tidak menampilkan SVG), palet Sage, kode besar yang mudah disalin, teks pratinjau (preheader), tombol cadangan, dan catatan keamanan. Tata letak berbasis tabel dengan gaya inline agar tampil di Gmail, Outlook, dan mode gelap. Templat disimpan di `supabase/templates/` dan diterapkan lewat skrip (tidak ada rahasia di dalamnya). Subjek dibuat statis ("Kode verifikasi Smart Agro").
5. **Pengaturan Auth cloud:** OTP 6 angka (bukan 8), berlaku 10 menit (bukan 1 jam, untuk mempersempit jendela tebakan); batas `rate_limit_verify` bawaan tetap.

Urutan penerapan (aman untuk frontend lama): pratinjau email disetujui pengguna → cadangan konfigurasi Auth → terapkan templat dan OTP ke cloud (tautan tetap ada, jadi frontend lama tetap berfungsi) → push frontend baru → uji manual dengan Gmail kedua.

Verifikasi: unit untuk validasi form; tes browser dengan Auth tiruan (daftar → kode → persiapan pertama; kode salah; kirim ulang; sandi tidak cocok); tes lama tidak berubah. **Batas:** server lokal memakai `GOTRUE_MAILER_AUTOCONFIRM`, jadi pengiriman dan verifikasi kode nyata tidak dapat diuji lokal; itu diuji manual di cloud.

### Fase 1. Katalog tanaman (refaktor, tampilan sama)

- `src/lib/species.ts`: katalog di atas, dengan cabai rawit dan bawang merah dipetakan dari `scenarios.json`; anggrek bulan dan peoni sebagai entri `belajar` tanpa profil agronomi.
- Ganti `onion: boolean` (41 kemunculan di 8 berkas: `App.tsx`, `PlantIllustration`, `PlantPotVisualizer`, `PlantStage`, `Instruments`, `simulation.ts`, `dashboardFacts.ts`, `agronomyEngine.ts`) dan `PotSetup['crop']` (`'cabai' | 'bawang'`) menjadi id spesies.
- Pot disimpan di metadata Auth dan divalidasi di klien oleh `parsePot`; tidak ada batasan `crop` di basis data, jadi fase ini murni frontend. `parsePot` menerima id katalog, dan nilai lama `cabai` dan `bawang` tetap valid sebagai alias supaya token dan sesi lama tetap terbaca.
- **Selesai bila:** semua tes yang ada lulus tanpa diubah, dan tidak ada perbedaan visual.
- Risiko: sesi tersimpan di localStorage dan metadata token pengguna lama. Tes baca-lama wajib.

### Fase 2. Panggung tanaman baru

- **2.0 (sebelum kode):** riset referensi singkat dan **mock HTML di `design-previews/`** untuk disetujui pengguna (alur yang selalu dipakai pengguna): tiga spesies × siang/malam. Porting dimulai setelah mock disetujui.
- **Arah animasi (pengguna, 2026-11-15 siang):** "seperti aplikasi Apple: interaktif, elegan, menarik". Pengguna menyodorkan tiga opsi untuk saya sesuaikan: **dotLottie** (maskot dengan beberapa ekspresi dan adegan; runtime terbuka, editor dan aset tertentu punya batas paket), **Compose Canvas** (tanaman, akar, maskot digerakkan langsung oleh sensor; lewat kode, ilustrasi lebih manual), **Friction** (editor animasi vektor sendiri; ekspor SVG cocok untuk web, perlu adaptasi untuk Android). Penyesuaian saya (belum disetujui): aplikasi ini web (React), jadi Compose Canvas hanya relevan bila pembungkus Android Codex menjadi native, bukan untuk panggung web; idenya, **adegan digerakkan nilai sensor lewat kode**, tetap dipakai dengan SVG/Canvas + gerak berbasis pegas (Framer Motion sudah ada). Maskot: Rive (keputusan 2026-11-13) atau dotLottie; 2.0 membandingkan ukuran runtime, input interaktif, dan lisensi aset sebelum memilih. Friction hanya alat pembuat bila ada animasi SVG yang cocok. Prinsip rasa Apple untuk mock 2.0: gerak berpegas dan inersia, kontinuitas (tidak ada yang tiba-tiba muncul/hilang), manipulasi langsung (seret/ketuk di adegan), kedalaman halus, dan reduced motion tetap dihormati.
- `PlantScene` menggantikan `PlantIllustration` dan isi `PlantStage`:
  - pot dan media bervariasi (terakota, polybag, bedeng; tanah, sekam, kulit pakis untuk anggrek);
  - tiga bentuk tumbuh (semak, roset, umbi) dan penampang akar baru: lapisan media, gradien kelembapan, akar yang tumbuh menurut spesies (akar udara untuk anggrek), probe yang berdenyut, tetes yang meresap setelah siram;
  - animasi: siram (kaleng, air, riak), goyang daun, napas probe, mekar; tertib dengan reduced motion.
- **Ruang tanam memakai `PlantScene` yang sama**, jadi tidak ada lagi dua gambar berbeda.
- Selesai bila: tes browser dashboard dan UI lulus, teks 200% tidak meluap di 375 dan 320 px, screenshot lengkap.
- Risiko: bobot SVG dan jumlah animasi. Anggaran: tidak ada jank di layar ponsel menengah; animasi berhenti saat tab tersembunyi.

### Fase 3. Cuaca

- `WeatherSnapshot` dan antarmuka `WeatherProvider` di `src/lib/weather.ts`; penyedia `simulated` (cerah, berawan, mendung, hujan, terik) dengan kontrol "Cuaca simulasi" di demo.
- Lapisan langit di `PlantStage`/`SkyScene`: awan, tetes hujan, sinar dan riak panas, goyang angin; basah di permukaan pot untuk penempatan luar ruang. Dalam ruangan: cuaca tampil kecil sebagai konteks, tidak menggerakkan adegan.
- Cuaca tampil sebagai catatan konteks pada saran ("hujan ±3 jam lagi: pertimbangkan menunda siram"), tanpa mengubah kode keputusan mesin. Perubahan aturan butuh validasi agronomi dan di luar fase ini.
- **Dormant:** edge function `weather-forecast` (di repo, tidak di-deploy) dengan adapter Open-Meteo dan tes memakai fixture rekaman; adapter BMKG dan WeatherAPI hanya didokumentasikan. Browser tidak memanggil penyedia langsung (CSP tetap), hanya function kita.
- Selesai bila: demo bisa memutar semua kondisi cuaca, tes adapter lulus dengan fixture, `docs/` mencatat syarat tiap penyedia.

### Fase 4. Pot pribadi dan kebun, banyak profil, siklus tanam

- Wizard "Siapkan" (menggantikan `PotSetup` satu pot): pilih **Pot pribadi** atau **Kebun**, penempatan, lokasi bila luar ruang, tanaman dari katalog, tanggal tanam.
- Pemilih pot/zona di dashboard (satu dashboard, banyak profil). Mode Kebun: ringkasan zona (status tiap zona, cuaca kebun) di atas panggung.
- **Ganti tanaman** di slot yang sama: dialog konfirmasi yang menjelaskan bahwa siklus lama ditutup dan riwayatnya disimpan; siklus baru dimulai.
- Penyimpanan lokal per akun dan per slot, mengikuti rancangan akun-pot. Data demo menyertakan satu pot anggrek dan satu kebun dua zona, sehingga presentasi dapat menunjukkan keduanya.
- Selesai bila: tes browser untuk wizard, pemilih, dan ganti tanaman lulus; riwayat siklus lama tetap terbaca; tes akun yang ada tidak berubah.

### Fase 5. Mode belajar (tingkat 0 dan 1)

- Kartu "Sedang belajar" di panggung: kemajuan, apa yang sudah terekam, dan satu hal yang bisa dilakukan sekarang (catat siram, lakukan pengecekan).
- Pengecekan harian singkat (sehat/biasa/bermasalah) dan penanda hasil akhir siklus.
- Modul fitur deterministik (`src/lib/observation.ts`): rentang saat "sehat", laju kering, respons siram, dengan tes unit memakai data sintetis yang diberi label sintetis.
- Penjelasan tingkat 1 lewat jalur AI yang ada (`aiExplanation.ts`, tambahan prompt `smart-agro.explain.v2`), dengan label asal data dan pemeriksaan keluaran.
- Demo: anggrek di sesi simulasi memperlihatkan perjalanan dari tingkat 0 ke tingkat 1 memakai data simulasi miliknya sendiri. Tidak ada data komunitas palsu.
- Selesai bila: tes unit fitur, tes prompt (tidak menyebut dosis atau angka yang tidak ada di bukti), dan tes browser kartu belajar lulus.

### Fase 6. Persistensi server dan mode `live` (tidak aktif)

- Migrasi: `site`, `plant_cycle`, perluasan `garden_pot` (+ `site_id`, `unit_id` opsional, `placement`), RPC `SECURITY DEFINER` dengan `search_path` terkunci, hak EXECUTE sempit, RLS, dan tes integrasi (pola yang sama dengan tahap 6–12).
- Edge function `weather-forecast` lengkap dengan CORS terkunci; tidak di-deploy.
- Flag `VITE_APP_MODE=live`: menyembunyikan Ruang tanam, tamu, dan cuaca simulasi; `build:live`; tes yang memeriksa tampilan `live` (tanpa Ruang tanam).
- Selesai bila: suite backend penuh lulus dari basis data baru, CI hijau, **cloud tidak berubah**.

### Fase 7. Pengetahuan komunitas (tingkat 2, tidak aktif)

- Persetujuan berbagi (opt-in) per slot, tabel agregat anonim (zona iklim kasar, tanpa id akun), ambang k, pemangkasan pencilan, pengecualian oleh kurator, tautan ke alur kontribusi profil.
- Fungsi statistik di basis data atau function terjadwal; hasilnya diberi label "belum dikurasi".
- Tes memakai data sintetis berlabel; tes khusus untuk skenario keracunan data (ganti tanaman berulang, siklus pendek, satu pemilik banyak akun).
- Selesai bila: tes integrasi lulus dan tidak ada jalur yang membuka data per-pengguna ke pengguna lain.

### Fase 8. Aktivasi (setelah presentasi, atas persetujuan)

Daftar periksa, dikerjakan satu per satu dengan persetujuan: terapkan migrasi ke cloud (dengan cadangan lebih dulu), deploy `weather-forecast`, pasang kunci penyedia cuaca atau izin BMKG, `build:live` dan hosting, uji SMTP nyata (`docs/panduan-smtp.md`), domain sendiri, kunci penerbit asli di `ISSUER_PUBLIC_KEYS`.

## 8. Urutan dan titik berhenti

Fase 0 dulu (pengguna nyata sudah mendaftar di demo publik, dan fase ini tidak bergantung pada fase lain), lalu Fase 1 (membuka jalan), lalu Fase 2 (nilai terbesar, tampak di presentasi). Bila waktu presentasi mendesak, berhenti setelah Fase 2, Fase 3, atau Fase 5 dengan keadaan yang sudah bisa dirilis. Fase 6–7 tidak mengubah tampilan demo dan bisa menunggu.

## 9. Diserahkan kepada pembangun

- Bentuk visual pot, palet tiap spesies, dan jumlah partikel animasi (diputuskan lewat mock Fase 2).
- Nama kolom dan indeks pada migrasi Fase 6–7, mengikuti pola migrasi yang ada.
- Daftar tanaman tambahan untuk Kebun: **hanya empat spesies di awal**. Tanaman kebun lain ditambahkan sebagai data katalog setelah pengguna menyebutkannya.

## 10. Keputusan saya yang belum disetujui pengguna

1. Cuaca tidak mengubah keputusan mesin (hanya konteks).
2. Penentu cuaca adalah penempatan, bukan jenis pot atau kebun.
3. Adapter cuaca pertama: Open-Meteo; target Indonesia: BMKG; cadangan komersial: WeatherAPI.com.
4. Ambang kecukupan data (7 hari, 3 pengecekan, 2 siraman; 5 siklus, 3 pemilik).
5. Mock disetujui dulu sebelum porting Fase 2.
6. Hanya empat spesies di awal.
7. Fase 0: nama tampilan, bukan username unik; kode sebagai jalur utama dengan tautan sebagai cadangan; OTP 6 angka berlaku 10 menit.
8. Pemeriksaan pembangun dilakukan sendiri (membaca dokumen sebagai pembangun) karena tidak ada subagen yang diminta.

## 11. Tambahan pengguna (2026-11-15 siang): ringkasan, katalog, nama, dan kode tanaman

Persyaratan dari pengguna. Dirancang rinci saat Fase 1 (katalog) dan Fase 4 (pot pribadi dan kebun), bukan sekarang.

1. **Ringkasan = tempat berganti produk.** Satu akun bisa punya banyak produk. Satu persona bisa punya pot pribadi **dan** tanaman kebun, dan keduanya berbeda perlakuan. Dijelaskan dulu kepada pengguna: **produk untuk kebun belum ada**. Kebun berisi banyak tanaman, tidak mungkin menancapkan satu sensor per tanaman, dan sensornya pasti banyak. Di prototipe, kebun adalah data simulasi.
2. **Memilih tanaman lewat pencarian.** Spesies akan banyak (bawang merah, bunga mawar, dan seterusnya); pengguna tidak memilih dari daftar panjang, melainkan lewat kolom cari. Katalog menyimpan nama umum, alias, dan nama Latin yang bisa dicari.
3. **Nama panggilan.** Spesies tetap (bunga mawar), tetapi pengguna boleh memberi nama sendiri. Bila pengguna malas, sistem memberi nama berurutan ("Bunga mawar 1, 2, 3").
4. **Kode unik per tanaman**, gabungan spesies dan urutan dari sistem (contoh: mawar berkode berawalan E). Disimpan sebagai **angka bulat, bukan string**, supaya mudah ke basis data dan membantu pengguna menyebut tanamannya.

Interpretasi saya (**belum disetujui pengguna**, ditanyakan saat Fase 1):
- Katalog memberi tiap spesies `species_id` (angka bulat) dan huruf tampilan. Tiap tanaman mendapat `plant_no`, angka berurut per akun dari sistem.
- Yang disimpan satu angka bulat: `code = species_id * 1_000_000 + plant_no`. Huruf **hanya tampilan** ("E-000123"), diturunkan dari katalog, sehingga basis data tidak menyimpan string dan tidak ada ambiguitas.
- Pertanyaan terbuka: apakah huruf "E" itu inisial spesies atau kode kategori? Dan apakah nomor berurut per akun atau global?
- Nama panggilan bukan identitas (tidak unik, sama seperti nama tampilan akun); kode angka yang menjadi identitasnya.

**Yang sudah diputuskan saat Fase 1 dikerjakan (2026-11-15, di `src/lib/species.ts`):**
- `speciesId` sudah diberikan: cabai 1, bawang merah 2, anggrek bulan 3, peoni 4. Angka ini **permanen** begitu kode tanaman terbit; batas atas 2146 supaya `speciesId * 1_000_000 + plant_no` muat di `integer` Postgres (dijaga tes).
- Huruf tampilan belum ada di katalog: menunggu jawaban pengguna atas pertanyaan di atas. Menambahnya nanti satu bidang data.
- Alias dan nama Latin untuk pencarian belum dimasukkan (belum ada pemakainya); ditambahkan bersama kolom cari di Fase 4. Katalog kini hanya memuat bidang yang dipakai.
- Id spesies kurasi tetap `cabai` dan `bawang` (nilai itu sudah tersimpan di token dan sesi pengguna), jadi tidak ada alias dan tidak ada migrasi. `parsePot` menolak anggrek dan peoni sampai Fase 4 menyediakan perjalanan "mengamati".
