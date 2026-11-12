/* Canvas image-sequence player driven from outside (scroll progress or a click tween).
 * The binary load order (first, last, middle, then the middles of each half) comes from
 * "Image Sequence" by joyco on 21st.dev: the whole motion is visible at a low frame rate almost
 * immediately and gets smoother as more frames arrive. The rest is written for this landing:
 * frames start loading only when the stage approaches the viewport, phones get a lighter crop,
 * and the closest loaded frame is drawn while the exact one is still on its way. */

export type SequenceSource = { dir: string; count: number }

export type SequenceOptions = {
  desktop: SequenceSource
  mobile: SequenceSource
  /** Media query that selects the lighter phone crop (default: max-width 760px). */
  mobileQuery?: string
  onFirstFrame?: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')

export function binaryOrder(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  const order = [0, count - 1], seen = new Set(order), queue: Array<[number, number]> = [[0, count - 1]]
  while (queue.length) {
    const [a, b] = queue.shift()!
    if (b - a <= 1) continue
    const mid = (a + b) >> 1
    if (!seen.has(mid)) { seen.add(mid); order.push(mid) }
    queue.push([a, mid], [mid, b])
  }
  return order
}

export class FrameSequence {
  private ctx: CanvasRenderingContext2D
  private frames: (HTMLImageElement | undefined)[] = []
  private source: SequenceSource
  private started = false
  private disposed = false
  private current = 0
  private resize: ResizeObserver
  private near: IntersectionObserver
  private width = 0
  private height = 0

  constructor(private canvas: HTMLCanvasElement, private options: SequenceOptions) {
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.source = matchMedia(options.mobileQuery ?? '(max-width: 760px)').matches ? options.mobile : options.desktop
    this.frames = new Array(this.source.count)
    this.resize = new ResizeObserver(() => this.measure())
    this.resize.observe(canvas)
    // Start fetching when the stage is within about one screen of the viewport.
    this.near = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) this.load() }, { rootMargin: '120% 0px' })
    this.near.observe(canvas)
    this.measure()
  }

  get count() { return this.source.count }
  get index() { return this.current }

  private measure() {
    const rect = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr)
    if (!w || !h || (w === this.width && h === this.height)) return
    this.width = this.canvas.width = w
    this.height = this.canvas.height = h
    this.paint()
  }

  load() {
    if (this.started || this.disposed) return
    this.started = true
    const order = binaryOrder(this.source.count)
    let next = 0
    // Four requests in flight keeps the queue moving without starving the rest of the page.
    const pump = () => {
      if (this.disposed || next >= order.length) return
      const i = order[next++], img = new Image()
      img.decoding = 'async'
      img.src = `${this.source.dir}/${pad(i)}.avif`
      img.decode().then(() => {
        if (this.disposed) return
        this.frames[i] = img
        if (i === 0) this.options.onFirstFrame?.()
        if (Math.abs(i - this.current) <= 2 || !this.frames[this.current]) this.paint()
      }).catch(() => {}).finally(pump)
    }
    for (let k = 0; k < 4; k++) pump()
  }

  /** Nearest frame that has arrived, searching outward from the wanted index. */
  private nearest(i: number) {
    for (let d = 0; d < this.source.count; d++) {
      const a = this.frames[i - d], b = this.frames[i + d]
      if (a) return a
      if (b) return b
    }
    return undefined
  }

  /** Cover fit, like object-fit: cover. */
  private draw(img: HTMLImageElement) {
    const { width: cw, height: ch } = this, iw = img.naturalWidth, ih = img.naturalHeight
    const scale = Math.max(cw / iw, ch / ih), w = iw * scale, h = ih * scale
    this.ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h)
  }

  private paint() {
    if (!this.width || this.disposed) return
    const img = this.nearest(this.current)
    if (img) this.draw(img)
  }

  /** Show the frame for a 0..1 progress value. */
  seek(progress: number) {
    this.show(Math.round(Math.min(1, Math.max(0, progress)) * (this.source.count - 1)))
  }

  show(index: number) {
    const i = Math.min(this.source.count - 1, Math.max(0, Math.round(index)))
    if (i === this.current && this.frames[i]) return
    this.current = i
    this.paint()
  }

  dispose() {
    this.disposed = true
    this.resize.disconnect()
    this.near.disconnect()
    this.frames = []
  }
}
