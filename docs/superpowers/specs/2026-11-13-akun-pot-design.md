# Rancangan: pintu masuk, pot milik akun, dan profil

Tanggal: 2026-11-13. Status: menunggu persetujuan pengguna.

## Maksud

Smart Agro harus terasa seperti aplikasi sungguhan:

- orang masuk lewat satu pintu;
- menyiapkan pot sekali dengan data yang benar-benar dipakai mesin aturan;
- berpindah antar pot di dashboard;
- menemukan profil dan tombol keluar tanpa mencari.

Isi Ekosistem (saldo, produk, peran, cek QR) harus terlihat tanpa scroll panjang. Demo publik tetap bisa dicoba tanpa akun.

Keluhan yang memicu (pengguna, 2026-11-13):

- panel akun di Ekosistem sangat panjang sehingga ringkasan akun ada jauh di bawah;
- login terasa aneh karena berada di dalam Ekosistem;
- belum ada profil dan tempat keluar yang jelas;
- dashboard hanya untuk satu pot.

## Keputusan pengguna

- **Mode A.** Pintu masuk menawarkan "Lanjut dengan Google", email, dan "Coba tanpa akun".
- **Mode B nanti.** Login wajib menyusul setelah backend di-hosting. Mode B cukup berupa penghapusan opsi tamu dan pemeriksaan sesi di pintu. Belum ada flag untuk itu sekarang (ponytail: tambahkan saat backend hosted siap).
- Login tidak lagi berada di Ekosistem, tetapi di pintu saat orang menekan "Coba simulator".
- Setelah daftar, pengguna mengisi data pot yang dipakai aplikasi (tanaman, status tanam).
- Satu akun boleh punya banyak pot dengan tanaman berbeda, dan dashboard berpindah antar pot.
- Ada profil pengguna dan tombol keluar. Sidebar tidak boleh bertambah ramai.

## Tujuan

1. Pintu masuk `#masuk` dengan kartu "Maskot penjaga" yang sudah ada, ditambah tombol "Coba tanpa akun".
2. Profil dan keluar: menu avatar di topbar dan halaman `#profil` (akun, keamanan, produk dan perangkat).
3. Ekosistem tanpa scroll panjang: ringkasan akun dan tab langsung di atas.
4. Pot milik akun: daftar pot tersimpan di server, mengikuti akun ke perangkat lain.
5. Wizard "Tambah pot": dipakai untuk pot pertama setelah daftar, dan untuk pot berikutnya.
6. Pemilih pot di topbar. Semua halaman simulator mengikuti pot aktif.
7. Rail lebih ringkas.

## Bukan tujuan

- Riwayat simulasi tidak disinkronkan ke server. Riwayat tetap di browser, per pot.
- Pot belum ditautkan ke unit perangkat fisik. Penautan menyusul saat dashboard bisa membaca telemetri nyata.
- Tidak ada pemindahan otomatis pot tamu ke akun.
- Tidak menampilkan foto profil Google. Avatar memakai inisial, sehingga tidak ada permintaan ke server Google dan header CSP tetap sederhana.

## Anti-tujuan (gagal walau "jalan")

- Pengunjung demo publik terkunci di balik login.
- Ambang agronomi dikarang. Tomat atau mawar hanya muncul setelah profilnya dikurasi dengan sumber.
- Dua "akun" tampil bersamaan, yaitu akun online dan akun demo Miro.
- Sesi lokal milik pengguna lama hilang.

## Kondisi sekarang (hasil baca kode)

- **Rute.** `Site.tsx` memuat `App` untuk hash simulator (`isSimulatorHash`). `App.tsx` punya 6 halaman di rail:
  - Dashboard `#statistik`
  - Simulasi `#simulasi`
  - Bandingkan sesi `#bandingkan`
  - Status perangkat `#perangkat`
  - Ekosistem `#ekosistem`
  - Terminal `#terminal`
