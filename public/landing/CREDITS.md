# Gambar, video, dan komponen landing Smart Agro

## Render dan klip konsep (Google Veo)

Dibuat pemilik proyek dengan Google Veo pada 12 November 2026, lalu dipotong dan dikodekan ulang untuk web. Semua adalah **render konsep**, bukan foto perangkat atau hasil uji Smart Agro.

| Berkas | Isi | Pengolahan |
| --- | --- | --- |
| `video/spin-loop.mp4`, `video/spin-poster.webp` | Perangkat berdiri dan berputar | Frame 58–189, maju lalu mundur supaya loop tanpa sambungan, H.264 1600×900 |
| `seq/lie/` | Perangkat rebah berputar pelan | Frame 0–42, AVIF desktop 1600×900 dan ponsel 960×720 |
| `seq/rootzone/` | Perangkat masuk ke zona akar di pot kaca | Setiap frame kedua, AVIF |
| `seq/water/` | Tangan menyiram cabai di teras | Dipangkas ke frame 8–104 (sebelum kamera bergeser), AVIF |
| `seq/grow/` | Cabai tumbuh dari tunas sampai berbunga | Setiap frame keempat dari klip 16 detik, AVIF |
| `video/garden.mp4`, `video/garden-poster.webp` | Kebun pot di atap rumah saat fajar | Maju lalu mundur, H.264 1280×720 |
| `v5/probe-lie.webp` | Gambar kunci perangkat rebah | WebP |

`v5/leaf-mask.svg` digambar untuk proyek ini.

## Foto dari koleksi terbuka

| Berkas | Judul | Pembuat | Lisensi | Sumber |
| --- | --- | --- | --- | --- |
| `potted-chili.webp` | A potted hot chili plant | Tinjure20 | CC0 | https://wordpress.org/photos/photo/50061f996e/ |

## Komponen dan pola 21st.dev

Diambil lewat MCP 21st.dev pada 12 November 2026. Atribusi juga tercantum di kepala tiap berkas.

- Hills Landscape Footer with Call to Action (`meadow-rise-footer`), kedhareswer: `src/components/landing/MeadowRiseFooter.tsx` (kode diadopsi).
- Image Sequence, joyco: urutan muat biner di `src/components/landing/v5/frameSequence.ts` (pola).
- ImgText Reveal Scroll Animation, ajith66310: foto yang membuka di antara kata di `Story.tsx` (pola).
- Chess Grid Transition, hyperiux: jeda baris dan kolom untuk blok transisi di `effects.ts` (pola).

Referensi teknik dan alur cerita tanpa menyalin teks atau aset: Farm Minerals / CropTab promo (farmminerals.com/promo).
