# Smart Agro — rancangan produk, revisi 2

Revisi 26 September 2026. Memasukkan klarifikasi pemilik proyek: dua varian produk, energi panel surya–baterai, identitas produk berbasis QR, blockchain, hadiah berkebun, AI dan maskot 2D, serta kontribusi pengetahuan terbuka.

**Keputusan terkonfirmasi:** “mining” berarti hadiah token/poin dari aktivitas dan energi terverifikasi, tanpa mining komputasi berat. Pilihan komponen, ambang daya, nilai hadiah dan jadwal perluasan demo belum ditetapkan. Rincian kontrol teknis dalam paket ini merupakan rancangan yang disarankan, bukan fitur yang sudah selesai dibangun.

## Mulai dari sini

1. Lihat `00-alur-produk.mmd` untuk perjalanan produk secara utuh.
2. Gunakan empat `use-case-*.puml` untuk aktor stickman dan tujuan tiap peran.
3. Gunakan flowchart modul untuk urutan, keputusan, serta kegagalannya.
4. Gunakan tiga model data untuk entitas dan hubungan; baca batas integritas dalam [SPESIFIKASI.md](SPESIFIKASI.md) sebelum membuat schema DB.
5. Lihat `14-simulator-saat-ini.mmd` untuk kemampuan yang benar-benar tersedia sekarang.

## Indeks kode

| Nomor | Diagram | Sumber |
| --- | --- | --- |
| 00 | Perjalanan produk: beli, rawat, hadiah, penukaran | [Mermaid](00-alur-produk.mmd) |
| 01 | Pemilik, pemantauan dan maskot AI | [PlantUML](01-use-case-pemilik.puml) |
| 02 | Keaslian, aktivasi dan kepemilikan produk | [PlantUML](02-use-case-produk.puml) |
| 03 | Hadiah dan penukaran produk | [PlantUML](03-use-case-reward.puml) |
| 04 | Kontribusi ahli dan kurasi pengetahuan | [PlantUML](04-use-case-komunitas.puml) |
| 05 | Aktivasi QR dan pengikatan pemilik | [Mermaid](05-aktivasi-qr.mmd) |
| 06 | Data, keputusan, AI dan emosi maskot | [Mermaid](06-data-ai-maskot.mmd) |
| 07 | Jalur energi panel, baterai dan beban | [Mermaid](07-energi-surya-baterai.mmd) |
| 08 | Perolehan hadiah dan penukaran | [Mermaid](08-reward-dan-penukaran.mmd) |
| 09 | Kontribusi sampai publikasi profil tanaman | [Mermaid](09-kontribusi-pengetahuan.mmd) |
| 10 | Arsitektur aplikasi dan backend | [Mermaid](10-arsitektur.mmd) |
| 11 | Data akun, perangkat, pot/zona dan pengukuran | [Mermaid ERD](11-data-operasional.mmd) |
| 12 | Data energi, hadiah, ledger dan stok | [Mermaid ERD](12-data-reward.mmd) |
| 13 | Data kontribusi, tinjauan dan versi profil | [Mermaid ERD](13-data-pengetahuan.mmd) |
| 14 | Simulator yang sudah berjalan | [Mermaid](14-simulator-saat-ini.mmd) |
| 15 | Pencatatan dan pemeriksaan bukti blockchain | [Mermaid](15-bukti-blockchain.mmd) |

Folder `svg/` berisi hasil render vektor; `png/` berisi gambar untuk unggah cepat. Diagram dipisah agar tidak ada satu board dengan puluhan garis saling melintas. Hubungan use case tidak diberi panah urutan: urutan berada di flowchart. Tidak ada `include` atau `extend` yang dipaksakan untuk menyatakan urutan menu.

## Impor ke alat lain

### Mermaid

