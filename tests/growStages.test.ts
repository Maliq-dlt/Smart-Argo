import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { GROW_RESET_FRAME, GROW_STAGES, GROW_START_FRAME } from '../src/components/landing/v5/growStages.ts'

test('growth stages run forward from the sprout and end before the clip empties the pot', () => {
  assert.deepEqual(GROW_STAGES.map(stage => stage.label), ['Minggu 1', 'Minggu 3', 'Minggu 5', 'Berbunga'])
  assert.ok(GROW_START_FRAME < GROW_STAGES[0].frame)
  GROW_STAGES.slice(1).forEach((stage, i) => assert.ok(stage.frame > GROW_STAGES[i].frame, `${stage.label} comes after ${GROW_STAGES[i].label}`))
  assert.ok(GROW_STAGES.at(-1)!.frame < GROW_RESET_FRAME)
})

// The recoloured clip may only use the Sage leaf greens, the soft flower yellow, and the untouched pot, soil and petals.
const palette = new Set([
  '#4b7a45', '#5e8b4e', '#6f9d58', '#a3c486', '#e2c24e',
  '#ffffff', '#000000', '#f0bda8', '#592e21', '#7a3d29', '#81351d', '#572214', '#b8634a', '#d47d5e', '#633326', '#4a261c', '#d67a5e', '#de856b', '#b55c42', '#a34f3b', '#cc6e52',
])

test('the growth clip only uses the landing palette', () => {
  const clip = JSON.parse(readFileSync('public/landing/lottie/grow.json', 'utf8'))
  const hex = (c: number[]) => '#' + c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
  const found = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const shape = node as { ty?: string; c?: { a: number; k: number[] | { s?: number[] }[] } }
    if ((shape.ty === 'fl' || shape.ty === 'st') && shape.c) {
      if (shape.c.a) (shape.c.k as { s?: number[] }[]).forEach(key => key.s && found.add(hex(key.s)))
      else found.add(hex(shape.c.k as number[]))
    }
    Object.values(node).forEach(walk)
  }
  walk(clip)
  assert.ok(found.size > 0)
  assert.deepEqual([...found].filter(color => !palette.has(color)), [])
})
