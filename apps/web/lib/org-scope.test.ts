import { test } from 'node:test'
import assert from 'node:assert/strict'
// 순수 로직·타입은 org-scope-pure(SSOT, server-only 비의존)에서 테스트한다.
// org-scope.ts는 'server-only'를 import하므로 node 테스트 러너에서 해석 불가 — pure 모듈이 테스트 진입점.
import { deptMemberUserIds, type OrgScope } from './org-scope-pure.ts'

// 조직도: 회사 > AX사업본부(head=본부장) > 팀(head=팀장, person=팀원)
// 부서장(본부장·팀장)은 person 노드가 아니라 head_user_id로만 연결된다.
function makeScope(): OrgScope {
  return {
    editableDeptIds: [],
    readableDeptIds: [],
    isExecutive: false,
    scopeRootIds: [],
    nodes: [
      { id: 'co', type: 'company', parent_id: null, head_user_id: 'ceo', user_id: null, name: '회사' },
      { id: 'ax', type: 'department', parent_id: 'co', head_user_id: 'head-ax', user_id: null, name: 'AX사업본부' },
      { id: 'team', type: 'department', parent_id: 'ax', head_user_id: 'lead-team', user_id: null, name: '팀' },
      { id: 'p1', type: 'person', parent_id: 'team', head_user_id: null, user_id: 'member-1', name: '팀원1' },
    ],
    closure: [
      { ancestor_id: 'ax', descendant_id: 'team', depth: 1 },
      { ancestor_id: 'ax', descendant_id: 'p1', depth: 2 },
      { ancestor_id: 'team', descendant_id: 'p1', depth: 1 },
    ],
  }
}

test('deptMemberUserIds: 부서장(head_user_id)을 취합 대상에 포함한다', () => {
  const ids = deptMemberUserIds(makeScope(), 'ax')
  // AX본부장 + 하위 팀장 + 팀원 모두 포함
  assert.ok(ids.includes('head-ax'), '본부장(head-ax) 누락')
  assert.ok(ids.includes('lead-team'), '팀장(lead-team) 누락')
  assert.ok(ids.includes('member-1'), '팀원(member-1) 누락')
})

test('deptMemberUserIds: 중복 없이 반환한다', () => {
  const ids = deptMemberUserIds(makeScope(), 'ax')
  assert.equal(ids.length, new Set(ids).size, '중복 user_id 존재')
})

test('deptMemberUserIds: 하위 팀 선택 시 그 팀장+팀원만, 상위 본부장 제외', () => {
  const ids = deptMemberUserIds(makeScope(), 'team')
  assert.ok(ids.includes('lead-team'))
  assert.ok(ids.includes('member-1'))
  assert.ok(!ids.includes('head-ax'), '상위 본부장이 하위 팀 취합에 잘못 포함됨')
})
