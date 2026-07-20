import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeptAggStats } from './dept-agg-core.ts'

const NODES = [{ id: 'd1', name: '개발' }, { id: 'd2', name: '영업' }, { id: 'd3', name: '빈부서' }]

test('buildDeptAggStats: 제출 카운트·취합상태 집계', () => {
  const stats = buildDeptAggStats(
    NODES,
    { d1: ['u1', 'u2', 'u3'], d2: ['u4', 'u5'], d3: [] },
    new Set(['u1', 'u2', 'u4']),
    { d1: 'confirmed', d2: 'draft' },
  )
  assert.deepEqual(stats[0], { id: 'd1', name: '개발', memberCount: 3, reportedCount: 2, agg: 'confirmed' })
  assert.deepEqual(stats[1], { id: 'd2', name: '영업', memberCount: 2, reportedCount: 1, agg: 'draft' })
})

test('buildDeptAggStats: 멤버 0 부서 → 0/0, 취합 none', () => {
  const stats = buildDeptAggStats(NODES, { d1: [], d2: [], d3: [] }, new Set(), {})
  assert.equal(stats[2].memberCount, 0)
  assert.equal(stats[2].reportedCount, 0)
  assert.equal(stats[2].agg, 'none')
})

test('buildDeptAggStats: reporters 비었으면 전부 0 제출', () => {
  const stats = buildDeptAggStats(NODES, { d1: ['u1'], d2: ['u2'], d3: [] }, new Set(), { d1: 'draft' })
  assert.equal(stats[0].reportedCount, 0)
  assert.equal(stats[0].agg, 'draft')
})

test('buildDeptAggStats: statusByDept 없는 부서 → none', () => {
  const stats = buildDeptAggStats([{ id: 'd1', name: 'X' }], { d1: ['u1'] }, new Set(['u1']), {})
  assert.equal(stats[0].agg, 'none')
  assert.equal(stats[0].reportedCount, 1)
})
