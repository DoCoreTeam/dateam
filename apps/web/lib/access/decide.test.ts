// lib/access/decide.test.ts — 판정 순서와 기본값이 지금과 같은 결과를 내는지
//
// 이 시험이 지키는 것 둘
//   ① 순서 — 관리자·차단·사람·조직·기본값. 순서가 규칙의 전부라 한 줄씩 단정한다
//   ② 기본값 — 등재부가 지금의 메뉴 표보다 **무를 수 없다**. 엄한 자리는 이유를 적어야 한다

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decideAccess, type Grant, type Viewer } from './decide.ts'
import { SURFACES, surfaceOf, surfaceByKey, zoneKeyOf, zoneOf, grantableKeys, keyKind, parentKey } from './surfaces.ts'
import { actionKey, actionChain, splitAction, vetoesAction, PRESET_DENIES } from './actions.ts'
import { CAPABILITIES, RANGES, rangeOfScope, rangeOfPerson, deptIdsOfRange } from './capabilities.ts'
import { ALL_CAPABILITIES as CRM_CAPABILITIES, capabilitiesOf } from '../crm/security/sensitivity.ts'
import type { OrgScope } from '../org-scope-pure.ts'
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

test('부여할 수 있는 키는 표면·등재된 자리·그 둘의 동작뿐이다', () => {
  const keys = grantableKeys()
  for (const s of SURFACES) assert.ok(keys.includes(s.key), `${s.key} 가 빠졌다`)
  assert.ok(keys.includes('work:activity'))
  assert.ok(!keys.includes('work:없는구역'))
  // 동작도 행이 있어야 외래키가 선다. 「보기」는 바탕 키 자체라 따로 없다
  assert.ok(keys.includes('work#export'))
  assert.ok(keys.includes('work:activity#write'))
  assert.ok(!keys.includes('work#view'))
  // 중복이 있으면 동기화가 같은 행을 두 번 쓴다
  assert.equal(new Set(keys).size, keys.length, '부여 키가 겹친다')
})

test('키 하나가 무엇인지 화면이 안 헤아린다', () => {
  assert.equal(keyKind('work'), 'surface')
  assert.equal(keyKind('work:activity'), 'zone')
  assert.equal(keyKind('work#export'), 'action')
  assert.equal(keyKind('work:activity#export'), 'action')
  assert.equal(parentKey('work'), null)
  assert.equal(parentKey('work:activity'), 'work')
  assert.equal(parentKey('work:activity#export'), 'work:activity')
})

// ④ 동작 — 들어간 다음에 무엇까지 하나 (I10)
//
// 동작 축은 **거부권**이다. 「들어갈 수 있나」는 표면·자리 판정이나 서비스 셸이 이미 답했고,
// 여기서 그 답을 다시 하면 두 답이 갈린다. 실제로 갈릴 뻔했다 — `crm` 표면 기본값은 관리자인데
// CRM 셸은 멤버면 들여보낸다. 동작이 표면 기본값을 물려받으면 아무도 차단을 안 적었는데
// 일반 사용자 CRM 멤버가 내보내기에서 막힌다. 그래서 여기서는 **적힌 것만** 본다.

test('판정 함수는 동작 키를 안 받는다 — 섞으면 표면 기본값이 동작에 내려온다', () => {
  assert.equal(decideAccess('home#export', MEMBER, []).reason, 'unregistered')
  assert.equal(decideAccess('crm#export', MEMBER, []).allowed, false)
})

test('「보기」는 키를 안 붙인다 — 그것이 표면 판정 자체다', () => {
  assert.equal(actionKey('crm', 'view'), 'crm')
  assert.equal(actionKey('crm', 'export'), 'crm#export')
  assert.equal(actionKey('crm:quotes', 'export'), 'crm:quotes#export')
  // 「보기」는 볼 키가 없다 — 거부권 축에 보기가 없다는 뜻이다
  assert.deepEqual(actionChain('view', ['crm']), [])
})

