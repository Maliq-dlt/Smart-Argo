# Use case dan flowchart Smart Agro

> Revisi produk terbaru: [paket v2](v2/README.md), termasuk energi, QR, reward dan maskot. Paket di bawah merupakan referensi simulator dan rancangan demo sebelumnya.

Paket sumber diagram untuk Mermaid, PlantUML, Miro dan editor diagram lain. Disusun dari aplikasi versi 1.10.0, kontrak telemetri serta rencana demo tim. Paket membedakan **SAAT INI**, **RENCANA DEMO**, dan **IOT BERIKUTNYA**; warna hanya membantu, bukan satu-satunya penanda.

## Berkas dan tujuan

| Berkas | Isi | Format |
| --- | --- | --- |
| `01-use-case.puml` | Use case UML: aktor di luar sistem, asosiasi, include dan extend | PlantUML |
| `01-use-case.mmd` | Isi use case yang sama untuk editor Mermaid | Mermaid flowchart; representasi visual, bukan tipe UML native |
| `02-alur-aplikasi.mmd` | Alur aplikasi yang sudah berjalan: sesi, simulasi, perawatan, impor/ekspor dan pratinjau paket | Mermaid flowchart |
| `03-alur-demo-ai-blockchain.mmd` | Rencana AI, snapshot tetap, persetujuan wallet, receipt dan verifikasi hash | Mermaid flowchart |
| `04-mesin-keputusan.mmd` | Urutan keputusan `evaluate()` beserta kondisi penahanan dan prediksi | Mermaid flowchart |
| `05-arsitektur.mmd` | Hubungan browser, penyimpanan, backend AI, blockchain dan jalur IoT berikutnya | Mermaid flowchart |
| `svg/` | Hasil render kelima Mermaid untuk ditaruh di board atau dokumen | SVG vektor |

Diagram aplikasi dan mesin keputusan menggambarkan implementasi saat ini. Diagram AI/blockchain menggambarkan rancangan yang belum diimplementasikan. Diagram arsitektur menggabungkan ketiganya dengan label status dan garis putus-putus untuk integrasi rencana.

## Cara menggunakan

### Mermaid Live dan editor Mermaid

