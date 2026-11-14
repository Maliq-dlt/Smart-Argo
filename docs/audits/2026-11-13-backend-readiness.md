# Audit backend dan kelengkapan Smart Agro terhadap diagram

Tanggal audit: 13 November 2026, mengikuti tanggal konteks pengguna (Asia/Jakarta). Basis kode: `main`, HEAD `35ca07a`, ditambah working tree yang ada saat audit. Perubahan landing/dependency milik pengguna dipertahankan. Audit ini menambahkan laporan, tanpa memperbaiki atau mengubah source aplikasi.

## Kesimpulan

Backend sudah nyata dan memiliki fondasi integritas data yang baik. Klaim produk, telemetri bertanda tangan, kurasi profil, penjelasan berbasis bukti, energi, ledger, penukaran, transfer kepemilikan dan MFA sudah mempunyai implementasi. Ini melampaui simulator browser yang digambarkan pada dokumentasi Oktober.

**Estimasi cakupan fungsional produk terhadap 20 use case diagram: 67,5%, dibulatkan sekitar 68%.** Angka ini adalah skor cakupan alur software, bukan persentase jam kerja, jaminan keamanan, kesiapan perangkat fisik, atau kelayakan enterprise. Rekomendasi: selesaikan gap keamanan dan kebutuhan operasional untuk pilot terbatas sebelum memperbesar scope.

Dua use case yang belum ditemukan untuk data akun/cloud adalah jurnal tindakan perawatan dan perbandingan/ekspor riwayat. Fitur serupa pada simulator lokal sudah ada; keduanya tidak otomatis menyimpan data ke backend akun.

## Dasar penilaian dan batas bukti

Acuan utama: [atlas Miro 22 Oktober](../diagram/miro-atlas-2026-10-22/README.md), khususnya U02–U05, serta [spesifikasi v2](../diagram/v2/SPESIFIKASI.md) bagian 2. Atlas berisi 25 diagram dan merupakan snapshot historis. Label `RANCANGAN` di sana bukan bukti fitur masih belum diimplementasikan sekarang. Audit membaca salinan diagram di repository; isi board Miro live tidak diverifikasi ulang.

Setiap use case diberi bobot sama, dengan skor berikut:

- **2 — tersedia:** alur fungsional inti yang disebut diagram mempunyai implementasi persisten dan bukti pengujian lokal yang relevan.
- **1 — parsial:** bagian penting tersedia, tetapi tujuan use case masih mempunyai gap nyata.
- **0 — belum:** belum ditemukan implementasi backend akun untuk tujuan tersebut.

Skor 2 berarti alur inti tersedia; bukan pernyataan bebas bug atau siap produksi. Keamanan dan kesiapan operasi dinilai terpisah. Pembobotan sama dipilih agar perhitungan dapat ditelusuri, bukan karena usaha/risiko setiap use case sama. Rubrik ini merupakan estimasi audit, belum acceptance criteria yang disepakati pemilik proyek.

Hasil: **9 × 2 + 9 × 1 + 2 × 0 = 27 dari 40 = 67,5%.**

## Matriks 20 use case produk

Nomor baris berikut mengacu pada source yang dibaca saat audit. Status berlaku untuk alur software lokal, bukan untuk hardware maupun semua integrasi live.

