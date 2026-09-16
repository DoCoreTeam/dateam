import { test } from 'node:test'
import assert from 'node:assert/strict'

import { surfaceOf, exitLinkFor, adminEntryFor, serviceOf, SERVICE_HOME } from './surface.ts'
import type { ServiceKey } from '../terms/index.ts'

test('관리자 화면을 알아본다', () => {
  assert.equal(surfaceOf('/admin'), 'admin')
  assert.equal(surfaceOf('/admin/users'), 'admin')
})

test('★ CRM·CI 는 하위 표면이다 — 예전엔 여기서 판정이 admin=false 하나로 뭉개졌다', () => {
  assert.equal(surfaceOf('/crm'), 'sub')
  assert.equal(surfaceOf('/crm/meetings/abc'), 'sub')
  assert.equal(surfaceOf('/ci'), 'sub')
  assert.equal(surfaceOf('/ci/inbox'), 'sub')
})

test('경계를 본다 — /crmx 는 CRM 이 아니다', () => {
  assert.equal(surfaceOf('/crmx'), 'member')
  assert.equal(surfaceOf('/citation'), 'member')
})

test('평범한 멤버 화면과 빈 값', () => {
  assert.equal(surfaceOf('/home'), 'member')
  assert.equal(surfaceOf('/meeting-notes/abc'), 'member')
  assert.equal(surfaceOf(null), 'member')
  assert.equal(surfaceOf(undefined), 'member')
})

test('★ CRM·CI 에서는 홈으로 나가는 문이 있다 — 이게 없던 것이 지적받은 결함이다', () => {
  assert.deepEqual(exitLinkFor('sub'), { href: '/home', label: '홈으로 나가기' })
})

test('관리자 화면에서는 예전 문구 그대로 — 회귀 0', () => {
  assert.deepEqual(exitLinkFor('admin'), { href: '/home', label: '멤버 화면으로' })
})

test('이미 멤버 화면이면 나갈 문을 만들지 않는다 — 지금 있는 곳으로 가는 링크는 소음이다', () => {
  assert.equal(exitLinkFor('member'), null)
})

test('★ 나가는 문은 관리자 여부와 무관하다 — 일반 멤버가 갇히던 자리가 여기다', () => {
  // exitLinkFor 는 isAdmin 을 아예 받지 않는다. 받으면 또 관리자만의 문이 된다.
  assert.equal(exitLinkFor.length, 1, '인자는 표면 하나뿐이어야 한다')
})

test('관리자 패널로 들어가는 문은 관리자에게만, 그리고 거기가 아닐 때만', () => {
  assert.deepEqual(adminEntryFor('member', true), { href: '/admin/users', label: '관리자 패널' })
  assert.deepEqual(adminEntryFor('sub', true), { href: '/admin/users', label: '관리자 패널' })
  assert.equal(adminEntryFor('admin', true), null, '이미 거기 있다')
  assert.equal(adminEntryFor('member', false), null)
  assert.equal(adminEntryFor('sub', false), null)
})

test('★ 어느 표면에서도 계정 메뉴에 갈 곳이 하나는 있다 — 갇히는 조합이 없다', () => {
  for (const surface of ['admin', 'sub', 'member'] as const) {
    for (const isAdmin of [true, false]) {
      const links = [exitLinkFor(surface), adminEntryFor(surface, isAdmin)].filter(Boolean)
      if (surface === 'member' && !isAdmin) continue // 이미 홈 쪽이라 나갈 곳이 없는 게 정상
      assert.ok(links.length > 0, `${surface} · admin=${isAdmin} 에서 갈 곳이 없다`)
    }
  }
})

// ── 서비스 간판 (2026-08-27) ────────────────────────────────────────────
// 로고 자리가 네 셸에서 **회사 브랜드만** 똑같이 띄워, 화면만 봐서는 지금 CRM 인지
// 콘텐츠 인텔리전스인지 알 수 없었다. `surfaceOf` 는 CRM·CI 를 `sub` 로 뭉개므로
// 간판에는 쓸 수 없다 — 그래서 `serviceOf` 가 따로 있다.

