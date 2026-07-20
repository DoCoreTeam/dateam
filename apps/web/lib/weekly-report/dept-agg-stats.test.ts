import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDeptAggStats, buildCompanyRollup } from './dept-agg-core.ts'

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

test('buildCompanyRollup: 중첩 부서 멤버 중복 제거(distinct) + 제출 distinct', () => {
  // u1은 본부(d1)와 하위부서(d2)에 모두 속함 → 회사 전체는 1명으로 카운트.
  const rollup = buildCompanyRollup(
    { d1: ['u1', 'u2'], d2: ['u1'], d3: [] },
    new Set(['u1']),
    [{ agg: 'confirmed' }, { agg: 'draft' }, { agg: 'none' }],
  )
  assert.equal(rollup.totalMembers, 2) // u1,u2 (u1 중복 제거)
  assert.equal(rollup.reportedMembers, 1) // u1만 제출
  assert.equal(rollup.confirmedDepts, 1)
  assert.equal(rollup.totalDepts, 3)
})

test('buildCompanyRollup: 빈 조직 → 0', () => {
  const r = buildCompanyRollup({}, new Set(), [])
  assert.equal(r.totalMembers, 0)
  assert.equal(r.reportedMembers, 0)
  assert.equal(r.totalDepts, 0)
})
