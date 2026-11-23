// Motion comfort (2026-11-24): no bounce, no wobble, no blinking loops on the website. These checks read the web
// sources, so an overshooting easing, a spring or a new endless animation cannot come back unnoticed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) ? [path.replaceAll('\\', '/')] : []
})
const sources = walk('src').map(path => ({ path, text: readFileSync(path, 'utf8') }))

test('no easing curve overshoots its target', () => {
  for (const { path, text } of sources) for (const match of text.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
    const [, y1, , y2] = match[1].split(',').map(Number)
    assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `${path}: ${match[0]} goes past its target (a bounce)`)
  }
})

test('no springs or bouncing eases', () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /type: ?'spring'/, `${path}: use a tween; a spring overshoots`)
    assert.doesNotMatch(text, /\b(back|elastic|bounce)\.(in|out|inOut)\b/, `${path}: a GSAP ease that bounces`)
  }
})

test('endless animations are only slow ambient sway and busy spinners', () => {
  const found = sources.flatMap(({ path, text }) => [...text.matchAll(/animation: ([\w-]+)[^;]*\binfinite\b/g)].map(m => `${path} ${m[1]}`)).sort()
  assert.deepEqual(found, [
    'src/components/landing.css v5-sway', // the landing garden, 5 s per side, ±1.4°
    'src/components/landing/MeadowRiseFooter.tsx mrf-rot', // "sending" spinner
    'src/components/landing/MeadowRiseFooter.tsx mrf-sway', // footer meadow, 9 s per side
    'src/styles.css mascot-sway', // sign-in mascot's sprout, 6 s per side, ±1.5°
    'src/styles.css spin', // busy button spinner
  ])
  for (const { path, text } of sources) assert.doesNotMatch(text, /repeat: ?(-1|Infinity)/, `${path}: an endless JS animation`)
})
