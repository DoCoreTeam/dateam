// lib/nav/service-switch.test.ts — 옆으로 가는 길 (§2-3-3 N-1)
//
// **왜 생겼나**(사용자 지적 2026-09-30): 「각 서비스에서 계정 메뉴에서 다른 서비스로
// 이동할 수 있도록 구현되어 있는걸로 알고 있었는데?」 — 실측하니 **어느 서비스에도 없었다.**
// 하위 서비스에 들어가면 사이드바가 그 서비스 것으로 바뀌어 다른 서비스 이름이 화면에서
// 사라지고, 옆으로 가려면 `/home` 에 나갔다 다시 들어가야 했다.
//
// **글자가 아니라 판정을 본다.** `SERVICE_NAV` 를 import 했는지가 아니라 함수를 실제로 불러
// 「무엇이 나오나」를 묻는다. 적어 두고 안 쓰는 것을 잡으려면 값이 가는지를 봐야 한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { serviceSwitchLinks } from './service-switch.ts'
import { SERVICE_NAV } from './menu.ts'

/** 전부 열린 사람 */
const allOpen = () => true

test('하위 서비스에서 다른 서비스가 전부 나온다', () => {
  const links = serviceSwitchLinks('/trading', allOpen)
  assert.deepEqual(
    links.map((l) => l.href),
    SERVICE_NAV.map((s) => s.href),
    '계정 메뉴의 서비스 목록이 서비스 표와 갈렸습니다 — 손목록을 그리고 있습니다',
  )
  assert.deepEqual(
    links.map((l) => l.label),
    SERVICE_NAV.map((s) => s.label),
    '이름을 손으로 적고 있습니다 — 같은 경로는 어디서든 같은 이름입니다(N-4)',
  )
})

test('지금 보고 있는 서비스가 표시된다', () => {
  const links = serviceSwitchLinks('/trading/judgments', allOpen)
  const current = links.filter((l) => l.current)
  assert.equal(current.length, 1, '지금 자리가 하나로 표시돼야 합니다')
  assert.equal(current[0]!.href, '/trading', '하위 화면에서도 그 서비스가 지금 자리입니다')
})

test('업무 워크스페이스에서는 안 그린다 — 사이드바 「서비스」 묶음이 그 자리다 (N-1)', () => {
  for (const p of ['/home', '/daily', '/weekly-report']) {
    assert.deepEqual(serviceSwitchLinks(p, allOpen), [], `${p} 에서 서비스 문이 두 벌이 됩니다`)
  }
})

test('관리자 화면에서는 그린다 — 거기 사이드바에도 서비스가 없다', () => {
  assert.ok(serviceSwitchLinks('/admin/users', allOpen).length > 0)
})

test('닫힌 서비스는 안 나온다', () => {
  const links = serviceSwitchLinks('/trading', (href) => href !== '/ci')
  assert.ok(!links.some((l) => l.href === '/ci'), '접근권한이 닫은 곳으로 보내고 있습니다')
  assert.equal(links.length, SERVICE_NAV.length - 1)
})

test('열린 것이 지금 서비스뿐이면 목록이 없다 — 고를 것이 없는 묶음은 소음이다', () => {
  assert.deepEqual(serviceSwitchLinks('/trading', (href) => href === '/trading'), [])
})

test('아무 데도 안 열렸으면 목록이 없다', () => {
  assert.deepEqual(serviceSwitchLinks('/trading', () => false), [])
})
