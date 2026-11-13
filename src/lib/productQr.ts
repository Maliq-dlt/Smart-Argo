/* Public product QR (ID-01): the code carries only a link with the public serial. Sealed activation codes and
 * device keys never belong in it (docs/diagram/v2/SPESIFIKASI.md §3), so a scan yields a serial and nothing else. */
export const SERIAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

export type ScanResult = { ok: true; serial: string; warning?: string } | { ok: false; reason: string }

/** The link printed on the package: opens the ecosystem page with the serial pre-filled. */
export function productLink(serial: string, origin: string) {
  if (!SERIAL.test(serial)) throw new Error('Nomor seri tidak valid.')
  let base: URL
  try { base = new URL(origin) } catch { throw new Error('Alamat aplikasi tidak valid.') }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('Alamat aplikasi tidak valid.')
  return `${base.origin}/?serial=${encodeURIComponent(serial.toUpperCase())}#ekosistem`
}

/** Reads a scanned QR payload. Accepts a bare serial or an http(s) link with a `serial` parameter. */
export function serialFromScan(raw: string): ScanResult {
  const text = raw.trim()
  if (!text || text.length > 2048) return { ok: false, reason: 'QR kosong atau terlalu panjang untuk QR produk.' }
  if (SERIAL.test(text)) return { ok: true, serial: text.toUpperCase() }
  let url: URL
  try { url = new URL(text) } catch { return { ok: false, reason: 'Isi QR bukan nomor seri atau tautan produk Smart Agro.' } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'Isi QR bukan tautan produk Smart Agro.' }
  const serial = url.searchParams.get('serial') ?? ''
  if (!SERIAL.test(serial)) return { ok: false, reason: 'Tautan pada QR tidak memuat nomor seri produk.' }
  const extra = [...url.searchParams.keys()].some(key => key !== 'serial')
  return extra
    ? { ok: true, serial: serial.toUpperCase(), warning: 'QR ini juga memuat parameter lain. Hanya nomor seri yang dipakai; jangan bagikan foto QR tersebut.' }
    : { ok: true, serial: serial.toUpperCase() }
}

/** One SVG path for the dark modules, merged into horizontal runs so a version-4 code stays a few hundred segments. */
export function qrPath(matrix: boolean[][]) {
  let d = ''
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      let end = x
      while (end + 1 < row.length && row[end + 1]) end++
      d += `M${x} ${y}h${end - x + 1}v1h-${end - x + 1}z`
      x = end
    }
  })
  return d
}
