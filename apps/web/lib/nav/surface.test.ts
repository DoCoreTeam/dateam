import { test } from 'node:test'
import assert from 'node:assert/strict'

import { surfaceOf, exitLinkFor, adminEntryFor } from './surface.ts'

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
