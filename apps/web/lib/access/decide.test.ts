// lib/access/decide.test.ts — 판정 순서와 기본값이 지금과 같은 결과를 내는지
//
// 이 시험이 지키는 것 둘
//   ① 순서 — 관리자·차단·사람·조직·기본값. 순서가 규칙의 전부라 한 줄씩 단정한다
//   ② 기본값 — 등재부가 지금의 메뉴 표보다 **무를 수 없다**. 엄한 자리는 이유를 적어야 한다

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decideAccess, type Grant, type Viewer } from './decide.ts'
import { SURFACES, surfaceOf, surfaceByKey, zoneKeyOf, zoneOf, grantableKeys } from './surfaces.ts'
import { NAV_AUDIENCE, ADMIN_ONLY_GROUPS } from '../nav/menu.ts'

const ADMIN: Viewer = { userId: 'u-admin', isAdmin: true, orgIds: [] }
const MEMBER: Viewer = { userId: 'u-1', isAdmin: false, orgIds: ['org-sales'] }

/** 기본값이 「관리자」인 표면 하나 — 부여가 없으면 일반 사용자가 못 들어간다 */
const CLOSED = 'crm'
/** 기본값이 「전부」인 표면 하나 */
const OPEN = 'home'

const userGrant = (effect: Grant['effect'], surfaceKey = CLOSED): Grant =>
  ({ surfaceKey, subject: { kind: 'user', id: MEMBER.userId }, effect })
const orgGrant = (effect: Grant['effect'], surfaceKey = CLOSED): Grant =>
  ({ surfaceKey, subject: { kind: 'org', id: 'org-sales' }, effect })

// ① 순서

test('1 관리자는 막음이 있어도 통과한다', () => {
  const d = decideAccess(CLOSED, ADMIN, [
    { surfaceKey: CLOSED, subject: { kind: 'user', id: ADMIN.userId }, effect: 'deny' },
  ])
  assert.deepEqual(d, { allowed: true, reason: 'admin' })
})

test('2 차단은 사람 열기와 조직 열기를 모두 이긴다', () => {
  const d = decideAccess(CLOSED, MEMBER, [userGrant('allow'), orgGrant('allow'), orgGrant('deny')])
  assert.deepEqual(d, { allowed: false, reason: 'denied' })
})

test('3 사람 열기는 조직보다 먼저 답한다', () => {
  const d = decideAccess(CLOSED, MEMBER, [orgGrant('allow'), userGrant('allow')])
  assert.deepEqual(d, { allowed: true, reason: 'user' })
})

test('4 사람 부여가 없으면 조직 열기가 답한다', () => {
  const d = decideAccess(CLOSED, MEMBER, [orgGrant('allow')])
  assert.deepEqual(d, { allowed: true, reason: 'org' })
})

test('5 부여가 0건이면 등재부 기본값이 답한다', () => {
  assert.deepEqual(decideAccess(CLOSED, MEMBER, []), { allowed: false, reason: 'default' })
  assert.deepEqual(decideAccess(OPEN, MEMBER, []), { allowed: true, reason: 'default' })
})

test('남의 부여는 나에게 안 걸린다', () => {
  const others: Grant[] = [
    { surfaceKey: CLOSED, subject: { kind: 'user', id: 'u-2' }, effect: 'allow' },
    { surfaceKey: CLOSED, subject: { kind: 'org', id: 'org-other' }, effect: 'allow' },
  ]
  assert.deepEqual(decideAccess(CLOSED, MEMBER, others), { allowed: false, reason: 'default' })
})

test('다른 표면에 준 부여가 이 표면을 열지 않는다', () => {
  assert.deepEqual(
    decideAccess(CLOSED, MEMBER, [userGrant('allow', 'ci')]),
    { allowed: false, reason: 'default' },
  )
})

test('등재 안 된 표면은 막는다 — 등재를 잊으면 안 보여야 알 수 있다', () => {
  assert.deepEqual(decideAccess('없는표면', MEMBER, []), { allowed: false, reason: 'unregistered' })
})