- **Pot lokal.** Pot lokal sebenarnya adalah "sesi" (`SessionBook` di localStorage).
  - Tiap sesi membawa `PotCase.profile` sendiri: crop, media, phase, ambang, dan seterusnya.
  - Status tanam ada di `simulation.planted`.
  - Topbar menampilkan `session-pill` (nama, tanaman), menu Berkas, dan maskot `PlantMood` sebagai avatar.
- **Ekosistem.** `MiroEcosystemWorkspace` diawali `<ProductAccount/>`, yang berisi masuk, produk, keamanan, transfer, telemetri, pengetahuan, energi, dan reward. Setelah itu baru "Peran dan akun aktif" (akun demo Miro, saldo demo) dan tab modul. Itulah penyebab scroll jauh.
- **Backend.**
  - `product → unit (profile_version_id) → measurement`.
  - `create_my_unit` mensyaratkan produk fisik milik akun yang aktif, sehingga pot simulasi tidak bisa menjadi unit.
  - Profil kurasi diambil lewat `published_profile_versions`. `parameters_and_scope` berisi 11 kunci yang sama dengan `Profile` milik mesin aturan.
- **Demo Cloudflare.** Hanya frontend; `productAccountConfigured` bernilai false.

## Pendekatan penyimpanan pot

| Pendekatan | Untung | Rugi |
| --- | --- | --- |
| 1. Pot = sesi lokal saja, ditambah pemilih tanaman | Perubahan paling kecil | Pot tidak mengikuti akun ke perangkat lain, sehingga login hampir tidak berarti untuk pot |
| **2. Pengaturan pot di server per akun, riwayat simulasi lokal per pot (dipilih)** | Pot mengikuti akun; data tanaman tervalidasi server; bisa ditautkan ke perangkat nanti | Tabel dan RPC baru; tamu dan akun memakai dua sumber daftar pot |
| 3. Setiap pot = produk dan unit di backend | Satu model data | Ditolak: unit butuh produk fisik teraktivasi (serial, kode tersegel, tanda tangan perangkat). Produk virtual merusak registri |

Pendekatan 2 adalah pilihan saya (pengguna menyerahkan cara pembangunannya). Pot adalah milik akun, dan riwayat simulasi hanyalah cache pemutaran di browser.

## Rancangan

### 1. Pintu masuk `#masuk`

```
┌───────────────────────────────────────────────────────────┐
│  [lumut + maskot]   │  Masuk ke Smart Agro                │
│                     │  [ G  Lanjut dengan Google ]        │
│                     │  [   Coba tanpa akun       ]        │
│                     │  Data tamu hanya ada di browser ini.│
│                     │  ▸ Pakai email dan kata sandi        │
│                     │  1. Masuk  2. Siapkan pot  3. 2FA    │
└───────────────────────────────────────────────────────────┘
```

- **Kapan tampil.** Semua hash simulator (termasuk tautan langsung `#ekosistem`) menampilkan pintu bila ketiga syarat ini terpenuhi:
  - backend terkonfigurasi;
  - belum ada sesi akun;
  - pengguna belum pernah memilih tamu.
  Setelah masuk atau memilih tamu, pengguna lanjut ke hash yang diminta (bawaan `#statistik`).
- **Pilihan tamu** diingat di localStorage (`smart-agro.guest`). Pengguna bisa masuk kapan saja dari menu avatar.
- **Tanpa backend (Cloudflare):** pintu dilewati dan pengguna langsung masuk sebagai tamu.
- **Komponen.** `AccountSignIn` dipakai ulang (kartu penuh, terpusat). Tombol tamu bergaya sekunder, di bawah tombol Google. Langkah ke-2 diganti namanya menjadi "Siapkan pot".
- **Kembali dari Google** ke `…#statistik`. Fallback di `main.tsx` mengikuti.

### 2. Topbar: pemilih pot dan avatar

```
[◉ Cabai teras ▾ · Cabai rawit · hari 12]          [jam] [berkas] [?] [tema] [MA]
  ┌ Pot saya ──────────────────┐                                    ┌ Maliq A. ────────┐
  │ ● Cabai teras   Cabai rawit│                                    │ m…@gmail.com     │
  │ ● Bawang dapur  Bawang merah│                                   │ Profil & keamanan│
  │ + Tambah pot               │                                    │ Keluar           │
  │ ⇄ Bandingkan pot           │                                    └──────────────────┘
  └────────────────────────────┘
```

