// 「내 것」의 범위 판정
//
// **실제 사고**(사용자 지적 2026-09-22): 「아무계정이나 들어가도 동일한 목록이 나오고 있음」.
// 목록이 담당자를 아예 안 봤다. 고치는 길에 함정이 둘 있다 —
// ① 조직도는 **호스트 사용자 id** 를 주는데 담당자 칸은 **멤버 id** 라 그냥 넣으면 0건이 된다
// ② 조직도를 못 읽었을 때 전체로 기울면, 조직도가 잠깐 비는 순간 모두가 모든 것을 본다.
// 여기서 지키는 것은 그 둘이다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decideMyScope, activeTab, scopeOfTab, listTabs, listActiveTab, listScopeOf,
} from './my-scope-decide.ts'

const ME = { memberId: 'me', hostUserId: 'u-me', active: true }
const YOU = { memberId: 'you', hostUserId: 'u-you', active: true }
const GONE = { memberId: 'gone', hostUserId: 'u-gone', active: false }

test('전사 범위면 제한이 없고 전체 탭이 생긴다', () => {
  const my = decideMyScope({ myMemberId: 'me', members: [ME, YOU], reach: 'all' })

  assert.deepEqual(my.tabs, ['mine', 'all'])
  assert.equal(my.reachable.ownerMemberIds, null, '전사인데 목록으로 좁혔다')
  assert.deepEqual(my.mine.ownerMemberIds, ['me'])
})

test('부서 범위는 호스트 사용자 id 를 멤버 id 로 바꿔 돌려준다', () => {
  const my = decideMyScope({
    myMemberId: 'me', members: [ME, YOU], reach: ['u-me', 'u-you'],
  })

  assert.deepEqual(my.tabs, ['mine', 'dept'])
  // 사고의 핵심: 여기에 'u-me' 가 들어가면 담당자 조건이 아무것도 안 맞아 목록이 빈다
  assert.deepEqual(my.reachable.ownerMemberIds, ['me', 'you'])
})

test('나간 사람은 범위에 안 든다', () => {
  const my = decideMyScope({
    myMemberId: 'me', members: [ME, GONE], reach: ['u-me', 'u-gone'],
  })

  assert.deepEqual(my.tabs, ['mine'], '나간 사람만 더 걸리는데 부서 탭을 그렸다')
  assert.deepEqual(my.reachable.ownerMemberIds, ['me'])
})

test('나 말고 걸리는 사람이 없으면 탭을 하나만 준다', () => {
  const my = decideMyScope({ myMemberId: 'me', members: [ME, YOU], reach: ['u-me'] })

  assert.deepEqual(my.tabs, ['mine'])
  assert.deepEqual(my.reachable.ownerMemberIds, ['me'])
})

test('조직도를 못 읽으면 내 것만 본다 — 실패가 전체 공개로 기울지 않는다', () => {
  const my = decideMyScope({ myMemberId: 'me', members: [ME, YOU], reach: null })

  assert.deepEqual(my.tabs, ['mine'])
  assert.deepEqual(my.reachable.ownerMemberIds, ['me'], '조직도가 비었는데 남의 것을 열었다')
})

test('주소에 손으로 적어 넣은 탭으로는 범위가 안 넓어진다', () => {
  const narrow = decideMyScope({ myMemberId: 'me', members: [ME], reach: ['u-me'] })

  assert.equal(activeTab(narrow, 'all'), 'mine')
  assert.equal(activeTab(narrow, 'dept'), 'mine')
  assert.equal(activeTab(narrow, '../../etc'), 'mine')
  assert.deepEqual(scopeOfTab(narrow, 'all').ownerMemberIds, ['me'])
})

test('열 수 있는 탭이면 그 범위를 준다', () => {
  const wide = decideMyScope({ myMemberId: 'me', members: [ME, YOU], reach: 'all' })

  assert.equal(activeTab(wide, 'all'), 'all')
  assert.equal(scopeOfTab(wide, 'all').ownerMemberIds, null)
  // 기본은 언제나 내 담당이다
  assert.equal(activeTab(wide, null), 'mine')
  assert.deepEqual(scopeOfTab(wide, undefined).ownerMemberIds, ['me'])
})

test('관리자는 조직도와 무관하게 전사로 본다', () => {
  // 실측 2026-09-23: CRM 소유자가 조직도에서는 한 부서의 장이라,
  // 조직도만 보면 **소유자가 자기 부서 밖을 못 본다**
  const my = decideMyScope({
    myMemberId: 'me', members: [ME, YOU], reach: ['u-me'], admin: true,
  })

  assert.deepEqual(my.tabs, ['mine', 'all'])
  assert.equal(my.reachable.ownerMemberIds, null)
  // 그래도 기본은 내 담당이다 — 관리자라고 남의 일부터 보여 주지 않는다
  assert.deepEqual(scopeOfTab(my, null).ownerMemberIds, ['me'])
})

test('관리자여도 조직도를 못 읽는 것과는 별개다 — 관리자면 전사, 아니면 내 것', () => {
  assert.deepEqual(
    decideMyScope({ myMemberId: 'me', members: [ME], reach: null, admin: true }).tabs,
    ['mine', 'all'],
  )
  assert.deepEqual(
    decideMyScope({ myMemberId: 'me', members: [ME], reach: null, admin: false }).tabs,
    ['mine'],
  )
})

// ── 목록의 탭은 오늘 화면과 다르다 ───────────────────────────
//
// 오늘 화면은 「지금 손댈 것」이라 남의 것을 안 보여도 손해가 없다.
// 목록은 **원래 다 보이던 자리**다 — 여기서 전체를 감추면 기본값을 바꾸는 것이 아니라
// 있던 접근을 뺏는 것이다.

test('목록에서는 전체 탭이 범위가 좁은 사람에게도 보인다', () => {
  const narrow = decideMyScope({ myMemberId: 'me', members: [ME], reach: ['u-me'] })

  assert.deepEqual(narrow.tabs, ['mine'], '오늘 화면에서는 나 하나')
  assert.deepEqual(listTabs(narrow), ['mine', 'all'], '목록에서는 전체가 있어야 한다')
  assert.equal(listScopeOf(narrow, 'all').ownerMemberIds, null)
})

test('목록의 기본도 내 담당이다', () => {
  const narrow = decideMyScope({ myMemberId: 'me', members: [ME], reach: ['u-me'] })

  assert.equal(listActiveTab(narrow, null), 'mine')
  assert.deepEqual(listScopeOf(narrow, undefined).ownerMemberIds, ['me'])
  assert.deepEqual(listScopeOf(narrow, '없는탭').ownerMemberIds, ['me'])
})

test('부서 탭은 부서가 있는 사람에게만, 전체는 모두에게', () => {
  const dept = decideMyScope({ myMemberId: 'me', members: [ME, YOU], reach: ['u-me', 'u-you'] })

  assert.deepEqual(listTabs(dept), ['mine', 'dept', 'all'])
  assert.deepEqual(listScopeOf(dept, 'dept').ownerMemberIds, ['me', 'you'])
  assert.equal(listScopeOf(dept, 'all').ownerMemberIds, null)
})

test('관리자는 전체 탭이 두 번 생기지 않는다', () => {
  const admin = decideMyScope({ myMemberId: 'me', members: [ME], reach: null, admin: true })

  assert.deepEqual(listTabs(admin), ['mine', 'all'])
})
