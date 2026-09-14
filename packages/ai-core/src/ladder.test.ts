import { test } from 'node:test'
import assert from 'node:assert/strict'
import { climb, isCurrent, type Rung } from './ladder.ts'
import { AI_CONTRACT_VERSION, versionOf } from './contract.ts'

const bump = (to: number): Rung => ({ from: to - 1, up: (v) => ({ ...(v as object), contractVersion: to }) })

test('a record with no version reads as null, never as version 1', () => {
  assert.equal(versionOf({ value: 1 }), null)
  assert.equal(versionOf({ contractVersion: 0 }), null)
  assert.equal(versionOf({ contractVersion: '1' }), null)
  assert.equal(versionOf(null), null)
})

test('a snake_case column counts too, because that is how it comes back from the database', () => {
  assert.equal(versionOf({ contract_version: 3 }), 3)
  assert.equal(versionOf({ contractVersion: 2, contract_version: 9 }), 2)
})

test('a value already at the current contract needs no rung', () => {
  const r = climb({ contractVersion: AI_CONTRACT_VERSION, value: 'x' })
  assert.ok(isCurrent(r))
  assert.equal(r.upgraded, false)
})

test('a value with no version is held as legacy, not guessed at', () => {
  const raw = { value: 'x' }
  const r = climb(raw)
  assert.equal(r.status, 'legacy')
  assert.equal(isCurrent(r), false)
  assert.equal((r as { storedVersion: number | null }).storedVersion, null)
})

test('what cannot be climbed keeps its original bytes', () => {
  const raw = { value: 'x', nested: { a: [1, 2] } }
  const before = JSON.stringify(raw)
  const r = climb(raw)
  assert.equal(r.status, 'legacy')
  const original = (r as { original: unknown }).original
  assert.equal(JSON.stringify(original), before, 'writing it back must produce the same bytes')
  assert.equal(original, raw, 'it must be the same object, not a copy')
})

test('it climbs one rung at a time, never jumping', () => {
  const visited: number[] = []
  const rungs: Rung[] = [
    { from: 1, up: (v) => { visited.push(1); return { ...(v as object), contractVersion: 2 } } },
    { from: 2, up: (v) => { visited.push(2); return { ...(v as object), contractVersion: 3 } } },
    { from: 3, up: (v) => { visited.push(3); return { ...(v as object), contractVersion: 4 } } },
  ]
  const r = climb({ contractVersion: 1, value: 'x' }, rungs, 4)
  assert.ok(isCurrent(r))
  assert.deepEqual(visited, [1, 2, 3])
  assert.equal(r.upgraded, true)
})

test('a missing rung stops the climb and says which one is missing', () => {
  const r = climb({ contractVersion: 1, value: 'x' }, [bump(2), bump(4)], 4)
  assert.equal(r.status, 'gap')
  assert.match((r as { reason: string }).reason, /from contract 2/)
  assert.deepEqual((r as { original: unknown }).original, { contractVersion: 1, value: 'x' })
})

test('a value from a newer build is held, not silently read as current', () => {
  const r = climb({ contractVersion: 99, value: 'x' })
  assert.equal(r.status, 'ahead')
  assert.equal(isCurrent(r), false)
  assert.match((r as { reason: string }).reason, /reads up to/)
})

test('two rungs climbing from the same version is a mistake, not a coin flip', () => {
  assert.throws(
    () => climb({ contractVersion: 1 }, [bump(2), { from: 1, up: (v) => v }], 2),
    /two rungs climb from version 1/,
  )
})

test('nothing claims to have upgraded when no rung ran', () => {
  const r = climb({ contractVersion: AI_CONTRACT_VERSION, value: 'x' }, [bump(2)])
  assert.ok(isCurrent(r))
  assert.equal(r.upgraded, false)
})