test('좁은 자리가 먼저, 그 다음 표면 — 동작 키 순서', () => {
  assert.deepEqual(actionChain('export', ['crm:quotes', 'crm']), ['crm:quotes#export', 'crm#export'])
})

test('모르는 동작은 접히지 않는다 — 오타가 조용히 권한이 되면 안 된다', () => {
  assert.equal(splitAction('crm#무엇').action, null)
  assert.equal(splitAction('crm#export').action, 'export')
  assert.equal(splitAction('crm').action, null)
})

test('프리셋은 차단의 묶음이다 — 허용으로 만들면 안 연 문 안에서 할 일을 정하게 된다', () => {
  assert.deepEqual([...PRESET_DENIES.viewOnly], ['write', 'export'])
  assert.deepEqual([...PRESET_DENIES.write], ['export'])
  assert.deepEqual([...PRESET_DENIES.exportToo], [])
})

test('동작 차단이 없으면 안 막힌다 — 부여 0건이면 지금과 같다', () => {
  assert.equal(vetoesAction('export', ['crm'], MEMBER, []), false)
  assert.equal(vetoesAction('write', ['crm'], MEMBER, []), false)
  // 표면이 관리자 전용이어도 동작 축은 그 사실을 물려받지 않는다.
  // 물려받으면 일반 사용자 CRM 멤버가 아무도 차단을 안 적었는데 내보내기에서 막힌다
  assert.equal(vetoesAction('export', ['crm'], MEMBER, [userGrant('deny', 'crm')]), false)
})

test('적힌 차단만 막는다', () => {
  const grants = [userGrant('deny', actionKey('crm', 'export'))]
  assert.equal(vetoesAction('export', ['crm'], MEMBER, grants), true)
  assert.equal(vetoesAction('write', ['crm'], MEMBER, grants), false)
})

test('좁은 자리의 허용이 표면의 차단을 이긴다', () => {
  const grants = [
    userGrant('deny', actionKey('crm', 'export')),
    userGrant('allow', actionKey('crm:quotes', 'export')),
  ]
  assert.equal(vetoesAction('export', ['crm:quotes', 'crm'], MEMBER, grants), false)
  assert.equal(vetoesAction('export', ['crm:deals', 'crm'], MEMBER, grants), true)
})

test('보기만 프리셋은 쓰기와 내보내기를 막고 보기는 안 막는다', () => {
  const grants = PRESET_DENIES.viewOnly.map((a) => userGrant('deny', actionKey('crm', a)))
  assert.equal(vetoesAction('write', ['crm'], MEMBER, grants), true)
  assert.equal(vetoesAction('export', ['crm'], MEMBER, grants), true)
  assert.equal(vetoesAction('view', ['crm'], MEMBER, grants), false)
})

test('남에게 건 차단은 나를 안 막는다', () => {
  const other = { surfaceKey: actionKey('crm', 'export'), subject: { kind: 'user' as const, id: 'u-남' }, effect: 'deny' as const }
  assert.equal(vetoesAction('export', ['crm'], MEMBER, [other]), false)
})

// ⑤ 값과 범위 (I11)
//
// 이 판에서 지키는 것 둘
//   ① 능력 이름이 **한 곳**에 있다 — CRM 이 복사해 가면 두 벌이 되고 그 둘이 갈린다
//   ② 범위 셋이 조직 스코프와 **같은 답**을 낸다 — 다르면 관리자가 연 범위와 사용자가 보는 범위가 다르다

test('★ CRM 능력 목록이 전사 표준을 그대로 읽는다 — 복사본이 없다', () => {
  assert.deepEqual([...CRM_CAPABILITIES], [...CAPABILITIES])
  // 같은 배열 객체여야 «읽는 것»이고, 값만 같으면 복사본이다
  assert.equal(CRM_CAPABILITIES, CAPABILITIES)
})

