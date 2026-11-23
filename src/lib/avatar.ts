/** Profile photo (20261122000000_account_deletion_avatar): the centre square of the picked image at 256 px, encoded as
 * WebP, or JPEG where the browser cannot encode WebP. The server keeps at most 256 kB and checks the type's magic bytes.
 * ponytail: the crop is always the centre square; add a framing step if people complain their faces get cut off. */
export const AVATAR_PX = 256
const MAX_INPUT = 20 * 1024 * 1024

export function centerSquare(width: number, height: number) {
  const size = Math.min(width, height)
  return { sx: (width - size) / 2, sy: (height - size) / 2, size }
}

export function initialsOf(name: string) {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase()
}

/** Only Google's own photo host: the Content-Security-Policy allows no other image origin. */
export function googlePhoto(claims: Record<string, unknown>): string | null {
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>
  const url = [meta.avatar_url, meta.picture].find(value => typeof value === 'string')
  try { return url && new URL(url as string).origin === 'https://lh3.googleusercontent.com' ? url as string : null } catch { return null }
}

export const avatarSrc = (avatar: { mime: string; data: string } | null) => avatar ? `data:${avatar.mime};base64,${avatar.data}` : null

export function parseAvatar(value: unknown): { mime: string; data: string } | null {
  if (!value || typeof value !== 'object') return null
  const { mime, data } = value as Record<string, unknown>
  if (!['image/webp', 'image/jpeg', 'image/png'].includes(String(mime)) || typeof data !== 'string' || data.length > 350000 || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null
  return { mime: mime as string, data }
}

const encode = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>(done => canvas.toBlob(done, type, .86))

export async function avatarFromFile(file: Blob): Promise<{ mime: string; data: string }> {
  if (!file.type.startsWith('image/') || file.size > MAX_INPUT) throw new Error('Pilih berkas gambar, paling besar 20 MB.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Gambar ini tidak bisa dibaca. Coba foto lain.') })
  const { sx, sy, size } = centerSquare(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser ini tidak bisa menyiapkan foto.')
  context.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_PX, AVATAR_PX)
  bitmap.close()
  const webp = await encode(canvas, 'image/webp')
  const out = webp?.type === 'image/webp' ? webp : await encode(canvas, 'image/jpeg')
  if (!out) throw new Error('Foto tidak bisa disiapkan.')
  const bytes = new Uint8Array(await out.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mime: out.type, data: btoa(binary) }
}