// ② 등재부

test('키와 주소에 중복이 없다', () => {
  const keys = SURFACES.map((s) => s.key)
  const hrefs = SURFACES.map((s) => s.href)
  assert.equal(new Set(keys).size, keys.length, '표면 키 중복')
  assert.equal(new Set(hrefs).size, hrefs.length, '표면 주소 중복')
})

test('주소는 긴 쪽이 이긴다 — /pricing 아래 둘이 안 섞인다', () => {
  assert.equal(surfaceOf('/pricing/gpu')?.key, 'pricing.gpu')
  assert.equal(surfaceOf('/pricing/catalog?tab=intake'.split('?')[0])?.key, 'pricing.catalog')
  assert.equal(surfaceOf('/crm/deals/123')?.key, 'crm')
  assert.equal(surfaceOf('/login'), null)
})

test('surfaceByKey 와 surfaceOf 가 같은 줄을 가리킨다', () => {
  for (const s of SURFACES) {
    assert.equal(surfaceByKey(s.key), s, `${s.key} 키 조회`)
    assert.equal(surfaceOf(s.href), s, `${s.href} 주소 조회`)
  }
})

/**
 * 지금 메뉴 표가 내는 답. `NAV_AUDIENCE` 는 항목 하나를, `ADMIN_ONLY_GROUPS` 는 묶음을 본다.
 */
function legacyAudience(href: string, group: string): 'all' | 'admin' {
  if (NAV_AUDIENCE[href] === 'admin') return 'admin'
  if (ADMIN_ONLY_GROUPS.has(group)) return 'admin'
  return 'all'
}

test('등재부 기본값이 메뉴 표보다 무르지 않다', () => {
  for (const s of SURFACES) {
    const legacy = legacyAudience(s.href, s.group)
    if (legacy === 'admin') {
      assert.equal(s.defaultAudience, 'admin', `${s.key}: 메뉴 표는 관리자 전용인데 등재부가 열려 있다`)
    }
  }
})

test('메뉴 표보다 엄한 기본값에는 지금 막는 근거가 적혀 있다', () => {
  for (const s of SURFACES) {
    if (legacyAudience(s.href, s.group) === 'all' && s.defaultAudience === 'admin') {
      assert.ok(
        s.gatedToday && s.gatedToday.length > 0,
        `${s.key}: 메뉴 표는 전부인데 관리자로 좁혔다, gatedToday 에 근거를 적어야 한다`,
      )
    }
  }
})

test('메뉴 표가 이름 대고 막던 자리가 그대로 막혀 있다', () => {
  // NAV_AUDIENCE 가 admin 이라고 적은 경로
  for (const [href, audience] of Object.entries(NAV_AUDIENCE)) {
    if (audience !== 'admin') continue
    const s = surfaceOf(href)
    assert.ok(s, `${href} 가 등재부에 없다`)
    assert.equal(s.defaultAudience, 'admin', `${href} 기본값이 풀렸다`)
    assert.equal(decideAccess(s.key, MEMBER, []).allowed, false)
  }
  // ADMIN_ONLY_GROUPS 가 통째로 막던 묶음
  const grouped = SURFACES.filter((s) => ADMIN_ONLY_GROUPS.has(s.group))
  assert.ok(grouped.length > 0, 'ADMIN_ONLY_GROUPS 에 해당하는 표면이 하나도 없다')
  for (const s of grouped) {
    assert.equal(decideAccess(s.key, MEMBER, []).allowed, false, `${s.key} 기본값이 풀렸다`)
  }
})

test('관리자는 등재부 전체를 부여 없이 통과한다', () => {
  for (const s of SURFACES) {
    assert.equal(decideAccess(s.key, ADMIN, []).allowed, true, `${s.key}`)
  }
})

// ③ 구역 — 표면 안의 더 작은 자리 (I09)
//
// 왜 시험이 필요한가: 구역을 넣으면서 가장 쉽게 깨지는 것이 **안 건드린 자리**다.
//   구역 부여가 하나 생겼다고 표면 부여가 무시되면, 관리자는 표면을 열어 뒀는데
//   사용자에게는 닫혀 보인다. 그래서 «내려간다»를 한 줄씩 단정한다.