test('로고 자리는 CRM 과 콘텐츠 인텔리전스를 구분한다 — surfaceOf 는 둘 다 sub 다', () => {
  assert.equal(serviceOf('/crm').label, '영업 CRM')
  assert.equal(serviceOf('/crm/people/abc').label, '영업 CRM')
  assert.equal(serviceOf('/ci').label, '콘텐츠 인텔리전스')
  assert.equal(serviceOf('/ci/inbox').label, '콘텐츠 인텔리전스')
  // 같은 두 경로가 surfaceOf 에서는 구분되지 않는다 — 그래서 간판에 쓰면 안 된다
  assert.equal(surfaceOf('/crm'), surfaceOf('/ci'))
})

test('셸 밖 공개 화면도 자기 이름이 있다', () => {
  assert.equal(serviceOf('/develop').label, '개발자센터')
  assert.equal(serviceOf('/api-access').label, '개발자센터')
  assert.equal(serviceOf('/admin/users').label, '관리자')
})

test('메인은 업무 워크스페이스다', () => {
  assert.equal(serviceOf('/home').key, 'member')
  assert.equal(serviceOf('/').key, 'member')
  assert.equal(serviceOf(null).key, 'member')
})

test('경계는 serviceOf 도 본다 — /crmx 는 CRM 이 아니다', () => {
  assert.equal(serviceOf('/crmx').key, 'member')
  assert.equal(serviceOf('/citation').key, 'member')
  assert.equal(serviceOf('/developer-blog').key, 'member')
})

test('간판을 누르면 그 서비스의 첫 화면으로 간다', () => {
  assert.equal(serviceOf('/crm/deals/abc').home, '/crm')
  assert.equal(serviceOf('/ci/studio').home, '/ci')
  assert.equal(serviceOf('/home').home, '/home')
})

/*
  ── 나가는 문이 새 서비스를 자동으로 따라가는가 ──────────────────────────────

  RFP 분석기가 이 자리에서 빠졌다. `SERVICE_ROUTES` 에는 `/rfp` 를 적었는데
  `surfaceOf` 안의 `crm | ci | ai` 손목록에 더하는 것을 잊었고, 그래서
  /rfp 사이드바에는 나가는 문이 **아예 없었다**. 손목록이 둘이면 반드시 한쪽이 빠진다.
*/

test('★ RFP 분석기는 하위 표면이다 — 손목록에서 빠져 문이 통째로 없던 자리다', () => {
  assert.equal(surfaceOf('/rfp'), 'sub')
  assert.equal(surfaceOf('/rfp/cases/abc-123'), 'sub')
  assert.notEqual(exitLinkFor(surfaceOf('/rfp')), null)
})

test('★ 새 서비스는 손목록에 또 적지 않아도 문이 따라온다 (SERVICE_ROUTES 한 곳)', () => {
  /*
    집·관리자·셸 없는 공개 화면 셋만 예외다. 나머지는 **무엇이 오든** sub 여야 한다.
    새 서비스를 더하고 이 단정이 깨진다면, 판정이 다시 손목록으로 돌아갔다는 뜻이다.
  */
  const EXEMPT = new Set<ServiceKey>(['member', 'admin', 'develop'])

  const missingDoor = (Object.keys(SERVICE_HOME) as ServiceKey[])
    .filter((key) => !EXEMPT.has(key))
    .filter((key) => surfaceOf(SERVICE_HOME[key]) !== 'sub')

  assert.deepEqual(missingDoor, [],
    `하위 서비스인데 나가는 문이 없다. surfaceOf 가 다시 손목록으로 판정하는지 볼 것: ${missingDoor.join(', ')}`)
})

test('셸 없는 공개 화면에는 문을 걸지 않는다 — 사이드바가 없어 걸 자리가 없다', () => {
  assert.equal(surfaceOf('/develop'), 'member')
  assert.equal(surfaceOf('/api-access'), 'member')
})
