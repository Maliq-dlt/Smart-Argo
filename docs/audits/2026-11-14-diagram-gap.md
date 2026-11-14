| RW-04 | Klaim mencurigakan dan keberatan | 2 | Kasus anomali otomatis (≥90% batas meter ditahan), keberatan pemilik, antrean operator, keputusan beralasan, kredit idempoten (tahap 6) | — || ID-05 | Cabut identitas produk | 2 | `operator_revoke_product/device`, audit, status publik (tahap 5) + UI Registri operator | — || ID-04 | Daftarkan produk dan kunci | 2 | `operator_provision_product` lewat edge function `product-provision` (manifest bertanda tangan), rotasi kunci (Codex tahap 5), UI Registri operator | — || ID-03 | Pindahkan/pulihkan kepemilikan | 2 | Kode transfer, step-up, security hold; kasus pemulihan dengan bukti, keputusan operator, pemindahan atomik + outbox (tahap 7) | — || ID-01 | Periksa identitas/keaslian | 2 | Scan QR, `product_public_status` dengan manifest; tanda tangan Ed25519 diverifikasi di edge function dan di browser terhadap kunci penerbit yang dipin (tahap 10) | Kunci penerbit produksi belum dibuat. || APP-06 | Bandingkan dan ekspor riwayat | 2 | Perbandingan, CSV, dan riwayat berhalaman (`read_my_measurement_history`) dengan UI | — || APP-03 | Pantau tanaman dan energi | 2 | `my_unit_overview`: bacaan terbaru per sensor, usang, galat, perangkat dicabut, defisit energi, baterai (tahap 9) + panel "Kondisi unit" | — || APP-02 | Kelola pot/zona kebun | 2 | `create_my_unit`, ubah nama, arsip/pulihkan, penempatan perangkat dengan riwayat; ingest menolak unit yang tidak cocok/diarsipkan (tahap 8) | — || APP-01 | Masuk dan pulihkan akun | 2 | Email/sandi, Google PKCE, TOTP, step-up, log keamanan; reset sandi (GoTrue recover + PKCE) dan kode pemulihan 2FA sekali pakai (tahap 11) | Reset sandi di cloud butuh SMTP sendiri. |# Gap diagram Miro terhadap implementasi (Claude Code)

Tanggal: 14 November 2026, Asia/Jakarta. Sumber target: salinan lokal board Miro di `docs/diagram/miro-atlas-2026-10-22/`: use case U02–U05, ERD E02–E04, activity A04–A08 dan A10. Rubrik 20 use case (skor 0–2) mengikuti [audit backend Codex](2026-11-13-backend-readiness.md), lalu diperiksa ulang terhadap kode setelah tahap 1–5 Codex dan UI jurnal 14 November.

Skor: 0 = belum ada, 1 = parsial, 2 = alur inti diagram tersedia dan teruji lokal. Skor ini bukan ukuran kesiapan produksi, perangkat keras, atau validitas agronomi.

## Status per use case

