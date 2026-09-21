import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveWeeklyBeforeAfter } from './weekly-history.ts'

test('활동 before=직전 스냅샷, after=다음 활동의 스냅샷', () => {
  const acts = [
    { id: 'A2', occurredAt: '2026-07-10T02:00:00Z' },
    { id: 'A1', occurredAt: '2026-07-10T01:00:00Z' },
  ]
  const snaps = [
    { id: 's1', takenAt: '2026-07-10T00:59:59Z', rows: [{ category: '개발', seq: 0, performance: 'v1' }] }, // A1 before
    { id: 's2', takenAt: '2026-07-10T01:59:59Z', rows: [{ category: '개발', seq: 0, performance: 'v2' }] }, // A2 before = A1 after
  ]
  const live = [{ category: '개발', seq: 0, performance: 'v3' }]
  const r = resolveWeeklyBeforeAfter(acts, snaps, live)
  // A1: before=v1(s1), after=A2의 before(v2)
  assert.equal((r.get('A1')!.before[0] as { performance: string }).performance, 'v1')
  assert.equal((r.get('A1')!.after[0] as { performance: string }).performance, 'v2')
  assert.equal(r.get('A1')!.beforeSnapshotId, 's1')
  // A2(최신): before=v2(s2), after=live(v3)
  assert.equal((r.get('A2')!.before[0] as { performance: string }).performance, 'v2')
  assert.equal((r.get('A2')!.after[0] as { performance: string }).performance, 'v3')
  assert.equal(r.get('A2')!.beforeSnapshotId, 's2')
})

test('스냅샷 없는 과거 활동은 before=[] (소급 불가)', () => {
  const acts = [{ id: 'A1', occurredAt: '2026-07-01T01:00:00Z' }]
  const snaps = [{ id: 's9', takenAt: '2026-07-06T05:00:00Z', rows: [{ category: '개발' }] }] // 활동보다 나중(시드)
  const live = [{ category: '개발', performance: 'now' }]
  const r = resolveWeeklyBeforeAfter(acts, snaps, live)
  assert.deepEqual(r.get('A1')!.before, [])
  assert.equal(r.get('A1')!.beforeSnapshotId, null)   // 대응 스냅샷 없음 → 되살리기 불가
  // 최신 활동이므로 after=live
  assert.equal((r.get('A1')!.after[0] as { performance: string }).performance, 'now')
})

test('활동 없으면 빈 맵', () => {
  assert.equal(resolveWeeklyBeforeAfter([], [], []).size, 0)
})

test('주차 중간 활동도 되살릴 근거(beforeSnapshotId)를 갖고, 취소될 이후 편집 수를 센다', () => {
  // 실측 재현(2026-09-14 주차): create 1 + edit 3, 스냅샷 4. 되살리려 한 건 3번째(=중간).
  const acts = [
    { id: 'A4', occurredAt: '2026-09-21T03:11:24Z' },
    { id: 'A3', occurredAt: '2026-09-21T03:08:31Z' },
    { id: 'A2', occurredAt: '2026-09-21T02:33:46Z' },
    { id: 'A1', occurredAt: '2026-09-21T01:53:37Z' },
  ]
  const snaps = [
    { id: 's1', takenAt: '2026-09-21T01:53:37Z', rows: [] },
    { id: 's2', takenAt: '2026-09-21T02:33:46Z', rows: [{ category: '사업', seq: 0, performance: 'v2' }] },
    { id: 's3', takenAt: '2026-09-21T03:08:31Z', rows: [{ category: '사업', seq: 0, performance: 'v3' }] },
    { id: 's4', takenAt: '2026-09-21T03:11:24Z', rows: [{ category: '사업', seq: 0, performance: 'v4' }] },
  ]
  const r = resolveWeeklyBeforeAfter(acts, snaps, [{ category: '사업', seq: 0, performance: 'live' }])
  // 사용자가 찍은 그 카드(A2) — 예전엔 최신이 아니라 되살리기가 안 붙었다
  assert.equal(r.get('A2')!.beforeSnapshotId, 's2')
  assert.equal(r.get('A2')!.laterEdits, 2)      // A3, A4 가 취소된다
  assert.equal(r.get('A3')!.laterEdits, 1)
  assert.equal(r.get('A4')!.laterEdits, 0)      // 최신은 취소될 것이 없다
  assert.equal(r.get('A1')!.laterEdits, 3)
})

test('페이지에 실린 것만 넘기면 취소건수가 0으로 거짓말한다(전부 넘겨야 하는 이유)', () => {
  const all = [
    { id: 'A3', occurredAt: '2026-09-21T03:00:00Z' },
    { id: 'A2', occurredAt: '2026-09-21T02:00:00Z' },
    { id: 'A1', occurredAt: '2026-09-21T01:00:00Z' },
  ]
  const snaps = [
    { id: 's1', takenAt: '2026-09-21T01:00:00Z', rows: [{ category: '사업', performance: 'v1' }] },
    { id: 's2', takenAt: '2026-09-21T02:00:00Z', rows: [{ category: '사업', performance: 'v2' }] },
    { id: 's3', takenAt: '2026-09-21T03:00:00Z', rows: [{ category: '사업', performance: 'v3' }] },
  ]
  const live = [{ category: '사업', performance: 'live' }]
  const pageOnly = resolveWeeklyBeforeAfter(all.slice(1), snaps, live)   // A3 가 다음 페이지에 있는 상황
  assert.equal(pageOnly.get('A2')!.laterEdits, 0)                        // 거짓 0건
  assert.equal((pageOnly.get('A2')!.after[0] as { performance: string }).performance, 'live')  // 거짓 after
  const full = resolveWeeklyBeforeAfter(all, snaps, live)
  assert.equal(full.get('A2')!.laterEdits, 1)
  assert.equal((full.get('A2')!.after[0] as { performance: string }).performance, 'v3')
})