| ID | Target diagram | Skor | Implementasi dan bukti | Gap terhadap target |
| --- | --- | ---: | --- | --- |
| APP-01 | Masuk dan pulihkan akun | 1 | Email/password, Google PKCE, session refresh/logout, TOTP dan riwayat keamanan; `src/lib/productAccountClient.ts:100,116,169`, `src/components/ProductSecurity.tsx:26` | Password reset, pemulihan akun dan pemulihan ketika authenticator hilang belum ditemukan sebagai alur pengguna |
| APP-02 | Kelola pot/zona kebun | 1 | Pembuatan unit milik produk dan pemilihan profil; batas kit satu pot ditegakkan; `supabase/migrations/20261105020000_device_telemetry.sql:165`, `src/components/ProductTelemetry.tsx:82` | Lifecycle edit/arsip unit dan pemindahan sensor dengan riwayat lokasi belum lengkap |
| APP-03 | Pantau tanaman dan energi | 1 | Ingest persisten, kualitas sensor, timestamp, staleness dan riwayat; `20261105020000_device_telemetry.sql:52,146`, `src/components/ProductTelemetry.tsx:68`, `src/components/ProductEnergy.tsx` | Dashboard tren perangkat operasional, pemantauan berkelanjutan dan notifikasi belum lengkap; perangkat nyata belum diuji |
| APP-04 | Catat tindakan perawatan | 0 | Siram/pupuk dan undo ada di simulator, `src/lib/simulation.ts:105,134` | Belum ditemukan tabel/RPC jurnal tindakan perawatan untuk akun/unit cloud; daftar RPC di `src/lib/productAccountClient.ts:209` tidak menyediakan alur ini |
| APP-05 | Maskot dan penjelasan AI | 1 | Keputusan aturan, state maskot, snapshot bukti dan connector AI opsional; `src/lib/deviceExplanation.ts:13`, `src/lib/aiExplanation.ts:61,91`, `src/components/ProductExplanation.tsx:16` | Respons online berupa state/penjelasan snapshot; pengalaman maskot interaktif lebih lengkap dan keberhasilan provider AI nyata belum dibuktikan audit ini |
| APP-06 | Bandingkan dan ekspor riwayat | 0 | Ekspor/impor dan perbandingan sesi simulator tersedia; `src/lib/sessionStore.ts:122,128` | Belum ditemukan ekspor/perbandingan histori milik akun cloud; histori perangkat bukan sesi simulator |
| ID-01 | Periksa identitas/keaslian produk | 1 | Scan QR dan public registry status tanpa membocorkan pemilik; `src/lib/productAccountClient.ts:236`, `supabase/migrations/20261113010000_ownership_transfer.sql:5` | Tanda tangan penerbit disimpan tetapi belum diverifikasi; status serial terdaftar tidak membuktikan barang fisik asli |
| ID-02 | Aktivasi satu kali | 2 | Nonce terikat sesi, sealed-code hash, Ed25519 dan transaksi ownership/outbox atomik; `20261105010000_account_activation.sql:68,118,166` | Alur utama diuji lokal dengan software test keys; ada ketidakkonsistenan gate MFA yang dijelaskan pada temuan keamanan |
| ID-03 | Transfer/pulihkan kepemilikan | 1 | Kode transfer sekali pakai, autentikasi ulang, race protection dan security hold; `20261113010000_ownership_transfer.sql:68`, `20261113020000_transfer_security_hold.sql:4` | Pemulihan kehilangan akses melalui support dan adjudikasi bukti belum tersedia |
| ID-04 | Registrasi produk/kunci resmi | 1 | Tabel registry/perangkat/kunci dan constraint identitas ada; `20261105000000_smart_agro_miro_target.sql:22,60` | Provisioning produk masih memerlukan operasi terpercaya; workflow operator, verifikasi manifest penerbit dan lifecycle kunci belum lengkap |
| ID-05 | Cabut produk bermasalah | 1 | Status revoked dan penolakan ingest/claim saat identitas dicabut ada; `20261105000000_smart_agro_miro_target.sql:26,64`, `20261105010000_account_activation.sql:138` | Workflow pencabutan produk/kunci dengan hak operator, alasan, audit dan publikasi status belum lengkap; revokasi meter mempunyai RPC tersendiri |
| RW-01 | Saldo, riwayat, aturan hadiah | 2 | Workspace saldo confirmed/reserved/available, ledger dan versi kebijakan; `src/components/ProductRewards.tsx:28`, `20261106010000_reward_marketplace.sql:245` | Riwayat panjang masih dibatasi; bukan uang/token finansial |
| RW-02 | Klaim energi terverifikasi | 2 | Signature meter, periode kanonik, policy, cap dan kredit unik atomik; `20261106000000_energy_evidence.sql:38,81`, `20261106010000_reward_marketplace.sql:61` | Implementasi sumber hadiah adalah energi; validasi fisik dan kalibrasi meter belum dibuktikan. Aktivitas manual tidak memperoleh kredit otomatis |
| RW-03 | Tukar saldo dengan produk | 2 | Reservasi saldo/stok, cancel dan status penukaran; `20261106010000_reward_marketplace.sql:161,186`, `20261113005000_account_security.sql:88` | Ini pencatatan program; bukan bukti barang benar-benar dikirim |
| RW-04 | Anomali dan keberatan | 1 | Operator dapat melakukan kompensasi dengan alasan tanpa menghapus ledger; `20261106010000_reward_marketplace.sql:224` | Case queue, pengajuan keberatan, pemeriksaan bukti, penanggung jawab dan jejak penyelesaian kasus belum lengkap |
| RW-05 | Katalog, stok, fulfillment | 2 | Operator mengatur katalog/stok dan mencatat fulfillment idempoten; `20261106010000_reward_marketplace.sql:140,203`, `src/components/ProductRewards.tsx` | Pengiriman eksternal belum terintegrasi, tetapi tidak diperlukan untuk menyatakan pencatatan inti diagram tersedia |
| KB-01 | Baca profil dan sumber | 2 | Profil terbit, scope, provenance dan versi; `20261105030000_profile_curation.sql:182` | Validitas agronomi isi profil memerlukan bukti lapangan tersendiri |
| KB-02 | Ajukan bukti/lisensi kontribusi | 2 | Pengajuan dengan sharing permission, provenance dan parameter tervalidasi; `20261105030000_profile_curation.sql:77` | Persetujuan berbagi bukan pemeriksaan legal otomatis atas sumber |
| KB-03 | Revisi kontribusi | 2 | Revisi penulis mempertahankan versi historis; `20261105030000_profile_curation.sql:105` | Tidak ditemukan gap inti alur yang diuji lokal |
| KB-04 | Review dan publikasi profil | 2 | Kurator terotorisasi; self-approval ditolak, publikasi immutable dan atomik; `20261105030000_profile_curation.sql:125` | Pengujian software tidak menggantikan kompetensi kurator atau evaluasi agronomi |

