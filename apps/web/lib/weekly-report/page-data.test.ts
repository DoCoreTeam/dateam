import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapTeamReports, buildHistoryGroups, type TeamRawRow } from './page-data.ts'

const row = (o: Partial<TeamRawRow> & { user_id: string }): TeamRawRow => ({
  category: 'c', performance: 'p', plan: 'pl', issues: 'i', week_start: '2026-07-13', ...o,
})

test('mapTeamReports: admin을 최상위로 정렬 + 이름 폴백', () => {
  const out = mapTeamReports([
    row({ user_id: 'u1', profiles: { name: '멤버', role: 'member' } }),
    row({ user_id: 'u2', profiles: { name: '본부장', role: 'admin' } }),
    row({ user_id: 'u3', profiles: null }),
  ])
  assert.equal(out[0].role, 'admin')
  assert.equal(out[0].userName, '본부장')
  assert.equal(out[2].userName, '알 수 없음')
  assert.equal(out[2].role, 'member')
})

test('mapTeamReports: null → 빈 배열', () => {
  assert.deepEqual(mapTeamReports(null), [])
})

test('buildHistoryGroups: 주차별 그룹 + 이번주 제외', () => {
  const groups = buildHistoryGroups(
    [
      { week_start: '2026-07-13', v: 1 },
      { week_start: '2026-07-06', v: 2 },
      { week_start: '2026-07-06', v: 3 },
    ],
    '2026-07-13',
  )
  assert.equal(groups.length, 1)
  assert.equal(groups[0].weekStart, '2026-07-06')
  assert.equal(groups[0].reports.length, 2)
})

test('buildHistoryGroups: null → 빈 배열', () => {
  assert.deepEqual(buildHistoryGroups(null, '2026-07-13'), [])
})