Buka [Mermaid Live](https://mermaid.live/), lalu tempel seluruh isi satu `.mmd`. Mermaid menyediakan flowchart dan ERD dalam paket ini. **Mermaid tidak memiliki tipe use case UML native dengan stickman**; gunakan PlantUML atau gambar hasil render untuk use case.

### PlantUML

Tempel `.puml` utuh, termasuk `@startuml` dan `@enduml`, pada editor PlantUML. Empat diagram memakai aktor stickman, oval use case, batas sistem, dan asosiasi tanpa panah. Layout orthogonal sudah diuji dengan PlantUML 1.2025.4. Tata letak dapat sedikit berbeda pada versi engine lain.

### Miro

Unggah PNG atau SVG sebagai gambar ke board; PNG tersedia jika SVG tidak didukung pada workspace. Jika aplikasi Mermaid/PlantUML tersedia, tempel sumbernya di sana. Simpan sumber sebagai lampiran untuk revisi berikutnya. Unggah gambar tidak otomatis mengubahnya menjadi shape Miro yang dapat diedit. Impor langsung pada akun Miro pengguna belum diuji.

### diagrams.net

Gunakan penyisipan Mermaid jika versi editor mendukungnya, atau impor SVG/PNG. Sumber PlantUML juga dapat dipakai pada editor yang mendukung PlantUML. Tidak perlu menyalin seluruh paket ke satu diagram.

## Status implementasi

| Bagian | Status |
| --- | --- |
| Simulator, aturan agronomi lokal, regresi linear lokal, sesi, grafik dan JSON | Sudah ada pada aplikasi |
| Pratinjau telemetri JSON | Sudah ada; terpisah dari mesin keputusan simulator |
| Akun, aktivasi QR dan identitas perangkat fisik | Rancangan baru |
| AI backend dan maskot 2D interaktif | Rancangan; penjelasan aturan lokal saat ini bukan layanan AI tersebut |
| Blockchain identitas dan audit | Rancangan; belum terhubung pada aplikasi |
| Energi surya, baterai, pengukuran energi dan IoT nyata | Rancangan; perangkat belum tersedia |
| Reward, penukaran, multi-zona dan kontribusi komunitas | Rancangan baru |

Dokumen makalah lama belum diubah. Pembaruan ini berada pada paket diagram dan spesifikasi pendamping. Penambahan model data bukan migrasi DB atau implementasi fitur.

## Verifikasi

Empat sumber PlantUML dirender dengan engine lokal; dua belas Mermaid lolos parser dan renderer Mermaid 11.12.2. Hasil diperiksa secara visual. Pemeriksaan tambahan mencakup ID use case, hubungan aktor, kode status, konsistensi berkas, XML SVG, dan kemasan ZIP. Catatan perintah dan hasil ada dalam [VERIFIKASI.md](VERIFIKASI.md).

## Referensi

- Implementasi: `src/App.tsx`, `src/lib/agronomyEngine.ts`, `src/lib/sessionStore.ts`, `src/lib/telemetry.ts`, `docs/telemetry-v1.md`; makalah awal dan klarifikasi pemilik proyek.
- [PlantUML: use case](https://plantuml.com/use-case-diagram): aktor, oval, batas sistem dan relasi.
- [OWASP: Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): autentikasi, pembatasan percobaan dan perlindungan akun.
- [OWASP: Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): prinsip token acak, sekali pakai, penyimpanan aman dan masa berlaku; diadaptasi untuk challenge aktivasi, bukan standar sertifikasi QR produk.
- [OWASP: Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html): minimisasi data, enkripsi dan pengelolaan kunci.
- [PostgreSQL: Unique Indexes](https://www.postgresql.org/docs/current/indexes-unique.html): dasar batas unik untuk kepemilikan dan idempotensi.
- [Texas Instruments BQ24650](https://www.ti.com/product/BQ24650): contoh kelas pengendali pengisian baterai dengan input surya dan MPPT; bukan keputusan memilih komponen ini untuk Smart Agro.

Referensi web di atas dibaca pada 26 September 2026. Tidak ada klaim bahwa blockchain menjamin perangkat mustahil dikloning, data sensor benar, atau program hadiah pasti mengurangi emisi.
