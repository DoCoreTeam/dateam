// lib/access/load.test.ts — 부여를 읽는 자리
//
// 잠그는 것 넷
//   ① 부여가 0건이면 판정이 표면 기본값만 쓴다 = **I04 직후의 사이드바와 같다**
//   ② 조직 부여가 하위로 내려가고, 끄면 안 내려간다
//   ③ 남의 부여·모르는 값이 나에게 안 걸린다
//   ④ 한 번 부를 때 부여 조회가 **정확히 1회**이고, 내보내는 함수가 요청 캐시로 싸여 있다
//
// `load.ts` 는 `lib/supabase/server`(server-only)를 부르므로 여기서 import 하지 않는다 —
// 순수한 부분은 `load-pure.ts` 에서 재고, 캐시 여부는 소스를 읽어서 본다(org-scope 와 같은 관례).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  appliesToMe, toGrants, collectViewerAccess,
  type AccessSource, type GrantRow, type OrgMembership,
} from './load-pure.ts'
import { decideAccess } from './decide.ts'
import { SIDEBAR_TOP_LINKS, SIDEBAR_GROUP_LINKS, ADMIN_ONLY_GROUPS, canSeeNav } from '../nav/menu.ts'
import { surfaceOf } from './surfaces.ts'

const ME = 'u-me'
const TEAM = 'org-team'
const DIVISION = 'org-division'
const ORG: OrgMembership = { direct: [TEAM], withAncestors: [TEAM, DIVISION] }

const row = (over: Partial<GrantRow> = {}): GrantRow => ({
  surface_key: 'crm',
  subject_kind: 'org',
  subject_id: DIVISION,
  effect: 'allow',
  include_descendants: true,
  ...over,
})

// ① 부여 0건이면 지금과 같다

test('★ 부여가 0건이면 사이드바가 I04 직후와 같다 — 관리자', () => {
  const viewer = { userId: ME, isAdmin: true, orgIds: [] }
  const groups = SIDEBAR_GROUP_LINKS
    .filter((g) => !(g.key && ADMIN_ONLY_GROUPS.has(g.key)) || viewer.isAdmin)
    .map((g) => ({
      key: g.key,
      items: g.items.filter((i) => decideAccess(surfaceOf(i.href)!.key, viewer, []).allowed).map((i) => i.href),
    }))
  assert.deepEqual(groups, [
    { key: 'service', items: ['/crm', '/ci', '/ai', '/rfp'] },
    { key: 'pricing', items: ['/pricing/gpu', '/pricing/catalog'] },
  ])
  assert.deepEqual(
    SIDEBAR_TOP_LINKS.filter((i) => decideAccess(surfaceOf(i.href)!.key, viewer, []).allowed).map((i) => i.href),
    ['/home', '/work', '/calendar', '/meeting-notes', '/org'],
  )
})

test('★ 부여가 0건이면 사이드바가 I04 직후와 같다 — 일반 사용자', () => {
  const viewer = { userId: ME, isAdmin: false, orgIds: [] }
  const groups = SIDEBAR_GROUP_LINKS
    .filter((g) => !(g.key && ADMIN_ONLY_GROUPS.has(g.key)))
    .map((g) => ({
      key: g.key,
      items: g.items.filter((i) => decideAccess(surfaceOf(i.href)!.key, viewer, []).allowed).map((i) => i.href),
    }))
    .filter((g) => g.items.length > 0)
  // 지금 일반 사용자가 보는 것 그대로 — 「서비스」 묶음이 통째로 빠지고 가격정책만 남는다
  assert.deepEqual(groups, [{ key: 'pricing', items: ['/pricing/gpu', '/pricing/catalog'] }])
  assert.deepEqual(
    SIDEBAR_TOP_LINKS.filter((i) => decideAccess(surfaceOf(i.href)!.key, viewer, []).allowed).map((i) => i.href),
    ['/home', '/work', '/calendar', '/meeting-notes', '/org'],
  )
  // 지금 쓰는 표(canSeeNav)와도 답이 갈리지 않는다
  for (const link of SIDEBAR_TOP_LINKS) {
    assert.equal(
      decideAccess(surfaceOf(link.href)!.key, viewer, []).allowed,
      canSeeNav(link.href, false),
      `${link.href} 에서 새 판정과 옛 표가 갈렸다`,
    )
  }
})

// ② 조직 부여가 내려가는 범위

