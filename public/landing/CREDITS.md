# Gambar, video, dan komponen landing Smart Agro

## Perangkat 3D dan ilustrasi

- Perangkat di landing dimodelkan dengan kode (Three.js, `src/components/device/deviceModel.ts`). `device/*.webp` adalah poster yang dirender dari model itu (`scripts/render-device-posters.mjs`) untuk reduced motion dan browser tanpa WebGL. Semuanya **render konsep**, bukan foto perangkat atau hasil uji Smart Agro.
- Tanaman cabai, kebun dua pot, dan pot "Tanya mesinnya" digambar sebagai vektor untuk proyek ini (`PlantArt.tsx`, `GardenArt.tsx`, `Ask.tsx`). `v5/leaf-mask.svg` juga digambar untuk proyek ini.

## Render konsep (Google Veo)

Dibuat pemilik proyek dengan Google Veo pada 12 November 2026.

| Berkas | Isi | Pengolahan |
| --- | --- | --- |
| `rootzone-still.avif` | Perangkat di zona akar pot kaca | Frame pertama klip zona akar, versi ponsel, AVIF |

## Foto dari koleksi terbuka

| Berkas | Judul | Pembuat | Lisensi | Sumber |
| --- | --- | --- | --- | --- |
| `potted-chili.webp` | A potted hot chili plant | Tinjure20 | CC0 | https://wordpress.org/photos/photo/50061f996e/ |

## Animasi dari LottieFiles

| Berkas | Judul | Pembuat | Lisensi | Sumber | Perubahan |
| --- | --- | --- | --- | --- | --- |
| `lottie/grow.json` | plant5v3 | Ömer Faruk | Lottie Simple License | https://lottiefiles.com/animations/plant5v3-DlGito0Myl | Warna daun dan tengah bunga diubah ke palet Sage (`scripts/recolor-grow-lottie.mjs`) |

## Komponen dan pola 21st.dev

Diambil lewat MCP 21st.dev pada 12 November 2026. Atribusi juga tercantum di kepala tiap berkas.

- Hills Landscape Footer with Call to Action (`meadow-rise-footer`), kedhareswer: `src/components/landing/MeadowRiseFooter.tsx` (kode diadopsi).
- ImgText Reveal Scroll Animation, ajith66310: foto yang membuka di antara kata di `Story.tsx` (pola).
- Chess Grid Transition, hyperiux: jeda baris dan kolom untuk blok transisi di `effects.ts` (pola).

Referensi teknik dan alur cerita tanpa menyalin teks atau aset: Farm Minerals / CropTab promo (farmminerals.com/promo).
