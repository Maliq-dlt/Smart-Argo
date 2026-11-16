# Cuaca

Cuaca dipakai untuk dua hal saja: **langit di panggung tanaman** dan **satu baris catatan** di saran perawatan. Cuaca tidak pernah mengubah angka sensor, tidak pernah menyebut dosis, dan di dalam ruangan tidak menambah catatan apa pun (`weatherNote`, `src/lib/weather.ts`).

## Keadaan saat ini (Fase 8, 2026-11-16)

- **Cuaca nyata** tampil untuk akun yang masuk, pada pot atau kebun **luar ruangan yang punya koordinat** (diisi di wizard). Panggung memakai langit dari data itu, menulis "Cuaca sekarang: …, … °C · data Open-Meteo" (atribusi wajib, CC BY 4.0), dan catatan saran memakai prakiraan 6 jam. Data diambil saat situs berganti, tidak diperbarui berkala.
- **Selain itu tetap cuaca simulasi**: tamu, situs tanpa koordinat, atau bila fungsi gagal. Di demo, kontrol "Cuaca simulasi" memilih satu dari lima langit (cerah, berawan, mendung, hujan, terik; disimpan di `localStorage` `smart-agro.weather`). Di build live tidak ada kontrol simulasi, jadi tanpa data nyata langitnya cerah polos tanpa catatan.
- **Fungsi `weather-forecast`** (`supabase/functions/weather-forecast/`) berjalan di Supabase dan di gateway lokal. Ia hanya melayani sesi yang masih hidup (diperiksa ke Auth); token yang dikenal tetapi tidak sah dijawab 401, Auth yang tidak terjangkau dijawab 503 supaya browser tidak mengeluarkan pengguna. `npm test` tidak pernah memanggil jaringan; gateway lokal memanggil Open-Meteo sungguhan.
- **Model dan adapter**: `src/lib/weather.ts` memuat `WeatherSnapshot`, `simulatedWeather`, `fromOpenMeteo`, `parseSnapshot` (memeriksa jawaban fungsi di browser), `simKind` (badai tampil sebagai hujan, langit cerah yang panas sebagai terik) dan `weatherNote`.
- Fixture `tests/fixtures/open-meteo-forecast.json` **ditulis tangan** mengikuti bentuk respons yang terdokumentasi, bukan rekaman nyata.

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