Ringkasan per domain: aplikasi pemilik **4/12 (33%)**; identitas produk **6/10 (60%)**; reward **9/10 (90%)**; pengetahuan/kurasi **8/8 (100% cakupan alur inti lokal)**. Ini menunjukkan gap terkonsentrasi pada pengalaman operasional pengguna, bukan kekurangan tabel ledger atau engine kurasi. Nilai domain sensitif terhadap pengelompokan use case; jangan memakainya sebagai estimasi biaya.

U01/simulator tidak masuk denominator 20 tujuan produk online. Engine deterministik, sesi, impor/ekspor, siram/undo, catatan pupuk, grafik dan laporan simulator sudah tersedia dan mempunyai unit tests. Menambah simulator sebagai satu baris akan menaikkan skor secara artifisial, sedangkan kebutuhan produk akun tetap belum selesai.

## Backend yang benar-benar tersedia

- Database lokal saat audit mempunyai **28 tabel public dengan RLS aktif: 27 tabel domain dan satu tabel pencatatan migrasi**. Ada **11 migrasi aplikasi** yang tercatat diterapkan di stack lokal. Pemeriksaan metadata tidak membuktikan seluruh policy benar; suite integrasi memeriksa skenario akses dan transaksi penting.
- Arsitektur: browser → Supabase Auth/PostgREST/empat handler → PostgreSQL. Source handler yang sama dipakai oleh Edge Functions dan gateway Node lokal. Graph membantu memeriksa hubungan ini; temuan diberi bobot berdasarkan source dan tes, bukan jumlah edge graph.
- Telemetri/energi memakai Ed25519, timestamp/status kualitas, replay/sequence checks, idempotensi dan transaksi. Server mengulang pemeriksaan key/product di dalam transaksi.
- Ownership unik aktif, profil/snapshot tetap, ledger dan stock reservation atomik merupakan fondasi yang layak dipertahankan. Tidak perlu rewrite backend atau memindahkannya menjadi microservices untuk menutup gap saat ini.
- Reward di backend adalah **poin program internal**. Saldo demo dan saldo akun dipisahkan. Belum ada token ekonomi on-chain yang dapat diperdagangkan.

## Dua temuan keamanan yang perlu diperbaiki

### SEC-01 — P2: gate MFA tidak konsisten pada aktivasi produk

`current_auth_session()` sudah menolak sesi AAL1 jika pengguna mempunyai TOTP terverifikasi (`20261113005000_account_security.sql:36`). Namun `issue_activation_nonce` hanya memeriksa keberadaan sesi dan mengabaikan JSON penolakan dari `ensure_my_account()` (`20261105010000_account_activation.sql:76,84`). Untuk account yang sudah ada, penerbitan nonce tetap berlanjut. `claim_verified_product` juga hanya memeriksa sesi (`:135`), dan handler klaim tidak memeriksa assurance level (`supabase/functions/product-claim/handler.ts:41,46`).

