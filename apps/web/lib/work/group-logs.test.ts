import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupLogsByEntity, engagementDistribution, type GroupLogInput } from './group-logs.ts'

const L = (id: string, entityId: string | null, entry: any = 'done'): GroupLogInput => ({ id, content: 'c' + id, entry_type: entry, entityId })

test('groupLogsByEntity: 엔티티별 그룹 + 미링크 카운트', () => {
  const r = groupLogsByEntity([L('1', 'a'), L('2', 'a', 'doing'), L('3', 'b'), L('4', null)])
  assert.equal(r.ungrouped, 1)
  assert.equal(r.groups.length, 2)
  const a = r.groups.find((g) => g.id === 'a')!
  assert.equal(a.count, 2)
  assert.equal(a.statusCounts.done, 1)
  assert.equal(a.statusCounts.doing, 1)
})

test('groupLogsByEntity: count 내림차순 정렬', () => {
  const r = groupLogsByEntity([L('1', 'b'), L('2', 'a'), L('3', 'a'), L('4', 'a')])
  assert.equal(r.groups[0].id, 'a')
  assert.equal(r.groups[0].count, 3)
})

test('groupLogsByEntity: recent 최대 N', () => {
  const logs = Array.from({ length: 8 }, (_, i) => L(String(i), 'a'))
  const r = groupLogsByEntity(logs, 3)
  assert.equal(r.groups[0].recent.length, 3)
})

test('engagementDistribution: Top N + 기타', () => {
  const { groups } = groupLogsByEntity([
    ...Array.from({ length: 5 }, (_, i) => L('x' + i, 'a')),
    ...Array.from({ length: 3 }, (_, i) => L('y' + i, 'b')),
    L('z', 'c'), L('w', 'd'), L('v', 'e'), L('u', 'f'),
  ])
  const dist = engagementDistribution(groups, 3)
  assert.equal(dist[dist.length - 1].id, '__etc__')
  assert.ok(dist.length <= 4)
})
