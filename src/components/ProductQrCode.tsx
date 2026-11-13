import { DownloadSimple } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { encode } from 'uqr'
import { productLink, qrPath } from '../lib/productQr'

/* Printed codes stay black on white in both themes: scanners expect dark modules on a light field. A four-module
 * quiet zone and level M error correction keep the code readable on a crumpled or glossy package. */
function svgMarkup(size: number, d: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${d}" fill="black"/></svg>`
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The public QR for one product: a link carrying the serial only, with SVG (print) and PNG (share) downloads. */
export default function ProductQrCode({ serial }: { serial: string }) {
  const { link, size, d } = useMemo(() => {
    const link = productLink(serial, window.location.origin)
    const qr = encode(link, { ecc: 'M', border: 4 })
    return { link, size: qr.size, d: qrPath(qr.data) }
  }, [serial])
  const name = `smart-agro-qr-${serial.toLowerCase()}`

  return <figure className="product-qr">
    <svg role="img" aria-label={`QR produk ${serial}`} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} className="product-qr-field" />
      <path d={d} className="product-qr-modules" />
    </svg>
    <figcaption>
      <strong>{serial}</strong>
      <small>{link}</small>
      <span className="miro-actions-row">
        <button type="button" className="button" onClick={() => save(new Blob([svgMarkup(size, d)], { type: 'image/svg+xml' }), `${name}.svg`)}>
          <DownloadSimple aria-hidden="true" />SVG untuk cetak
        </button>
        <button type="button" className="button" onClick={() => {
          const scale = 12, canvas = document.createElement('canvas')
          canvas.width = canvas.height = size * scale
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.scale(scale, scale); ctx.fillStyle = 'black'; ctx.fill(new Path2D(d))
          canvas.toBlob(blob => { if (blob) save(blob, `${name}.png`) }, 'image/png')
        }}>
          <DownloadSimple aria-hidden="true" />PNG
        </button>
      </span>
    </figcaption>
  </figure>
}