**Reproduksi:** fixture SQL lokal dalam satu transaksi menunjukkan `current_auth_session() = false` untuk AAL1 + verified MFA, sementara issue nonce dan trusted final-claim RPC berhasil. Semua fixture reproduksi SQL di-rollback. Ini membuktikan ketidakkonsistenan gate DB; bukan eksploit end-to-end terhadap hosted Auth atau perangkat fisik.

**Syarat/dampak:** penyerang perlu sesi password-only yang sah untuk account yang sudah ada, sealed code dan tanda tangan perangkat yang valid. Efeknya klaim produk baru tanpa menyelesaikan MFA. Temuan ini tidak membuktikan akses baca/transfer produk lama. Penolakan signature tetap bekerja.

**Perbaikan minimum:** gunakan gate sesi/MFA yang sama ketika menerbitkan nonce; jangan abaikan hasil `ensure_my_account`. Validasi assurance JWT melalui jalur pengguna sebelum operasi service-role dan ulangi syarat otorisasi yang relevan saat commit, termasuk kasus MFA berubah setelah nonce dibuat. Tambahkan regression case AAL1 dengan verified MFA; UI-only gate tidak cukup.

### SEC-02 — P2: kuota/idempotensi AI diperiksa setelah inference

`supabase/functions/unit-explanation/handler.ts:42` memanggil explainer lebih dahulu, lalu `save_unit_explanation` pada baris 43. Duplicate request dan limit 20 snapshot/menit baru diperiksa pada `20261113000000_ai_explanations.sql:24,48`.

**Reproduksi:** handler asli dengan transport terisolasi yang mengembalikan hasil duplicate dipanggil 25 kali menggunakan request ID sama; explainer dipanggil **25 kali**. Reproduksi memakai stub terlabel untuk mengukur control flow, tanpa provider AI berbayar atau data cloud. Suite backend terpisah menguji penyimpanan duplicate/idempotensi dan keamanan snapshot.

**Syarat/dampak:** pemilik sah dapat menghabiskan biaya/kapasitas provider melalui retry/permintaan berlebih ketika AI diaktifkan. Limit snapshot tidak melindungi panggilan yang sudah terjadi. Ketika AI tidak dikonfigurasi, risiko biaya provider ini tidak berlaku.

**Perbaikan minimum:** reservasi request ID dan kuota secara atomik sebelum inference; retry mengembalikan hasil tersimpan/status pending. Batasi concurrency dan anggaran per akun/program. Tidak perlu memasang sistem antrean baru sebelum kebutuhan throughput terbukti.

Check reproduksi yang ditinggalkan: `.tmp/backend-audit-2026-11-13/security-check.mjs`, jalankan `node --experimental-strip-types .tmp/backend-audit-2026-11-13/security-check.mjs --db` dengan stack lokal. Check ini **lulus ketika kelemahan masih dapat direproduksi**, bukan bukti bahwa aplikasi sudah diperbaiki.

## Hal yang masih membatasi produk nyata