- `session-pill` menjadi tombol popover "Pot saya".
  - Isinya: daftar pot (nama, tanaman, titik status dari mood), "Tambah pot", dan "Bandingkan pot".
  - Memilih pot sama dengan `activeId` sekarang.
  - Maskot `PlantMood` pindah ke dalam pil, karena ia menunjukkan keadaan pot aktif, bukan orangnya.
- **Avatar inisial** membuka menu.
  - Akun: nama dan email, "Profil & keamanan" (`#profil`), dan "Keluar".
  - Tamu: "Tamu", "Masuk untuk menyimpan pot", dan untuk demo tanpa backend: "Akun belum tersedia di demo ini".
- **Keluar** menghapus sesi akun, lalu kembali ke pintu.

### 3. Halaman `#profil` (tanpa item rail, dibuka dari avatar)

```
Profil
├ Akun        nama, email, masuk dengan Google/email, sejak …
├ Keamanan    2FA, log aktivitas   (ProductSecurity dipindah ke sini)
├ Produk      produk terdaftar, cek/klaim serial & QR, transfer
└ [Keluar]
```

Isi `ProductAccount` yang bersifat akun (produk, klaim, transfer, keamanan, keluar) pindah ke sini. Regional `aria-label` diperbarui, dan tes ikut berubah.

### 4. Ekosistem tanpa scroll panjang

- **Paling atas: strip ringkasan.**
  - Akun: saldo poin resmi, jumlah produk terdaftar, peran (`my_curation_roles`).
  - Tamu: akun demo Miro, ditandai "Mode demo".
- **Langsung di bawahnya: tab modul.** Panel online pindah ke tab yang cocok:
  - telemetri ke tab Unit;
  - pengetahuan ke tab Komunitas;
  - energi dan reward ke tab Energi;
  - cek QR tetap di tab Identitas.
- **Satu akun terlihat sekaligus.** Saat masuk, pemilih "Akun aktif" demo disembunyikan. Simulasi rancangan Miro di dalam tab tetap ada, dengan label "simulasi rancangan".

### 5. Pot milik akun (server)

- **Tabel baru `garden_pot`:**
  - `id`
  - `account_id → account`
  - `label` (1–120 karakter)
  - `builtin_profile` (`'cabai-rawit' | 'bawang-merah'`) **atau** `profile_version_id → profile_version`, tepat satu yang terisi (CHECK)
  - `planted_on date null`
  - `created_at`, `archived_at`
- **RLS:** pemilik hanya boleh membaca. Penulisan lewat `SECURITY DEFINER` dengan `current_auth_session()`.
- **RPC:**
  - `my_pots()`
  - `create_my_pot(label, builtin_profile, profile_version_id, planted_on)`
  - `update_my_pot(id, label, planted_on)`
  - `archive_my_pot(id)`
  - Batas 32 pot aktif per akun (ponytail: batas operasional, revisi setelah ada beban nyata).
  - Profil kurasi harus sudah terbit (`published_at <= now`).
- **Profil bawaan** = profil dari `scenarios.json` yang sudah dipakai aplikasi ("Cabai 55 stabil", "Bawang 55 profil berbeda"). Profil ini ditampilkan sebagai "Profil bawaan prototipe, belum divalidasi lapangan". Tidak disamarkan sebagai hasil kurasi, sehingga tidak perlu akun penulis palsu.
- **Riwayat simulasi** tetap di localStorage, dengan kunci per akun (`smart-agro.sessions:<user-id>`) dan per pot. Saat pot dibuka pertama kali di sebuah browser, sesinya dibuat dari pengaturan pot.
- **Tamu** memakai buku sesi lokal yang sudah ada. Sesi pengguna lama otomatis menjadi pot tamu.
- **Pot tamu tidak tampil selama masuk ke akun.** Setelah Keluar dan memilih tamu lagi, pot itu kembali.
- **Nama tampilan** diambil dari `user_metadata` Google. Untuk akun email, dipakai bagian depan alamat email.

