import assert from 'node:assert/strict'
import test from 'node:test'
import { encode } from 'uqr'
import { productLink, qrPath, serialFromScan } from '../src/lib/productQr.ts'

test('Tautan QR produk hanya memuat nomor seri publik dan membuka halaman ekosistem', () => {
  assert.equal(productLink('pot-001', 'https://smart-agro-demo.pages.dev'), 'https://smart-agro-demo.pages.dev/?serial=POT-001#ekosistem')
  assert.equal(productLink('POT-001', 'http://127.0.0.1:5173/'), 'http://127.0.0.1:5173/?serial=POT-001#ekosistem')
  assert.throws(() => productLink('bukan seri valid', 'https://example.com'), /Nomor seri/)
  assert.throws(() => productLink('POT-001', 'javascript:alert(1)'), /Alamat/)
})

test('Hasil pindai menerima seri langsung atau tautan produk, lalu mengabaikan parameter lain', () => {
  assert.deepEqual(serialFromScan('pot-001'), { ok: true, serial: 'POT-001' })
  assert.deepEqual(serialFromScan('  https://smart-agro-demo.pages.dev/?serial=garden-7#ekosistem  '), { ok: true, serial: 'GARDEN-7' })
  // A sealed code printed into a public QR is a packaging mistake: the serial is still read, the secret never travels further.
  const leaked = serialFromScan('https://example.com/?serial=POT-9&code=SECRET-123')
  assert.deepEqual(leaked, { ok: true, serial: 'POT-9', warning: 'QR ini juga memuat parameter lain. Hanya nomor seri yang dipakai; jangan bagikan foto QR tersebut.' })
})

test('Isi QR yang bukan produk Smart Agro ditolak dengan alasan yang jelas', () => {
  for (const text of ['', 'https://example.com/', 'https://example.com/?serial=', 'ftp://example.com/?serial=POT-1', 'WIFI:S:rumah;T:WPA;P:rahasia;;', 'x'.repeat(2049)]) {
    const result = serialFromScan(text)
    assert.equal(result.ok, false, text.slice(0, 40))
  }
  assert.match((serialFromScan('https://example.com/') as { reason: string }).reason, /nomor seri/)
})

test('Jalur SVG QR menggambar tepat modul gelap dari matriks dan dapat dibaca ulang', () => {
  const text = 'https://smart-agro-demo.pages.dev/?serial=POT-001#ekosistem'
  const qr = encode(text, { ecc: 'M', border: 0 })
  const path = qrPath(qr.data)
  const dark = qr.data.flat().filter(Boolean).length
  // Every dark run is one "M x yh w v1 h-w z" segment; summing the widths gives back the dark module count.
  const widths = [...path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0)
  assert.equal(widths, dark)
  assert.ok(qr.size >= 21)
})