| Area | Bukti sekarang | Kebutuhan sebelum klaim lebih jauh |
| --- | --- | --- |
| Hardware/firmware | Kontrak ingest dan synthetic test keys tersedia; firmware ESP32, secure provisioning, buffering fisik dan uji kalibrasi tidak ditemukan dalam source audit | Uji satu kit nyata: kunci per perangkat, jam/reboot/offline/reconnect, sensor rusak, kalibrasi dan ground truth; periksa firmware terpisah bila dikelola di repository lain |
| Energi fisik | Jendela energi bertanda tangan dan policy reward tersedia | Ukur panel/baterai/beban nyata, proteksi charging/BMS dan eligible-load. Signature tidak membuktikan penghematan energi |
| Agronomi | Engine aturan dan source/profile versioning tersedia | Kalibrasi per media/jenis tanaman, profil dengan rujukan yang dapat ditelusuri, evaluasi hasil lapangan sebelum menjual janji rekomendasi |
| Blockchain | File proof simulator dengan wallet pengguna dan outbox commitment produk tersedia | Outbox produk belum mempunyai worker/kontrak/receipt pipeline. Proof file simulator tidak menyelesaikan pencatatan ownership/ledger on-chain; utamakan audit DB bila itu sudah memenuhi kebutuhan pelanggan |
| AI | Connector OpenAI-compatible dan validasi/fallback tersedia | Audit ini tidak menjalankan provider AI nyata. Pertahankan keputusan aturan, uji kualitas jawaban, batas biaya dan retensi pertanyaan |
| CI | Lint, typecheck, unit, build, Python dan container smoke sudah masuk workflow | `.github/workflows/checks.yml:23,36` belum memanggil `npm run test:backend`; tambahkan delapan suite domain yang sudah ada supaya perubahan backend tidak hanya dijaga smoke |
| Backup/restore | Volume DB dan migrasi persisten ada | Belum ditemukan restore drill/script terjadwal; paket backup/PITR hosting tidak diverifikasi. Tetapkan RPO/RTO dan buktikan restore sebelum menyimpan data pelanggan penting |
| Observability | Health Auth/PostgREST dan status kesalahan tersedia | Request ID, structured error log, uptime monitoring, alert ingest macet dan SLA; `scripts/backend-gateway.mjs:70` menutupi detail error dari pengguna tetapi belum menyediakan logging operasional yang memadai |
| Organisasi/tim | Ownership per account dan role global tersedia | Organisasi, undangan anggota, viewer/operator/admin per kebun belum ada. Ini perlu saat beberapa staf menangani kebun yang sama, bukan sekadar menambah role global |
| Histori/data pengguna | Histori sensor dibatasi 120, ledger/queue 100 | Filter waktu/cursor dan CSV; retensi, ekspor akun dan prosedur hapus/pseudonimisasi yang menjaga audit ledger |
| Operasional reward | Kebijakan, cap per akun, stok, fulfillment dan kompensasi tersedia | Anggaran program menyeluruh, antrean anomali/appeal, alasan keputusan dan penanggung jawab; pengiriman eksternal masih manual |

Tidak ditemukan dasar untuk menyebut sistem sudah siap enterprise. Cloud yang dapat diakses, RLS aktif dan tes lulus adalah bukti kemajuan; belum merupakan bukti load capacity, pemulihan bencana, sensor akurat atau isolasi organisasi yang lengkap.

## Prioritas upgrade yang relevan bagi pengguna

1. **Sebelum pilot:** perbaiki SEC-01/02; password reset dan pemulihan MFA; wajibkan MFA untuk operator/kurator yang punya hak sensitif; masukkan suite backend ke CI; uji restore. Hasilnya akses dapat dipulihkan dan perubahan tidak diam-diam merusak data/transaksi.
2. **Nilai penggunaan harian:** dashboard perangkat nyata dengan waktu terakhir online, tren dan alert stale/offline yang mempunyai cooldown serta acknowledge; jurnal tindakan akun; ekspor CSV rentang waktu. Ini membantu pengguna bertindak dan menelusuri hasil perawatan.
3. **Produk IoT yang dapat dioperasikan:** provisioning dan revokasi lewat workflow operator, audit aktivitas, status kalibrasi, penggantian sensor dan rotasi kunci. Mulai dari pilot satu kit nyata sebelum memperluas klaim agronomi/energi.
4. **Saat pelanggan berupa tim:** organisasi dan undangan dengan hak per kebun, penanggung jawab peringatan/maintenance, audit akses dan prosedur support. Jika data pelanggan perlu dipisahkan lebih jauh, desain RLS dan pengujian lintas organisasi sejak menambahkan model ini.
5. **Saat program reward mulai bernilai:** anggaran global, antrian pemeriksaan bukti/keberatan, alasan kompensasi dan bukti fulfillment. Jangan menambah token finansial untuk menutupi alur operasional yang belum selesai.

Pertahankan Supabase/PostgreSQL dan engine deterministik yang sudah ada. SSO/SAML, SLA formal, webhooks/API pelanggan, partitioning dan integrasi logistik masuk setelah kebutuhan pelanggan/volume terukur. Tidak ada alasan yang dibuktikan audit ini untuk Kubernetes, microservices, atau chatbot otonom yang dapat mengubah ledger/perangkat.

