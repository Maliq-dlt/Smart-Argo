# Verifikasi paket diagram revisi 2

Tanggal: 26 September 2026. Acuan aplikasi: commit `3cb7cc55f9457e77c51adb068a67f6a6e5b85b20`.

## Hasil render

- 4 sumber `.puml`: berhasil dirender dengan PlantUML 1.2025.4 dan runtime Java lokal.
- 12 sumber `.mmd`: lolos parser dan renderer Mermaid 11.12.2 pada Chrome lokal.
- SVG dan PNG disertakan. `render-manifest.json` mencatat engine, dimensi dan SHA-256 tiap sumber serta gambar.
- Pemeriksaan visual mencakup figur aktor, batas sistem, kepadatan garis, teks keputusan, judul kelompok dan label hubungan ERD. Empat use case memiliki lebar kurang dari 1.000 piksel, dengan oval yang tidak saling menimpa.

## Pemeriksaan paket yang dapat dijalankan

Dari folder hasil ekstraksi paket:

```powershell
python check_diagrams.py
```

Pemeriksaan memakai Python standard library. Memeriksa jumlah diagram, 20 ID use case, kesamaan hubungan aktor antara sumber dan SVG PlantUML, figur stickman, oval yang tidak saling bertumpuk, integritas sumber/gambar, serta tautan dokumen. Ini bukan pengujian fitur produk yang belum diimplementasikan. Jika sumber diubah, render dan manifest perlu diperbarui; kegagalan hash mencegah gambar lama dianggap cocok dengan sumber baru.

Hasil pemeriksaan paket: **PASS** untuk 16 diagram, 20 use case, asosiasi aktor, figur stickman, posisi oval, hash dan tautan. Seluruh SVG lolos parser XML dan tidak memakai `foreignObject` untuk label HTML.

## Perintah render yang dipakai di workspace

Dijalankan dari folder `simulasi-web`:

```powershell
$env:TEMP = Join-Path (Get-Location) '.tmp'
$env:TMP = $env:TEMP
$javaExe = Get-ChildItem -LiteralPath '.tmp/plantuml' -Filter java.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
& $javaExe "-Djava.io.tmpdir=$env:TEMP" '-Djava.awt.headless=true' -jar '.tmp/plantuml/plantuml-1.2025.4.jar' -charset UTF-8 -tsvg 'docs/diagram/v2/*.puml' -o svg
$env:PLAYWRIGHT_MODULE = 'C:\Users\malik\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
node .tmp/diagram-revision/render.cjs
python docs/diagram/v2/check_diagrams.py
git diff --check
git diff
```

Runtime renderer berada dalam `.tmp` workspace dan tidak dimasukkan ke ZIP. Dependency aplikasi tidak ditambah atau diubah. Pengguna alat web dapat merender kode melalui Mermaid/PlantUML tanpa menyalin runtime lokal tersebut.

## Batas pengujian

Impor langsung ke akun Miro belum diuji. PNG/SVG tidak menjamin konversi menjadi shape Miro native. Diagram PlantUML merupakan use case UML; Mermaid digunakan untuk flowchart dan ERD.

Tidak ada perubahan source aplikasi, firmware, kontrak blockchain atau schema DB. Test, lint, type-check dan build aplikasi tidak diulang karena perubahan hanya dokumentasi dan artefak diagram. Skenario aktivasi, serangan replay, penukaran, energi dan AI dalam spesifikasi adalah kriteria penerimaan untuk implementasi berikutnya, bukan hasil uji fitur yang sudah berjalan.