test('CRM 판정이 이 판 앞뒤로 같다 — 역할이 갖는 능력이 안 바뀌었다', () => {
  assert.deepEqual(capabilitiesOf({ role: 'OWNER' }), ['cost.view', 'cost.edit', 'margin.view', 'quote.send', 'quote.approve'])
  assert.deepEqual(capabilitiesOf({ role: 'MEMBER' }), ['quote.send'])
  assert.deepEqual(capabilitiesOf({ role: 'READONLY' }), [])
  // 사람마다 더하는 능력도 그대로 붙는다
  assert.ok(capabilitiesOf({ role: 'MEMBER', capabilities: ['cost.view'] }).includes('cost.view'))
})

const scope = (over: Partial<OrgScope>): OrgScope => ({
  editableDeptIds: [], readableDeptIds: [], isExecutive: false,
  scopeRootIds: [], nodes: [], closure: [], ...over,
})

test('범위 셋이 조직 스코프 결과와 일치한다', () => {
  // 전사 — 모든 부서를 읽는다
  const all = scope({ isExecutive: true, readableDeptIds: ['d1', 'd2', 'd3'] })
  assert.equal(rangeOfScope(all), 'all')
  assert.deepEqual(deptIdsOfRange(all, 'all'), ['d1', 'd2', 'd3'])

  // 부서 — 관할이 있고 그 서브트리를 읽는다
  const dept = scope({ editableDeptIds: ['d1'], readableDeptIds: ['d1', 'd1-1'] })
  assert.equal(rangeOfScope(dept), 'dept')
  assert.deepEqual(deptIdsOfRange(dept, 'dept'), ['d1', 'd1-1'])

  // 내 것 — 관할이 없다. 소속 부서가 readable 에 있어도 부서가 아니다
  const self = scope({ readableDeptIds: ['d1'] })
  assert.equal(rangeOfScope(self), 'self')
  assert.deepEqual(deptIdsOfRange(self, 'self'), [])
})

test('소속 부서를 읽는 것만으로 부서 범위가 되지 않는다 — 그러면 전원이 부서가 된다', () => {
  assert.equal(rangeOfScope(scope({ readableDeptIds: ['내부서'] })), 'self')
  assert.equal(rangeOfScope(scope({ editableDeptIds: ['내부서'], readableDeptIds: ['내부서'] })), 'dept')
})

const ORG = [
  { id: 'root', type: 'company', parent_id: null, head_user_id: null, user_id: null },
  { id: 'ceo', type: 'role', parent_id: 'root', head_user_id: 'u-ceo', user_id: null },
  { id: 'hq', type: 'department', parent_id: 'root', head_user_id: 'u-hq', user_id: null },
  { id: 'team', type: 'department', parent_id: 'hq', head_user_id: 'u-head', user_id: null },
  { id: 'p1', type: 'person', parent_id: 'team', head_user_id: null, user_id: 'u-1' },
]

test('조직도 원본만으로 구한 범위가 스코프 규칙과 같다', () => {
  assert.equal(rangeOfPerson('u-ceo', ORG), 'all')
  assert.equal(rangeOfPerson('u-head', ORG), 'dept')
  assert.equal(rangeOfPerson('u-1', ORG), 'self')
  assert.equal(rangeOfPerson('u-없는사람', ORG), 'self')
})

test('★ 루트 바로 아래의 장은 전사다 — 기존 스코프 규칙 그대로 옮긴 것이다', () => {
  /*
    `lib/org-scope.ts` 의 apex 판정이 「루트 head 이거나 **루트 직속 노드**의 head」다.
    즉 본부가 회사 바로 아래 있으면 본부장이 전사로 잡힌다. 넓어 보이지만 **여기서 고치지 않는다** —
    이 판의 기준은 「조직 스코프 결과와 일치한다」이고, 여기서만 좁히면 관리자 화면이 말하는 범위와
    사용자가 실제로 보는 범위가 갈린다. 규칙을 바꾸려면 org-scope 를 바꾸는 판에서 함께 바꾼다.
  */
  assert.equal(rangeOfPerson('u-hq', ORG), 'all')
})

test('범위 이름 셋이 전부 있고 겹치지 않는다', () => {
  assert.deepEqual([...RANGES], ['self', 'dept', 'all'])
  assert.equal(new Set(RANGES).size, RANGES.length)
})
