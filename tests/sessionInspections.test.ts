import assert from 'node:assert/strict'
import test from 'node:test'
import { loadScenario } from '../src/lib/gardenSessions.ts'
import { parseSession } from '../src/lib/sessionStore.ts'

const base = () => JSON.parse(JSON.stringify(loadScenario(0)))
const withChecks = (inspections: unknown) => ({ ...base(), inspections })

test('a session keeps the checks its owner recorded', () => {
  const session = base()
  const checks = [{ t_h: 1, state: 'sehat' }, { t_h: session.data.now_h, state: 'bermasalah', note: 'daun menguning di ujung' }]
  const parsed = parseSession(withChecks(checks))
  assert.deepEqual(parsed.inspections, checks)
  assert.equal(parseSession(session).inspections, undefined, 'a session without checks stays without')
  assert.deepEqual(parseSession(withChecks([])).inspections, [])
})

test('damaged checks are refused when a session is read', () => {
  const now = base().data.now_h
  const bad: unknown[] = [
    'sehat', {}, [null], [[]], [{ t_h: 1, state: 'kuning' }], [{ t_h: 1 }], [{ state: 'sehat' }], [{ t_h: -1, state: 'sehat' }], [{ t_h: now + 1, state: 'sehat' }],
    [{ t_h: '3', state: 'sehat' }], [{ t_h: 1, state: 'sehat', note: 5 }], [{ t_h: 1, state: 'sehat', note: 'x'.repeat(141) }],
    Array.from({ length: 201 }, () => ({ t_h: 1, state: 'biasa' })),
  ]
  for (const checks of bad) assert.throws(() => parseSession(withChecks(checks)), /tidak valid/i, JSON.stringify(checks)?.slice(0, 60))
  assert.doesNotThrow(() => parseSession(withChecks(Array.from({ length: 200 }, () => ({ t_h: 1, state: 'biasa' })))), 'the limit itself is allowed')
  assert.doesNotThrow(() => parseSession(withChecks([{ t_h: 0, state: 'sehat', note: 'x'.repeat(140) }])))
})