| ID | Diagram | Skor | Bukti sekarang | Gap terhadap diagram |
| --- | --- | ---: | --- | --- |
| APP-01 | Masuk dan pulihkan akun | 1 | Email/sandi, Google PKCE, TOTP, step-up, log keamanan | Tidak ada reset sandi. Tidak ada pemulihan bila authenticator hilang. |
| APP-02 | Kelola pot/zona kebun | 1 | `create_my_unit`, pilih profil | Unit tidak bisa diubah nama atau diarsipkan. Penempatan perangkat ke unit tidak dicatat di server; perangkat memilih unit sendiri di paket, jadi tidak ada riwayat lokasi. `my_device_units` memasangkan semua perangkat dengan semua unit produk. |
| APP-03 | Pantau tanaman dan energi | 1 | Ingest bertanda tangan, riwayat, energi | Tidak ada ringkasan status per unit (bacaan terbaru per sensor, usang, galat, perangkat dicabut, defisit energi). |
| APP-04 | Catat tindakan perawatan | 2 | RPC jurnal (Codex tahap 3) + `ProductCareHistory` | — |
| APP-05 | Maskot dan penjelasan AI | 2 | Snapshot aturan, state maskot, AI opsional dengan validasi dan admission | Pengalaman maskot interaktif adalah pekerjaan UI. |
| APP-06 | Bandingkan dan ekspor riwayat | 2 | Perbandingan dan CSV (Codex) + UI | Riwayat berhalaman belum punya UI (CSV mencakupnya). |
| ID-01 | Periksa identitas/keaslian | 1 | Scan QR, `product_public_status` | A04 meminta manifest bertanda tangan penerbit. `issuer_signature` disimpan tetapi tidak pernah diverifikasi; tidak ada kunci penerbit. |
| ID-02 | Aktivasi satu kali | 2 | Nonce, sealed code, Ed25519, transaksi atomik, gate MFA (tahap 1) | — |
| ID-03 | Pindahkan/pulihkan kepemilikan | 1 | Kode transfer, step-up, security hold | A04 "konflik → pemulihan lewat proses dukungan" dan aktor Operator pada ID-03 belum ada: tidak ada kasus pemulihan dengan bukti dan keputusan operator. |
| ID-04 | Daftarkan produk dan kunci | 1 | Tabel registry, rotasi kunci (tahap 5) | Tidak ada RPC provisioning produk oleh operator; produk hanya bisa dibuat lewat SQL. Tidak ada manifest penerbit. |
| ID-05 | Cabut identitas produk | 2 | `operator_revoke_product/device`, audit, status publik (tahap 5) | UI operator belum ada. |
| RW-01 | Saldo, riwayat, aturan | 2 | `reward_workspace`, ledger, versi kebijakan | — |
| RW-02 | Klaim energi terverifikasi | 2 | Meter bertanda tangan, kredit unik atomik | Validasi fisik meter di luar perangkat lunak. |
| RW-03 | Tukar saldo | 2 | Reservasi saldo dan stok atomik, batal | — |
| RW-04 | Klaim mencurigakan dan keberatan | 1 | Kompensasi operator | Tidak ada antrean kasus, pengajuan keberatan pemilik, penanggung jawab, atau jejak keputusan. |
| RW-05 | Katalog, stok, pemenuhan | 2 | Katalog, stok, fulfillment idempoten | — |
| KB-01..04 | Profil, kontribusi, revisi, kurasi | 2 | Tahap kurasi + gate TOTP kurator | — |

Total awal tercatat 31/40, padahal tabel awalnya berjumlah 33/40 (13 × 2 + 7 × 1); salah hitung itu dikoreksi di sini. Setelah tahap 6–12 dan UI-nya (14 November sore), semua use case bernilai 2: **40/40** menurut rubrik ini. Batas yang tetap berlaku: validasi fisik meter (RW-02), maskot interaktif (APP-05, pekerjaan dashboard), kunci penerbit produksi, SMTP cloud, dan rilis backend ke cloud.

## Activity di luar rubrik

- **A08 bukti blockchain:** selesai di tahap 12. `scripts/chain-worker.mjs` menyewa job, mengirim lewat JSON-RPC, lalu mencocokkan receipt (chain, penanda tangan, tujuan, hash) menjadi `confirmed` atau `mismatch`. Kontrak dan jaringan produksi belum dipilih.
- **A10 kebijakan daya:** urusan firmware (mode hemat, buffer, penghentian aman). Di luar repo ini; hanya data energi yang masuk ke backend.

## Rencana tahap 6–12 (Claude Code)

Konvensi Codex dipakai: hasil `{ok, code, message}`, `request_id` idempoten dengan advisory lock, `privileged_write_gate('operator')` untuk aksi operator, tabel audit append-only, RLS tanpa akses tabel langsung.

| Tahap | Use case | Isi |
| --- | --- | --- |
| 6 | RW-04 | `reward_case` + jejak: pemilik mengajukan keberatan atas hasil energi/penukaran; kasus anomali otomatis; operator mengambil, memutus dengan alasan, kompensasi ledger idempoten. |
| 7 | ID-03 | `ownership_recovery_case`: klaim pemulihan dengan pernyataan dan bukti; operator memutus; persetujuan memindahkan kepemilikan secara atomik dengan outbox dan log keamanan. |
| 8 | APP-02 | Ubah nama dan arsip unit, penempatan perangkat ke unit dengan riwayat, ingest menolak paket yang tidak cocok dengan penempatan aktif. |
| 9 | APP-03 | `my_unit_overview`: bacaan terbaru per sensor, usang, galat, status perangkat, energi 24 jam, daftar peringatan. |
| 10 | ID-01/ID-04 | Kunci penerbit, manifest kanonis bertanda tangan Ed25519, `operator_provision_product`, verifikasi di browser terhadap kunci yang dipin di build. |
| 11 | APP-01 | Reset sandi (Auth recover + PKCE) dan kode pemulihan 2FA (hash, sekali pakai, penahanan keamanan). |
| 12 | A08 | Worker outbox: klaim berlease, kirim, receipt, cocokkan penerbit/tujuan/hash, status `confirmed`/`mismatch`/`failed`. |
| UI | semua | Panel pemilik (keberatan, pemulihan, unit, status, kode pemulihan, bukti) dan ruang kerja operator (provisioning, rotasi/pencabutan Codex, antrean kasus, outbox). |