## Verifikasi yang benar-benar dijalankan

Log berada di `.tmp/backend-audit-2026-11-13/`.

| Command/check | Hasil audit ini | Batas |
| --- | --- | --- |
| `npm test` | **96/96 lulus**, tanpa skip | Unit/pure behavior dan fixtures, bukan perangkat fisik |
| `npm run test:backend` | **69/69 lulus**, tanpa skip | Real local Auth/PostgreSQL/PostgREST, 8 file integration suite; jumlah mencakup parent tests. AI provider memakai stub terlabel |
| `npm run lint` | Lulus | Tidak membuktikan keamanan/ketepatan bisnis |
| `npm run typecheck` | Lulus | TypeScript compile checks |
| `npm run build` | Lulus | Build memberi warning chunk >500 kB dan dua path font yang diselesaikan saat runtime; tidak dinyatakan warning-free |
| `python scripts/reference/simulasi_pot.py --self-test` | Lulus, 10 skenario | Paritas/aturan model, bukan validasi lapangan |
| `python docs/diagram/miro-atlas-2026-10-22/check_atlas.py` | Lulus: 25 diagram native, 26 frame | Struktur snapshot lokal, bukan pemeriksaan board live/kelengkapan fitur |
| Metadata DB lokal | 28/28 tabel public dengan RLS; 11 migrasi tercatat | Bukan inspeksi skema/konfigurasi cloud |
| `node .tmp/backend-audit-2026-11-13/public-check.mjs` | **12/12 public smoke checks lulus** | Website HTTP 200, Auth settings/Google enabled, 4 CORS allow/deny, 2 penolakan anonymous; tidak mendaftar/mengirim email, login Google nyata, atau menjalankan transaksi cloud |
| `node --experimental-strip-types .tmp/backend-audit-2026-11-13/security-check.mjs --db` | Kedua kelemahan direproduksi | Isolated handler transport dan SQL rollback; bukan pentest cloud |
| `npm audit --json` | Exit 1: **7 moderate**, 0 high/critical | Seluruh paket terdampak ditemukan `dev: true` dalam lockfile; ini dependency lint toolchain, bukan temuan runtime dependency. Jangan menjalankan `audit fix --force` secara buta |
| `git diff --check` | Lulus | Git memberi peringatan normalisasi LF/CRLF pada package files pengguna |

Public smoke sengaja tidak menuntut hash asset live sama dengan build lokal: working tree pengguna mempunyai perubahan landing yang belum dipublikasikan. Browser E2E visual, load test, pengiriman email, login Google interaktif, provider AI berbayar dan transaksi testnet tidak dijalankan pada audit ini. Tidak ada perubahan data bisnis cloud. Tes backend membuat fixture lokal; reproduksi SQL tambahan seluruhnya rollback. Layanan lokal yang telah aktif tidak dihentikan.

## Dokumentasi yang perlu diselaraskan

- Atlas 22 Oktober menyatakan akun/AI/reward/komunitas masih rancangan; source dan tes November membuktikan sejumlah alur sudah tersedia. Perbarui label/status berdasarkan matriks, lalu ERD untuk nonce, packet, meter/policy, revision, security event dan transfer.
- `docs/IMPLEMENTATION_PHASES.md` mempunyai catatan historis sebelum connector AI/MFA/transfer. Baca tanggal/section; pernyataan lama bahwa provider belum tersedia bukan deskripsi kemampuan source terbaru.
- `docs/energy-rewards.md` masih menyebut tujuh migrasi; repository sekarang mempunyai sebelas. `SECURITY.md` menyebut belum ada backend produksi, sedangkan public smoke audit ini berhasil menjangkau backend hosted. Status deployment jangan ditentukan hanya dari dokumen lama.
- Jangan menyamakan komunitas pada U05 dengan forum sosial: scope yang diminta adalah kontribusi/revisi/review/publikasi profil, dan alur tersebut sudah dibangun.

Rujukan platform yang dipakai untuk menilai gate MFA dan fungsi berprivilege: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa) dan [database functions](https://supabase.com/docs/guides/database/functions), diambil melalui Context7. Keduanya menegaskan assurance enforcement di backend dan pemeriksaan otorisasi/privilege terpisah pada SECURITY DEFINER; RLS saja tidak cukup untuk fungsi yang memintasnya.
