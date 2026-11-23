# Dashboard web v2 (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ganti kerangka dashboard web (rail + topbar) dengan desain mock v2 yang disetujui pengguna: kapsul navigasi
mengambang, halaman Ringkasan yang ringkas, halaman Tanaman yang rinci, gerak jelas tanpa memicu mabuk gerak.

**Architecture:** Hash tetap: `#statistik` = Ringkasan (pendaratan), `#tanaman` baru = rinci satu tanaman (isi dashboard
lama), `#simulasi` = Ruang tanam (hanya `features.playground`), `#profil`/`#ekosistem`/`#hapus-akun` = Akun.
`#bandingkan`, `#terminal`, `#perangkat` tetap ada tanpa tab dan dibuka dari halaman Tanaman. Status tiap tanaman
dihitung dari sesi slotnya (`evaluate`) sampai Codex menyediakan `my_overview`; kontrak data ada di
`2026-11-22-web-fitur-a-f.md`.

**Tech Stack:** React 19, framer-motion (sudah ada), View Transitions API, CSS container queries, Playwright (Chrome).

**Spec:** `design-previews/dashboard-apple-2026-11-22/index.html` + `NOTES.md` (mock v2) dan komentar pengguna
22 Nov 20.17: implementasikan; kartu awal jangan terlalu ramai saat banyak dan jangan berantakan saat sedikit; rail
perlu keterangan tanpa harus hover; kalender dan jurnal diserahkan ke Claude.

## Global Constraints

- Gerak: tanpa kedip, denyut, pantulan, crossfade halaman. Yang bergerak hanya yang bermakna: lensa tab (320 ms),
  kartu → panggung (340 ms), jarum ukur (450 ms), lembar (300 ms), toast (200 ms). Morph berikutnya menyelesaikan yang
  berjalan. `prefers-reduced-motion`: semuanya langsung.
- Warna lewat token; Fraunces Soft hanya nama tanaman dan judul halaman; teks Indonesia, tanpa label kecil di atas judul.
- 1440/768/390/320 px, terang dan gelap, teks 200% di 375/320 tanpa luapan. Satu `role="status"` per halaman.
- Panggilan server setelah `account.loaded`.
- Berkas backend milik Codex (migrasi, functions, `src/lib/sensorCare.ts`, firmware) tidak disentuh.

## Keputusan desain dari komentar pengguna

- **Kartu tanaman menyesuaikan jumlah, tanpa pengalih tampilan.** "Perlu perhatian" (perlu siram, perangkat
  bermasalah; maksimal 3) tampil sebagai kartu besar bergambar; sisanya ubin ringkas (pot mini, nama, status, angka).
  Satu tanaman = satu kartu lebar (gambar kiri, keterangan kanan). Tidak ada yang perlu perhatian = tanaman dengan
  jadwal siram terdekat jadi kartu besar "Berikutnya". Filter tempat muncul bila lebih dari 4 tanaman di lebih dari
  satu tempat; kolom cari bila lebih dari 8.
- **Rail berketerangan.** Judul "Tanaman lain" di atas rail; tiap garis berlabel kode tanaman (CB-1) seperti angka
  penggaris; garis aktif tebal dengan nama; pratinjau saat hover/fokus tetap ada. Di ponsel rail menjadi strip
  mendatar yang bisa digulir.
- **Riwayat satu kartu, tiga segmen:** Grafik (brush chart dengan penanda siram) · Kalender (jam di rentang sehat) ·
  Jurnal. Halaman rinci tidak memanjang.

## Fase

### U1 Kerangka dan navigasi
- [ ] `src/components/shell/NavCapsule.tsx`: kapsul kaca (logo, tab, `ThemeToggle`, `AccountMenu`), lensa framer
  `layoutId` dengan tween 0,32 s (bukan spring). Atas di layar lebar, bawah di bawah 48rem (container query).
- [ ] `App.tsx`: halaman `plant` (`#tanaman`); tab aktif per kelompok; rail + topbar dihapus; alat sesi (jam, berkas,
  panduan, simpan) pindah ke kepala halaman Tanaman; transisi halaman jadi seketika (crossfade dibuang).
- [ ] Tes: `ui-browser`, `route-transition-browser` diperbarui; tes baru `nav-browser.mjs` (tab, lensa, keyboard,
  ponsel di bawah, tanpa crossfade: tidak ada `::view-transition-old(root)` beranimasi).

### U2 Ringkasan
- [ ] `src/components/overview/Overview.tsx` + `overview.css`: kalimat keadaan, kartu adaptif (di atas), "Siram hari
  ini" (garis ukur), ringkasan perangkat (hanya akun berproduk; tamu tidak melihatnya).
- [ ] Kartu → panggung dengan View Transition (`view-transition-name` sama di kartu dan panggung).
- [ ] Tes `overview-browser.mjs`: 1/3/8 tanaman, urutan perlu-perhatian-dulu, kartu membuka `#tanaman`.

### U3 Tanaman (rinci)
- [ ] Kepala (kembali, Tanaman lain, alat sesi), panggung + ringkasan keputusan, Kondisi dengan pita ukur,
  Riwayat tiga segmen, Perangkat (data unit bila ada), rail berketerangan.
- [ ] Tes `dashboard-browser`, `plant-scene-browser`, `learning-browser`, `garden-browser`, `pot-setup` diperbarui.

### U4 Gerak, aksesibilitas, tangkapan
- [ ] Audit gerak per frame (seperti `gate-motion-browser`): tidak ada opacity < 1 pada root saat pindah halaman.
- [ ] Tangkapan 1440/768/390/320 terang/gelap/200%; `npm run lint`, `typecheck`, `test`, `build`.

### U5 (setelah backend Codex ditinjau) Sambungkan A–F
- [ ] `my_overview`, `my_watering_outlook`, `my_unlogged_rises`, `my_unit_health`, peringatan, kalibrasi.
