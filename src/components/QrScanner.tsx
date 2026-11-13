import { Camera, ImageSquare, QrCode } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { serialFromScan } from '../lib/productQr'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'

type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> }
type NativeDetector = { new (options: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }

/* The browser's own BarcodeDetector where it reads QR (Android, macOS, ChromeOS); elsewhere the ZXing WebAssembly
 * ponyfill, loaded only when a scan starts. The .wasm is bundled with the site rather than fetched from a CDN. */
let detector: Promise<Detector> | null = null
function qrDetector() {
  detector ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector
    if (Native && (await Native.getSupportedFormats().catch((): string[] => [])).includes('qr_code')) return new Native({ formats: ['qr_code'] })
    const [{ BarcodeDetector, prepareZXingModule }, { default: wasm }] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm : prefix + path) } })
    return new BarcodeDetector({ formats: ['qr_code'] }) as Detector
  })().catch(error => { detector = null; throw error })
  return detector
}

/** Any image the browser can show (PNG, JPEG, SVG), drawn onto a canvas the detector can read. */
async function imageCanvas(file: File) {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 800) * scale))
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 800) * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white' // transparent SVG backgrounds would otherwise read as black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally { URL.revokeObjectURL(url) }
}

function cameraMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin kamera ditolak. Pilih foto QR, atau ketik nomor seri.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera tidak ditemukan. Pilih foto QR, atau ketik nomor seri.'
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu atau pilih foto QR.'
  return 'Pemindai belum dapat dimulai. Pilih foto QR, atau ketik nomor seri.'
}

/** Opens a dialog that reads a product QR from the camera or a photo and hands back only the public serial. */
export default function QrScanner({ onSerial, label = 'Pindai QR' }: { onSerial: (serial: string, warning?: string) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [live, setLive] = useState(false)
  // The video sits in the dialog's portal, which mounts a render after `open` flips: a callback ref re-runs the
  // camera effect once the element exists instead of reading a ref that is still empty.
  const [view, setView] = useState<HTMLVideoElement | null>(null)
  const done = useRef(onSerial)
  done.current = onSerial

  const accept = useCallback((raw: string) => {
    const result = serialFromScan(raw)
    if (!result.ok) { setStatus(result.reason); return false }
    done.current(result.serial, result.warning)
    setOpen(false)
    return true
  }, [])

  useEffect(() => {
    if (!open || !view) return
    let stopped = false, timer = 0, stream: MediaStream | null = null
    setStatus(''); setLive(false)
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('Kamera tidak tersedia di browser ini. Pilih foto QR, atau ketik nomor seri.'); return }
    void (async () => {
      try {
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        // Closed while the permission prompt was open: release the camera at once.
        if (stopped) { camera.getTracks().forEach(track => track.stop()); return }
        stream = camera
        view.srcObject = stream
        await view.play()
        setLive(true)
        setStatus('Arahkan kamera ke QR pada kemasan.')
        const reader = await qrDetector()
        const tick = async () => {
          if (stopped) return
          try { const codes = await reader.detect(view); if (codes[0] && accept(codes[0].rawValue)) return } catch { /* a frame that cannot be read yet */ }
          timer = window.setTimeout(() => void tick(), 220)
        }
        void tick()
      } catch (error) { if (!stopped) { setLive(false); setStatus(cameraMessage(error)) } }
    })()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach(track => track.stop())
      view.srcObject = null
    }
  }, [open, view, accept])

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="button"><QrCode weight="duotone" aria-hidden="true" />{label}</button></DialogTrigger>
    <DialogContent className="qr-scanner">
      <DialogTitle>Pindai QR produk</DialogTitle>
      <DialogDescription>QR publik hanya memuat nomor seri. Kode aktivasi tersegel tetap Anda ketik sendiri.</DialogDescription>
      <div className="qr-scanner-view" data-live={live || undefined}>
        <video ref={setView} muted playsInline aria-label="Pratinjau kamera" />
        {!live && <Camera weight="duotone" aria-hidden="true" />}
      </div>
      <p className="qr-scanner-status" aria-live="polite">{status}</p>
      <label className="button qr-scanner-file">
        <ImageSquare weight="duotone" aria-hidden="true" />Pilih foto QR
        <input type="file" accept="image/*" onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setStatus('Membaca foto…')
          try {
            const codes = await (await qrDetector()).detect(await imageCanvas(file))
            if (!codes.length) setStatus('QR tidak terbaca pada foto. Pastikan QR tajam, utuh, dan cukup terang.')
            else accept(codes[0].rawValue)
          } catch { setStatus('Foto tidak dapat dibaca. Coba foto lain, atau ketik nomor seri.') }
        }} />
      </label>
    </DialogContent>
  </Dialog>
}
