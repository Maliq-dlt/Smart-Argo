// Recolours "plant5v3" by Ömer Faruk (LottieFiles, Lottie Simple License) to the landing's Sage palette:
// the four lime greens become Sage leaf tones, the neon flower centre the soft --eye yellow. Pot, soil and petals stay.
// usage: node scripts/recolor-grow-lottie.mjs  (source: media-src/lottie/plant5v3.json, ignored by git)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const source = 'media-src/lottie/plant5v3.json', target = 'public/landing/lottie/grow.json'
const recolor = {
  '#69980e': '#4b7a45', // leaf shade      -> --leaf-a
  '#82b42f': '#5e8b4e', // stem, mid leaf  -> between --leaf-a and --leaf-b
  '#9cc914': '#6f9d58', // leaf            -> --leaf-b
  '#b9d835': '#a3c486', // leaf light      -> towards --vein
  '#ffe818': '#e2c24e', // flower centre   -> --eye
}

const toHex = c => '#' + c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
const toRgb = (hex, alpha) => [...[1, 3, 5].map(i => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)), ...(alpha === undefined ? [] : [alpha])]
const swap = c => (recolor[toHex(c)] ? toRgb(recolor[toHex(c)], c[3]) : c)

let changed = 0
const walk = node => {
  if (Array.isArray(node)) return node.forEach(walk)
  if (!node || typeof node !== 'object') return
  if ((node.ty === 'fl' || node.ty === 'st') && node.c) {
    const before = JSON.stringify(node.c.k)
    if (node.c.a) node.c.k.forEach(key => { if (key.s) key.s = swap(key.s); if (key.e) key.e = swap(key.e) })
    else node.c.k = swap(node.c.k)
    if (JSON.stringify(node.c.k) !== before) changed++
  }
  Object.values(node).forEach(walk)
}

const clip = JSON.parse(readFileSync(source, 'utf8'))
walk(clip)
mkdirSync('public/landing/lottie', { recursive: true })
writeFileSync(target, JSON.stringify(clip))
console.log(`${changed} colours changed -> ${target}`)