test('하위 경로는 등재부를 안 보고 구역 키가 된다', () => {
  assert.equal(zoneKeyOf('/work/activity'), 'work:activity')
  // 더 깊은 자리는 그 위 구역에 속한다 — 상세는 목록과 같은 자리다
  assert.equal(zoneKeyOf('/work/projects/123'), 'work:projects')
  // 표면 자체는 구역이 아니다
  assert.equal(zoneKeyOf('/work'), null)
  // 등재 안 된 조각도 키는 나온다 — 판정은 되고 부여만 없다
  assert.equal(zoneKeyOf('/work/무엇이든'), 'work:무엇이든')
  // 표면이 아닌 주소는 구역도 아니다
  assert.equal(zoneKeyOf('/없는표면/자리'), null)
})

test('경로가 아닌 탭은 등재부에 적힌 것만 구역이 된다', () => {
  // 주소가 같으니 주소로는 못 찾는다 — 못 찾는다는 사실 자체를 단정한다
  assert.equal(zoneKeyOf('/pricing/gpu'), null)
  // 등재된 구역만 zoneOf 로 찾힌다
  assert.equal(zoneOf('work:activity')?.zone.label, '이력')
  assert.equal(zoneOf('work:없는구역'), null)
  // 탭 구역을 적으면 tab 값이 함께 있어야 부르는 쪽이 넘길 수 있다
  for (const s of SURFACES) {
    for (const z of s.zones ?? []) {
      assert.ok(z.label.length > 0, `${s.key}:${z.name} 구역에 이름이 없다`)
    }
  }
})

test('구역을 안 건드린 부여는 표면 값이 그대로 내려간다', () => {
  const ZONE = 'work:activity'
  // 표면에 차단을 걸면 자리도 막힌다
  assert.equal(decideAccess(ZONE, MEMBER, [userGrant('deny', 'work')]).allowed, false)
  // 표면에 아무것도 없으면 표면 기본값(work = 전부)이 내려온다
  assert.equal(decideAccess(ZONE, MEMBER, []).allowed, true)
  assert.equal(decideAccess(ZONE, MEMBER, []).reason, 'default')
  // 다른 구역에 건 부여는 이 구역에 안 닿는다
  assert.equal(decideAccess(ZONE, MEMBER, [userGrant('deny', 'work:projects')]).allowed, true)
})

test('구역 하나를 막아도 같은 표면의 다른 자리는 열려 있다', () => {
  const grants = [userGrant('deny', 'work:activity')]
  assert.equal(decideAccess('work:activity', MEMBER, grants).allowed, false)
  assert.equal(decideAccess('work:projects', MEMBER, grants).allowed, true)
  assert.equal(decideAccess('work', MEMBER, grants).allowed, true)
})

test('좁은 자리가 넓은 자리를 이긴다 — 표면을 막아도 구역을 열면 열린다', () => {
  const grants = [userGrant('deny', 'work'), userGrant('allow', 'work:activity')]
  assert.equal(decideAccess('work:activity', MEMBER, grants).allowed, true)
  assert.equal(decideAccess('work:projects', MEMBER, grants).allowed, false)
})

test('관리자는 자리 차단도 통과한다', () => {
  assert.equal(decideAccess('work:activity', ADMIN, [userGrant('deny', 'work:activity')]).allowed, true)
})

test('부여할 수 있는 키는 표면과 등재된 구역뿐이다', () => {
  const keys = grantableKeys()
  for (const s of SURFACES) assert.ok(keys.includes(s.key), `${s.key} 가 빠졌다`)
  assert.ok(keys.includes('work:activity'))
  assert.ok(!keys.includes('work:없는구역'))
  // 중복이 있으면 동기화가 같은 행을 두 번 쓴다
  assert.equal(new Set(keys).size, keys.length, '부여 키가 겹친다')
})