1. Buka [Mermaid Live](https://mermaid.live/).
2. Salin seluruh isi satu berkas `.mmd` ke editor. Jangan menyertakan pagar Markdown seperti tiga backtick.
3. Gunakan ekspor SVG/PNG atau simpan sumbernya. Satu berkas memuat satu diagram.
4. Jika memakai dokumen Markdown, bungkus isi `.mmd` dalam blok kode berbahasa `mermaid`.

Sintaks memakai `flowchart`, `subgraph`, label dalam tanda kutip, dan bentuk dasar agar mudah dipindahkan. Versi Mermaid yang sangat lama mungkin berbeda tata letaknya. Mermaid tidak memiliki deklarasi `usecaseDiagram` native; karena itu versi use case Mermaid diberi keterangan representasi visual.

### PlantUML untuk use case UML

1. Buka editor yang mendukung [PlantUML Use Case](https://plantuml.com/use-case-diagram), misalnya ekstensi PlantUML atau editor web pilihan.
2. Tempel `01-use-case.puml` utuh, termasuk `@startuml` dan `@enduml`.
3. Render ke SVG/PNG. Gunakan berkas ini bila laporan memerlukan notasi use case UML, termasuk figur aktor dan oval.

Arah `include` menunjuk use case yang disertakan; arah `extend` menunjuk use case dasar. Asosiasi aktor berupa garis tanpa panah. Diagram use case tidak menyatakan urutan langkah; urutannya berada pada flowchart.

### Miro

1. Jika workspace menyediakan aplikasi Mermaid atau PlantUML, buka aplikasi tersebut dan tempel sumber yang sesuai. Ketersediaan aplikasi serta hak pemasangan mengikuti workspace.
2. Cara tanpa aplikasi tambahan: masukkan SVG dari folder `svg` melalui unggah gambar pada board. Jika versi Miro yang dipakai tidak menerima SVG, ekspor PNG dari Mermaid Live lalu unggah PNG.
3. Simpan sumber `.mmd`/`.puml` bersama board sebagai lampiran atau teks agar bisa diedit ulang.

SVG/PNG adalah gambar diagram, bukan jaminan konversi menjadi shape Miro yang bisa diedit satu per satu. Impor langsung di workspace Miro pengguna belum diuji. Tidak perlu memberikan secret atau data tanaman nyata kepada editor web untuk memakai contoh diagram ini.

### diagrams.net dan alat lain

Pada versi diagrams.net yang mendukung Mermaid, gunakan menu penyisipan Mermaid dan tempel isi `.mmd`. Nama/lokasi menu dapat berbeda. Jika fitur tersebut tidak ada, gunakan hasil SVG. Editor PlantUML memerlukan `.puml`; editor Mermaid memerlukan `.mmd`. Kedua format tidak saling dipertukarkan langsung.

## Batas sistem dan aktor

Batas sistem adalah aplikasi Smart Agro. Saat ini aplikasi berjalan di browser; backend AI dan penerima IoT belum tersedia.

| Aktor | Interaksi | Status |
| --- | --- | --- |
| Pengguna, pemula atau berpengalaman | Membuat sesi, mengamati, mencatat perawatan, impor/ekspor; nantinya meminta AI dan bukti blockchain | Aktor utama |
| Layanan AI eksternal | Menerima bukti terbatas dan mengembalikan penjelasan melalui backend | Rencana demo |
| Wallet pengguna | Meminta persetujuan, menandatangani dan mengirim transaksi tanpa memberikan private key kepada aplikasi | Rencana demo |
| Jaringan blockchain uji | Menerima transaksi serta menyediakan transaksi/receipt untuk verifikasi | Rencana demo |
| ESP32 dan sensor | Mengirim pengukuran nyata setelah perangkat serta kontrak integrasi siap | Tahap berikutnya, hanya pada arsitektur |

Malik, Noval, Yola, Fransisco dan Teofilus adalah peran pengembangan, bukan otomatis lima aktor aplikasi. Belum ada kebutuhan akun admin atau hak akses berbeda antara pengguna pemula dan berpengalaman.

## Katalog use case

| ID | Tujuan dan alur utama | Hasil / kondisi alternatif | Status |
| --- | --- | --- | --- |
| UC-01 | Membuat sesi berdasarkan profil tanaman/skenario yang tersedia | Sesi baru tidak menghapus sesi lain. Tidak mengasumsikan katalog tanaman daring. | Saat ini |
| UC-02 | Mengatur acuan lokal pot dan tampilan zona waktu | Profil tidak sah ditolak; pergantian media memulai sesi baru; zona tampilan tidak mengubah UTC. | Saat ini |
| UC-03 | Menjalankan perjalanan tanam atau eksperimen; menambah sampel otomatis, acak atau manual sesuai mode | Sampel sintetis ditambahkan; pause/resume dan batas sesi dihormati. | Saat ini |
| UC-04 | Melihat sensor, grafik serta statistik | Filter mengubah tampilan statistik, bukan riwayat keputusan. Data kosong/gagal dibedakan dari nol. | Saat ini |
| UC-05 | Membuat salinan dan membandingkan dua sesi | Perbedaan riwayat bisa ditinjau; bukan bukti kausal efek perawatan. | Saat ini |
| UC-06 | Mencatat siram atau pemupukan sesuai mode sesi | Catatan tidak menulis ulang pengukuran lama. Respons siram model hanya pada sampel sintetis berikutnya. | Saat ini |
| UC-07 | Melihat saran pemeriksaan, alasan, bukti dan penelusuran aturan di terminal | Satu aturan prioritas menentukan tindakan; saran dapat berupa pemeriksaan data. | Saat ini |
| UC-08 | Mengekspor sesi ke JSON | Ekspor tetap berlabel sintetis dan mencakup metadata sesi. | Saat ini |
| UC-09 | Mengimpor JSON sesi melalui UC-14 | Maksimum 2.000.000 byte; input tidak sah ditolak tanpa menghapus sesi lama. | Saat ini |
| UC-10 | Mengimpor paket telemetri melalui UC-15 dan melihat pratinjau | Maksimum 65.536 byte; paket gagal tidak mengganti paket lama. Paket valid tetap di luar riwayat keputusan simulasi. | Saat ini |
| UC-11 | Membekukan snapshot, menghitung ulang aturan di backend dan meminta penjelasan model | Hasil dikaitkan ke snapshot; timeout/kuota/output salah ditampilkan sebagai kegagalan AI. | Rencana demo |
| UC-12 | Menghitung hash berkas final melalui UC-17 dan mencatatnya lewat wallet pada blockchain uji | Pengguna dapat menolak; pending bukan sukses; isi lengkap catatan tetap di luar blockchain. | Rencana demo |
| UC-13 | Menghitung ulang hash berkas melalui UC-17, mengambil transaksi/receipt dan membandingkan | Status cocok hanya jika chain ID, receipt sukses dan data transaksi sesuai. | Rencana demo |
| UC-14 | Memvalidasi struktur sesi, versi, metadata dan kasus pot | Input rusak ditolak. Ini perilaku yang disertakan UC-09, bukan aktor. | Saat ini |
| UC-15 | Memvalidasi schema telemetri, identitas, waktu, sensor serta drip | Error/null tidak diganti angka buatan. | Saat ini |
| UC-16 | Mengevaluasi aturan agronomi terhadap kasus pot tervalidasi | Menghasilkan tindakan, alasan dan bukti; pada UC-11 fungsi dihitung ulang di backend yang direncanakan. | Mesin saat ini; pemakaian backend rencana |
| UC-17 | Menghitung SHA-256 atas byte UTF-8 berkas yang dipertahankan | Perubahan isi atau format byte mengubah hash. | Rencana demo |

UC-11 meng-extend UC-07 hanya ketika pengguna meminta penjelasan. UC-07 tetap lengkap tanpa AI. UC-12 bukan langkah wajib setiap kali saran tampil; pencatatan memerlukan pilihan dan persetujuan pengguna. UC-13 dapat dijalankan terpisah pada bukti yang telah tersimpan.

## Ketelitian flowchart keputusan

`04-mesin-keputusan.mmd` mengikuti prioritas kode, tidak mengganti ambang dengan angka dari blueprint lama. Acuan kelembapan berasal dari median observasi profil. pH bukan dasar dosis pupuk. Kondisi pertama yang cocok menentukan satu keputusan. Simpul tindakan berbentuk terminal: evaluasi berakhir di sana dengan tindakan, alasan dan bukti yang tersedia.

Detail pembandingan siram: bacaan sebelum tindakan harus valid dan berada dalam satu jam sebelum siram. Bacaan setelah tindakan harus valid pada menit ke-10 sampai ke-45. Delta memakai median bacaan setelah siram dikurangi bacaan valid terakhir sebelum siram. Pemeriksaan respons kecil berlaku pada menit ke-30 sampai ke-60 setelah tindakan.

Bukti pH memakai pengukuran valid dalam 24 jam ketika `ph_validated` benar. Tiga bacaan terakhir harus berada pada sisi luar rentang yang sama. pH kosong tidak menjadi nol. Untuk basah menetap, kode memakai jendela 3,01 jam, durasi minimal 3 jam dan jeda antarsampel maksimal 1 jam; semua sampel dalam jendela tersebut harus valid dan mencapai batas basah.

Prediksi menggunakan riwayat 6 jam terakhir, minimal 6 sampel yang semuanya valid selama 2,5 jam. Jika terdapat catatan siram, hanya sampel setelah siram terakhir yang dipakai. Slope harus kurang dari -1 poin per jam, R kuadrat minimal 0,8 dan indeks terakhir di atas acuan bawah. ETA di atas 12 jam tidak dipublikasikan. ETA yang layak tetapi lebih lama daripada kunjungan berikutnya tetap dapat tersimpan sebagai bukti walau keputusan AMATI.

## Batas fitur yang dipertahankan

- Impor telemetri tidak menyuntikkan data ke simulasi. Status per sensor pada telemetri masih berbeda dari `Sample.valid` pada mesin sekarang; adaptasi diperlukan sebelum IoT nyata terhubung.
- AI menjelaskan hasil aturan; tidak menggantikan pengukuran atau memberi diagnosis/dosis.
- Blockchain memeriksa kecocokan berkas, bukan kebenaran sensor, hasil AI atau tanggal kejadian.
- Berkas catatan yang di-hash dipertahankan byte-nya. Hash, chain ID, hash transaksi dan receipt disimpan dalam berkas bukti terpisah; menambah metadata tersebut ke catatan akan mengubah hash.
- Transaksi demo bernilai nol pada jaringan uji. Hanya hash dikirim melalui data transaksi; private key tetap di wallet.
- Cuaca, pompa otomatis, diagnosis foto, EC/NPK, akun admin dan blockchain mainnet tidak dimasukkan sebagai fitur yang sudah tersedia.
- Tahap IoT pada arsitektur tetap rancangan; tidak menunjukkan bahwa alat telah dibeli atau diuji.

## Sumber dan verifikasi

Sumber implementasi: `src/App.tsx`, `src/lib/agronomyEngine.ts`, `src/lib/simulation.ts`, `src/lib/sessionStore.ts`, `src/lib/sessionClock.ts`, `src/lib/telemetry.ts`, komponen aplikasi dan `docs/telemetry-v1.md`. Sumber target demo: `docs/sistem-kerja-tim.md` serta keputusan tim tentang AI/blockchain dan penundaan perangkat fisik.

Lima sumber Mermaid diuji menggunakan parser dan renderer Mermaid 11.12.2 pada Chrome lokal. Hasil SVG disertakan. PlantUML diperiksa struktur dan arah relasinya; belum dirender dengan engine PlantUML karena Java/PlantUML tidak tersedia di lingkungan ini. Tidak ada klaim pengujian impor langsung di Miro.

Perubahan hanya sumber diagram, panduan dan hasil render. Dependency aplikasi tidak diubah; alat render sementara ditempatkan dalam `.tmp/diagram-tools`, dengan cache di workspace. Pemeriksaan parser/render ini menguji diagram, bukan membuktikan implementasi AI, blockchain atau IoT telah selesai.
