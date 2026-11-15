import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePot } from '../src/lib/productAccountClient.ts'

test('pots saved before the species catalog still read back unchanged', () => {
  assert.deepEqual(parsePot({ name: 'Pot teras', crop: 'cabai', device: true }), { name: 'Pot teras', crop: 'cabai', device: true })
  assert.deepEqual(parsePot({ name: 'Bawang teras', crop: 'bawang', device: false }), { name: 'Bawang teras', crop: 'bawang', device: false })
})

test('a pot name is tidied, and unsafe or oversized names are refused', () => {
  assert.equal(parsePot({ name: '  Pot   teras ', crop: 'cabai', device: false })?.name, 'Pot teras')
  for (const name of ['', '   ', '<b>pot</b>', 'x'.repeat(41), 'pot\u0007bel']) assert.equal(parsePot({ name, crop: 'cabai', device: false }), null, JSON.stringify(name))
})

test('a crop the simulator cannot open is refused, including keys inherited from Object', () => {
  for (const crop of ['anggrek', 'peoni', 'constructor', '__proto__', 'toString', '', 42, null, undefined, ['cabai']])
    assert.equal(parsePot({ name: 'Pot', crop, device: false }), null, String(crop))
  assert.equal(parsePot({ name: 'Pot', crop: 'cabai' }), null)
  assert.equal(parsePot('cabai'), null)
})
