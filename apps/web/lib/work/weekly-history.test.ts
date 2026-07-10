import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveWeeklyBeforeAfter } from './weekly-history.ts'

test('활동 before=직전 스냅샷, after=다음 활동의 스냅샷', () => {
  const acts = [
    { id: 'A2', occurredAt: '2026-07-10T02:00:00Z' },
    { id: 'A1', occurredAt: '2026-07-10T01:00:00Z' },
  ]
  const snaps = [
    { takenAt: '2026-07-10T00:59:59Z', rows: [{ category: '개발', seq: 0, performance: 'v1' }] }, // A1 before
    { takenAt: '2026-07-10T01:59:59Z', rows: [{ category: '개발', seq: 0, performance: 'v2' }] }, // A2 before = A1 after
  ]
  const live = [{ category: '개발', seq: 0, performance: 'v3' }]
  const r = resolveWeeklyBeforeAfter(acts, snaps, live)
  // A1: before=v1, after=A2의 before(v2)
  assert.equal((r.get('A1')!.before[0] as { performance: string }).performance, 'v1')
  assert.equal((r.get('A1')!.after[0] as { performance: string }).performance, 'v2')
  // A2(최신): before=v2, after=live(v3)
  assert.equal((r.get('A2')!.before[0] as { performance: string }).performance, 'v2')
  assert.equal((r.get('A2')!.after[0] as { performance: string }).performance, 'v3')
})

test('스냅샷 없는 과거 활동은 before=[] (소급 불가)', () => {
  const acts = [{ id: 'A1', occurredAt: '2026-07-01T01:00:00Z' }]
  const snaps = [{ takenAt: '2026-07-06T05:00:00Z', rows: [{ category: '개발' }] }] // 활동보다 나중(시드)
  const live = [{ category: '개발', performance: 'now' }]
  const r = resolveWeeklyBeforeAfter(acts, snaps, live)
  assert.deepEqual(r.get('A1')!.before, [])
  // 최신 활동이므로 after=live
  assert.equal((r.get('A1')!.after[0] as { performance: string }).performance, 'now')
})

test('활동 없으면 빈 맵', () => {
  assert.equal(resolveWeeklyBeforeAfter([], [], []).size, 0)
})
