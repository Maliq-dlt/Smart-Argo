# Cuaca

Cuaca dipakai untuk dua hal saja: **langit di panggung tanaman** dan **satu baris catatan** di saran perawatan. Cuaca tidak pernah mengubah angka sensor, tidak pernah menyebut dosis, dan di dalam ruangan tidak menambah catatan apa pun (`weatherNote`, `src/lib/weather.ts`).

## Keadaan saat ini (prototipe)

- **Demo memakai cuaca simulasi.** Kontrol "Cuaca simulasi" di dashboard memilih salah satu dari lima langit: cerah, berawan, mendung, hujan, terik. Pilihannya disimpan di `localStorage` (`smart-agro.weather`). Tidak ada panggilan jaringan.
- **Model dan adapter sudah ada dan teruji**: `src/lib/weather.ts` memuat `WeatherSnapshot`, `simulatedWeather`, `fromOpenMeteo` (adapter murni untuk respons Open-Meteo), `simKind` (badai tampil sebagai hujan, langit cerah yang panas tampil sebagai terik) dan `weatherNote`.
- **Fungsi `weather-forecast` ada di repo tetapi tidak di-deploy** (`supabase/functions/weather-forecast/`). Ia tidak masuk skrip deploy mana pun dan tidak dipanggil dari aplikasi. Mengaktifkannya adalah bagian Fase 8 dan butuh persetujuan pemilik proyek.
- Fixture `tests/fixtures/open-meteo-forecast.json` **ditulis tangan** mengikuti bentuk respons yang terdokumentasi, bukan rekaman nyata. Ganti dengan rekaman nyata saat fungsi diaktifkan.

## Penyedia dan syaratnya

Syarat berikut diperiksa dari halaman resmi masing-masing pada 2026-11-15. Periksa lagi sebelum mengaktifkan, karena syarat bisa berubah.

| Penyedia | Kuota gratis | Syarat penting | Cocok untuk |
| --- | --- | --- | --- |
| Open-Meteo | 10.000 permintaan per hari | Gratis hanya untuk **penggunaan non-komersial**; untuk komersial perlu paket berbayar. Tanpa kunci API. | Adapter pertama, demo, dan portofolio |
| BMKG (data prakiraan terbuka) | 60 permintaan per menit per IP | Per kelurahan; atribusi ke BMKG wajib; **izin tertulis** bila dipakai untuk komersial atau diintegrasikan ke produk pihak ketiga | Target produk di Indonesia |
| WeatherAPI.com | 100.000 permintaan per bulan | Paket gratis menyebut boleh untuk aplikasi komersial; prakiraan 3 hari | Cadangan bila Open-Meteo tidak boleh dipakai |
| MET Norway (Locationforecast) | Tanpa kunci, dengan batas wajar | Wajib mengirim `User-Agent` yang mengenali aplikasi dan kontaknya | Pilihan lain bila perlu |

Urutan: **Open-Meteo dulu** (adapter sudah ada), **BMKG** sebagai target setelah izin tertulis didapat, **WeatherAPI.com** sebagai cadangan.

## Privasi

- Koordinat yang dikirim ke penyedia dibulatkan ke dua desimal (sekitar 1 km), dikirim lewat fungsi server (bukan dari browser), dan tidak disimpan bersama identitas akun.
- Pot dalam ruangan tidak memanggil cuaca sama sekali.
- Cuaca tidak ikut ke data komunitas (Fase 7).

## Menambah penyedia

Tulis adapter murni `fromXxx(json): WeatherSnapshot` di `src/lib/weather.ts` (kode kondisi penyedia ke lima `Condition`, nilai tak dikenal jatuh ke `berawan`, respons yang tidak terbaca melempar galat), tambahkan fixture dan tesnya, lalu pakai di fungsi server. Fungsi tidak boleh memanggil jaringan dari tesnya.
