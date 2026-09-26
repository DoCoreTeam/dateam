/**
 * 배치 누락 — **사이드바에 없는 표면은 사유가 적혀 있다**
 *
 * **왜**: 실측 2026-09-26. 관리자가 AI 트레이딩에 못 들어갔다. 접근권한은 이미 줘 있었고
 *   소유자도 문제의 절반이었는데, 나머지 절반은 **`/trading` 이 사이드바 배치 목록에
 *   아예 없던 것**이었다. 권한 문제로 보이지만 권한 문제가 아니었다 —
 *   열어 줘도 메뉴에 안 생기니 사용자는 「권한이 안 들어왔다」로 읽는다.
 *
 * 사이드바에 없는 것 자체는 정상이다. `/daily` 는 「업무」 안에 있고 `/admin` 은
 * 계정 메뉴에 있다. 문제는 **없는 이유가 어디에도 안 적혀 있던 것**이다.
 * 적혀 있지 않으면 「일부러 뺀 것」과 「넣는 걸 잊은 것」이 화면에서 똑같이 보인다.
 *
 * 그래서 규칙은 하나다. 등재된 표면은 사이드바에 서거나, 아래에 **왜 안 서는지**가 적혀 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SIDEBAR_TOP_LINKS, SIDEBAR_GROUP_LINKS, QUICKNAV_LINKS, allMenuHrefs,
} from '../nav/menu.ts'
import { SURFACES } from '../access/surfaces.ts'

/**
 * 사이드바에 안 서는 표면과 **어디로 들어가는가**.
 *
 * 「나중에 넣겠다」는 사유가 아니다. 지금 사용자가 그 화면에 닿는 길을 적는다 —
 * 길이 없으면 그것은 사유가 아니라 고장이고, 여기 적을 것이 아니라 배치에 세울 것이다.
 */
const NOT_IN_SIDEBAR: Readonly<Record<string, string>> = {
  '/daily': '사이드바 「업무」(/work)가 match 로 이 자리까지 데려간다',
  '/dept-tasks': '사이드바 「업무」(/work)가 match 로 이 자리까지 데려간다',
  '/weekly-report': '사이드바 「업무」(/work)가 match 로 이 자리까지 데려간다',
  '/routine': '홈 화면 카드와 레이아웃의 체크인 관문에서 들어간다',
  '/kpi': '홈 화면에서 들어간다',
  '/operations': '홈 화면에서 들어간다. 본부 소속만 쓰는 자리라 전원의 사이드바에 안 세운다',
  '/api-keys': '계정 메뉴(SidebarProfile)와 전체 메뉴에서 들어간다',
  '/admin': '계정 메뉴(SidebarProfile)에서 들어간다. 관리 화면이라 업무 사이드바와 층이 다르다',
  '/security': '계정 메뉴(SidebarProfile)에서 들어간다',
  '/develop': '전체 메뉴에서 새 창으로 연다. 개발자센터는 이 앱 밖이다',
  '/accounts': '구 영업 화면이라 CRM 으로 이관 중이다. 전체 메뉴에만 남긴다',
  '/contacts': '구 영업 화면이라 CRM 으로 이관 중이다. 전체 메뉴에만 남긴다',
  '/deals': '구 영업 화면이라 CRM 으로 이관 중이다. 전체 메뉴에만 남긴다',
  '/lead-intake': '구 영업 화면이라 CRM 으로 이관 중이다. 전체 메뉴에만 남긴다',
}

const sidebarHrefs = (): Set<string> =>
  new Set(allMenuHrefs(SIDEBAR_GROUP_LINKS, SIDEBAR_TOP_LINKS))

test('사이드바에 없는 표면은 전부 사유가 적혀 있다', () => {
  const side = sidebarHrefs()
  const unexplained = SURFACES
    .filter((s) => !side.has(s.href))
    .map((s) => s.href)
    .filter((href) => !(href in NOT_IN_SIDEBAR))

  assert.deepEqual(
    unexplained,
    [],
    `사이드바에 없는데 왜 없는지 안 적힌 표면이 있다 — 「일부러 뺀 것」과 「잊은 것」이 구분되지 않는다:\n  ${unexplained.join('\n  ')}`,
  )
})

test('사유 목록이 죽지 않았다 — 이미 사이드바에 선 것은 빼야 한다', () => {
  const side = sidebarHrefs()
  const stale = Object.keys(NOT_IN_SIDEBAR).filter((href) => side.has(href))
  assert.deepEqual(stale, [], `사이드바에 이미 선 자리가 사유 목록에 남아 있다: ${stale.join(', ')}`)

  const unknown = Object.keys(NOT_IN_SIDEBAR).filter((href) => !SURFACES.some((s) => s.href === href))
  assert.deepEqual(unknown, [], `등재부에 없는 주소가 사유 목록에 있다: ${unknown.join(', ')}`)
})

test('사유는 들어가는 길을 말한다 — 빈 문장이 아니다', () => {
  for (const [href, why] of Object.entries(NOT_IN_SIDEBAR)) {
    assert.ok(why.length > 10, `${href} 의 사유가 너무 짧다`)
    assert.doesNotMatch(why, /나중에|추후|TODO|예정/, `${href} 의 사유가 「나중에」다 — 그건 사유가 아니라 미룬 것이다`)
  }
})

test('두 메뉴 어디에도 없는 표면은 사유에 들어가는 길이 적혀 있다', () => {
  /**
   * 사이드바에도 전체 메뉴에도 없으면 **주소를 아는 사람만** 들어간다.
   * 그 자리는 사유가 특히 중요하다 — 길을 잃으면 화면이 있는 줄도 모른다.
   */
  const anywhere = new Set([...sidebarHrefs(), ...allMenuHrefs(QUICKNAV_LINKS)])
  const hidden = SURFACES.filter((s) => !anywhere.has(s.href)).map((s) => s.href)
  for (const href of hidden) {
    assert.ok(href in NOT_IN_SIDEBAR, `${href} 는 두 메뉴 어디에도 없는데 사유가 없다`)
    assert.match(
      NOT_IN_SIDEBAR[href],
      /계정 메뉴|홈 화면|사이드바 「업무」/,
      `${href} 는 두 메뉴 어디에도 없다 — 사유에 실제로 들어가는 길을 적는다`,
    )
  }
})

test('AI 트레이딩은 사이드바에 선다 — 이 가드를 만든 이유다', () => {
  assert.ok(
    sidebarHrefs().has('/trading'),
    'AI 트레이딩이 다시 사이드바에서 빠졌다. 소유자가 자기 모듈을 못 찾는다(실측 2026-09-26)',
  )
  assert.ok(!('/trading' in NOT_IN_SIDEBAR), '사이드바에 서 있는데 사유 목록에도 있다')
})