test('하위 포함이 켜져 있으면 본부 부여가 팀원에게 내려온다', () => {
  assert.equal(appliesToMe(row({ subject_id: DIVISION, include_descendants: true }), ME, ORG), true)
})

test('하위 포함을 끄면 본부 부여가 팀원에게 안 내려온다', () => {
  assert.equal(appliesToMe(row({ subject_id: DIVISION, include_descendants: false }), ME, ORG), false)
  // 직접 소속인 팀에는 끄든 켜든 걸린다
  assert.equal(appliesToMe(row({ subject_id: TEAM, include_descendants: false }), ME, ORG), true)
})

// ③ 남의 것과 모르는 값

test('남의 부여는 나에게 안 걸린다', () => {
  assert.equal(appliesToMe(row({ subject_kind: 'user', subject_id: 'u-other' }), ME, ORG), false)
  assert.equal(appliesToMe(row({ subject_id: 'org-other' }), ME, ORG), false)
  assert.equal(appliesToMe(row({ subject_kind: 'user', subject_id: ME }), ME, ORG), true)
})

test('모르는 주체 종류와 모르는 효과는 걸러진다 — 조용히 문을 열지 않는다', () => {
  assert.equal(appliesToMe(row({ subject_kind: 'role', subject_id: 'member' }), ME, ORG), false)
  assert.deepEqual(toGrants([row({ effect: 'maybe' })], ME, ORG), [])
})

test('걸린 줄만 판정이 읽는 꼴로 바뀐다', () => {
  const rows = [
    row({ surface_key: 'crm', subject_kind: 'user', subject_id: ME, effect: 'allow' }),
    row({ surface_key: 'ci', subject_id: DIVISION, effect: 'deny' }),
    row({ surface_key: 'ai', subject_kind: 'user', subject_id: 'u-other' }),
  ]
  assert.deepEqual(toGrants(rows, ME, ORG), [
    { surfaceKey: 'crm', subject: { kind: 'user', id: ME }, effect: 'allow' },
    { surfaceKey: 'ci', subject: { kind: 'org', id: DIVISION }, effect: 'deny' },
  ])
})

test('모은 결과가 판정 함수와 그대로 맞물린다 — 부여받은 표면만 열린다', async () => {
  const source: AccessSource = {
    async myOrgs() { return ORG },
    async rows() { return [row({ surface_key: 'crm', subject_id: DIVISION, effect: 'allow' })] },
  }
  const { viewer, grants } = await collectViewerAccess(ME, false, source)
  assert.equal(decideAccess('crm', viewer, grants).allowed, true)
  assert.equal(decideAccess('crm', viewer, grants).reason, 'org')
  assert.equal(decideAccess('ci', viewer, grants).allowed, false)
})

// ④ 왕복 수와 요청 캐시

test('★ 한 번 부를 때 부여 조회가 정확히 1회다', async () => {
  let orgCalls = 0
  let rowCalls = 0
  let askedWith: readonly string[] = []
  const source: AccessSource = {
    async myOrgs() { orgCalls++; return ORG },
    async rows(ids) { rowCalls++; askedWith = ids; return [] },
  }
  await collectViewerAccess(ME, false, source)
  assert.equal(rowCalls, 1, '부여 조회가 1회가 아니다')
  assert.equal(orgCalls, 1, '조직 조회가 1회가 아니다')
  // 나와 내 조직을 한 번에 물어본다 — 주체마다 한 번씩 물으면 부서 수만큼 왕복이 는다
  assert.deepEqual([...askedWith], [ME, TEAM, DIVISION])
})

test('★ 내보내는 함수가 요청 캐시로 싸여 있다 — 화면마다 다시 묻지 않는다', () => {
  const src = readFileSync(join(import.meta.dirname, 'load.ts'), 'utf8')
  assert.match(
    src, /export const loadViewerAccess = cache\(/,
    'loadViewerAccess 가 cache() 밖에 있다 — 한 화면에서 여러 번 물어보게 된다(lib/auth/request-profile.ts 와 같은 장치를 쓴다)',
  )
  assert.match(src, /import \{ cache \} from 'react'/)
  // 조회 실패가 「전부 열림」으로 떨어지면 안 된다 — 빈 부여로 떨어져야 기본값만 남는다
  assert.match(src, /grants: \[\]/, '조회 실패 시 빈 부여로 떨어지는 자리가 없다')
})