### 6. Wizard "Tambah pot"

```
Siapkan pot            1 Masuk ✓  2 Siapkan pot  3 Amankan akun
Nama pot      [ Cabai teras            ]
Tanaman       (•) Cabai rawit   · profil bawaan prototipe
              ( ) Bawang merah  · profil bawaan prototipe
              ( ) …profil kurasi yang terbit
              Tanaman lain? Usulkan profil di Ekosistem › Komunitas.
Sudah ditanam? (•) Belum  ( ) Sudah, sejak [tanggal]
              [ Simpan pot ]
```

- **Muncul otomatis** saat akun belum punya pot. Dashboard tidak bisa dipakai tanpa pot.
- **Untuk tamu baru** (tanpa sesi lama) juga muncul, dengan isian bawaan sehingga cukup satu klik.
- **Data yang dipakai mesin:**
  - Tanaman menentukan `Profile`: ambang, media, fase.
  - "Belum" berarti perjalanan dimulai dari "Tanam & mulai".
  - "Sudah sejak tanggal" berarti `planted=true` dan hari = selisih tanggal, dibatasi `maxDay`.
- **Langkah 3** (2FA) bisa dilewati ("Nanti saja"). Penukaran poin tetap mensyaratkan 2FA, sesuai server.

### 7. Rail

- **Dashboard · Ruang tanam · Riwayat · Perangkat · Ekosistem**, lalu Panduan di bawah.
- **Riwayat** menggabungkan Terminal (log dan alasan) dengan Bandingkan pot dalam dua tab. Profil tidak masuk rail, karena aksesnya dari avatar.
- **Di ponsel**, dock berisi 5 item dan avatar tetap di topbar.

## Fase pengerjaan

| Fase | Isi | Menjawab keluhan |
| --- | --- | --- |
| 1 | Pintu `#masuk` + tamu, avatar dan Keluar, `#profil`, Ekosistem dengan ringkasan dan tab di atas | Login di Ekosistem, scroll jauh, tidak ada logout/profil |
| 2 | `garden_pot` dan RPC, wizard "Tambah pot", pemilih pot, riwayat per akun | Banyak pot berbeda tanaman, isi data yang dipakai |
| 3 | Rail ringkas (Riwayat), panel online masuk ke tab Ekosistem, akun demo hanya untuk tamu | Menu dashboard dirapikan |

Setiap fase menjalankan seluruh pemeriksaan wajib, tes browser, dan screenshot di 1440/768/390/320 dalam mode terang dan gelap.

## Batasan

- Hanya token warna, Fraunces Soft dan General Sans, Phosphor, dan dukungan reduced motion.
- Bahasa Indonesia, sedikit kata.
- Komponen `Product*.tsx` dipakai ulang, tidak ditulis ulang.
- Tes yang mencari region "Akun & kepemilikan produk online" di `#ekosistem` dipindah ke `#profil`.
- Commit, push, dan deploy hanya jika diminta.

## Keputusan saya (bisa dikoreksi)

- Riwayat simulasi lokal per akun, tidak dihapus saat keluar. Ini dicatat di SECURITY sebagai batas: data simulasi bisa dibaca di browser yang sama.
- Avatar memakai inisial, bukan foto Google.
- Tamu baru tetap melewati wizard singkat.
- Terminal dan Bandingkan digabung menjadi "Riwayat".
- Nama tabel `garden_pot` dan batas 32 pot.
- "Sudah ekspor atau enggak" dari pengguna saya tafsirkan sebagai "sudah ditanam atau belum", karena itu yang dipakai simulator.

## Diserahkan ke pembangun

- Bentuk persis strip ringkasan Ekosistem dan pemetaan detail panel ke tab.
- Animasi popover pot dan menu avatar, mengikuti pola `ui/popover` yang ada.
- Urutan migrasi dan nama RPC, selama aturan di atas terpenuhi.