## Analisis bug (14 November sore, Claude Code)

Pengguna memutuskan Claude Code memegang backend dan debugging; bila bertentangan dengan pekerjaan Codex, perubahan Claude yang berlaku dan Codex menyesuaikan.

**Mayor, sudah diperbaiki**

| Bug | Akibat | Perbaikan |
| --- | --- | --- |
| UI jurnal mengirim `p_notes:null` | Semua catatan tanpa teks ditolak `invalid_request` | `ProductCareHistory` mengirim `''` |
| Parser jurnal menolak notes `''` | Daftar jurnal gagal dimuat begitu ada catatan tanpa teks | Parser menerima `''` sebagai "tanpa catatan" |
| Parser energi menolak `held_for_review` | Panel energi rusak begitu ada klaim yang ditahan | Status baru diterima dan diberi label |
| `knowledge_workspace` memotong profil ke 100 pertama menurut nama | Setelah katalog >100 profil, kurator melihat UUID alih-alih nama tanaman pada pengajuan | Migrasi `20261114170000`: profil yang dirujuk pengajuan selalu ikut (`tests/knowledge-workspace.integration.mjs`) |
| Tes browser energi, kurasi, dan reward tidak mengikuti tahap 4 Codex | Alur operator/kurator tidak teruji sama sekali (peran istimewa hanya aktif di sesi 2FA) | Akun uji mengaktifkan TOTP; `signIn(..., { secret })` mengisi kode |

**Minor, sudah diperbaiki**

- `request()` mengeluarkan pengguna untuk `{ok:false}` tanpa `code`. Kini hanya `unauthorized`/`invalid_session` (atau HTTP 401) yang menghapus sesi. Tidak ada RPC yang masih mengirim `ok:false` tanpa `code`.
- Operator/kurator tanpa 2FA kehilangan alatnya tanpa penjelasan. Kini Ekosistem dan Profil → Operator memberi tahu bahwa 2FA diperlukan.
- "Kondisi unit" dan panel telemetri tidak saling memperbarui (unit baru tidak muncul, nama/arsip basi). Kini keduanya memuat ulang lewat satu penghitung versi.
- Belum ada CSP. `public/_headers` kini memuat CSP, `Permissions-Policy`, dan `X-Frame-Options`; `tests/csp-browser.mjs` menyajikan `dist/` dengan header itu dan menjelajah landing, daftar, semua tab, pemindai QR (WASM), profil, dan dashboard tanpa satu pelanggaran pun.
- Chunk simulator 625 kB: halaman Ekosistem dan Profil kini dimuat saat pertama dibuka (chunk `App` 430 kB). Satu-satunya chunk >500 kB tersisa adalah model 3D Three.js yang sudah lazy.
- `code in GATE_TEXT` cocok dengan `toString`; label log keamanan untuk jenis event baru tampil mentah.

**Diperiksa, bukan bug:** semua tabel publik ber-RLS; tidak ada fungsi `SECURITY DEFINER` tanpa `search_path`; semua fungsi dicabut dari `PUBLIC`; kebijakan `measurement` membatasi ke bacaan sejak kepemilikan dimulai; kode TOTP yang sama boleh dipakai ulang dalam jendela 30 detik (perilaku GoTrue, bukan celah aplikasi); `APP_ORIGIN` cloud sudah pages.dev.

**Masih terbuka (butuh izin atau di luar perangkat lunak):** migrasi `20261114*` dan function `history-export`, `product-provision`, `mfa-recovery` belum dirilis ke cloud; `ISSUER_PUBLIC_KEYS`/`VITE_ISSUER_PUBLIC_KEYS` belum diisi; SMTP cloud untuk reset sandi; kontrak dan jaringan chain produksi.
