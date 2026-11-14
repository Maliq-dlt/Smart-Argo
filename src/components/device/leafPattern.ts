type LeafOptions = { seed?: number; branches?: number; leaves?: number; blur?: boolean; time?: number }

/** Out-of-focus leaves, as cast by a window plant (after the Veo product shots). Draws black leaves on whatever the
 * caller filled first: the 3D spotlight uses it as a light mask, the hero as a soft shade over its sage backdrop.
 * `time` (seconds) sways each branch from its root and flutters the leaves; the same seed gives the same plant. */
export function drawLeaves(g: CanvasRenderingContext2D, width: number, height = width, { seed = 11, branches = 5, leaves = 14, blur = true, time = 0 }: LeafOptions = {}) {
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const k = Math.max(width, height) / 512
  g.save()
  if (blur) g.filter = `blur(${5 * k}px)`
  g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 4 * k
  for (let b = 0; b < branches; b++) {
    // Roots spread along the top edge so the shade covers the whole width.
    const rootX = (b + 0.2 + rnd() * 0.6) / branches * width, rootY = -20 * k
    let x = rootX, y = rootY, a = Math.PI / 2 + (rnd() - 0.5)
    g.save()
    g.translate(rootX, rootY); g.rotate(Math.sin(time * 0.55 + b * 1.7) * 0.045); g.translate(-rootX, -rootY)
    const stem: [number, number][] = [[x, y]]
    for (let step = 0; step < leaves; step++) {
      x += Math.cos(a) * 36 * k; y += Math.sin(a) * 36 * k; a += (rnd() - 0.5) * 0.5
      stem.push([x, y])
      const leaf = a + (step % 2 ? 1 : -1) * (0.9 + rnd() * 0.4) + Math.sin(time * 1.3 + step + b) * 0.07
      g.save(); g.translate(x + Math.cos(leaf) * 26 * k, y + Math.sin(leaf) * 26 * k); g.rotate(leaf)
      g.beginPath(); g.ellipse(0, 0, 30 * k, 12 * k, 0, 0, Math.PI * 2); g.fill(); g.restore()
    }
    g.beginPath(); stem.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke()
    g.restore()
  }
  g.restore()
}
