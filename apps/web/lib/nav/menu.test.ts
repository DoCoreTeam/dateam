import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_LABEL, navLabel, SERVICE_NAV, EXIT_TO_MAIN } from './menu.ts'
import { SURFACES } from '../access/surfaces.ts'
import { SERVICE_LABEL } from '../terms/index.ts'

test('서비스로 들어가는 링크는 간판과 같은 말을 쓴다', () => {
  assert.equal(NAV_LABEL['/crm'], SERVICE_LABEL.crm)
  assert.equal(NAV_LABEL['/ci'], SERVICE_LABEL.ci)
  assert.equal(NAV_LABEL['/develop'], SERVICE_LABEL.develop)
  assert.equal(NAV_LABEL['/rfp'], SERVICE_LABEL.rfp)
})

test('★ /lead-intake 는 이름이 하나다 — 사이드바 「프로젝트관리」와 전체메뉴 「리드 인테이크」로 갈렸던 자리', () => {
  assert.equal(NAV_LABEL['/lead-intake'], '리드 인테이크')
})

test('「서비스」 그룹에는 사이드바가 통째로 바뀌는 곳만 온다', () => {
  assert.deepEqual(SERVICE_NAV.map((s) => s.href), ['/crm', '/ci', '/ai', '/rfp'])
  // 관리자·개발자센터는 권한/외부라 여기 오지 않는다
  assert.ok(!SERVICE_NAV.some((s) => s.href === '/admin' || s.href === '/develop'))
})

test('나가는 문은 하나이고 문구도 하나다', () => {
  assert.equal(EXIT_TO_MAIN.href, '/home')
  assert.equal(EXIT_TO_MAIN.label, '업무로 나가기')
})

test('등재를 잊으면 드러난다 — 조용히 빈칸을 그리지 않는다', () => {
  assert.equal(navLabel('/home'), '홈')
  assert.equal(navLabel('/없는경로'), '/없는경로')
})

// ── 메뉴는 등재부에서 나온다 (I04) ──
//
// 예전엔 사이드바(`app/(member)/layout.tsx`)와 전체 메뉴(`components/ui/QuickNav.tsx`)가
// **각자 href 목록을 손으로** 들고 있었다. 아래 셋을 잠근다.
//   ① 목록이 이 판 앞뒤로 같다 — 생성으로 바꾸면서 조용히 늘거나 준 자리가 없다
//   ② 화면 소스에 손목록이 다시 생기지 않는다
//   ③ 그림이 빠진 줄이 없다 — 빈 그림은 오류처럼 보이지 않아 사람이 봐야 잡힌다

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SIDEBAR_TOP_LINKS, SIDEBAR_GROUP_LINKS, QUICKNAV_LINKS,
  ADMIN_ONLY_GROUPS, canSeeNav, menuLink, allMenuHrefs,
} from './menu.ts'

/** apps/web/lib/nav → apps/web */
const WEB = join(import.meta.dirname, '..', '..')
const readSrc = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const MEMBER_LAYOUT = 'app/(member)/layout.tsx'
const QUICKNAV = 'components/ui/QuickNav.tsx'

/** 이 판 직전(v0.10.360)에 두 화면이 손으로 들고 있던 목록 그대로 */
const BEFORE = {
  sidebarTop: ['/home', '/work', '/calendar', '/meeting-notes', '/org'],
  sidebarGroups: [
    { key: 'service', items: ['/crm', '/ci', '/ai', '/rfp'] },
    { key: 'pricing', items: ['/pricing/gpu', '/pricing/catalog'] },
  ],
  quickNav: [
    { label: '기본', items: ['/home', '/daily', '/calendar', '/weekly-report'] },
    { label: '영업', items: ['/crm'] },
    { label: '구 영업 (CRM 으로 이관 중)', items: ['/accounts', '/contacts', '/deals', '/lead-intake'] },
    { label: '가격정책', items: ['/pricing/gpu', '/pricing/catalog'] },
    // v0.10.449 에 `/trading`(AI 트레이딩) 한 줄을 일부러 더했다. 사이드바에는 안 세운다 —
    // 소유자 한 사람이 쓰는 모듈이라 모든 관리자의 사이드바를 차지할 이유가 없다
    { label: '별도 서비스', items: ['/ci', '/ai', '/rfp', '/api-keys', '/trading', '/develop'] },
  ],
}

test('★ 사이드바 목록이 이 판 앞뒤로 같다', () => {
  assert.deepEqual(SIDEBAR_TOP_LINKS.map((l) => l.href), BEFORE.sidebarTop)
  assert.deepEqual(
    SIDEBAR_GROUP_LINKS.map((g) => ({ key: g.key, items: g.items.map((i) => i.href) })),
    BEFORE.sidebarGroups,
  )
})

test('★ 전체 메뉴 목록이 이 판 앞뒤로 같다', () => {
  assert.deepEqual(
    QUICKNAV_LINKS.map((g) => ({ label: g.label, items: g.items.map((i) => i.href) })),
    BEFORE.quickNav,
  )
})

test('★ 관리자와 일반 사용자가 보는 것이 이 판 앞뒤로 같다', () => {
  const sidebarFor = (isAdmin: boolean) => SIDEBAR_GROUP_LINKS
    .filter((g) => isAdmin || !(g.key && ADMIN_ONLY_GROUPS.has(g.key)))
    .map((g) => ({ key: g.key, items: g.items.filter((i) => canSeeNav(i.href, isAdmin)).map((i) => i.href) }))
    .filter((g) => g.items.length > 0)
  const quickFor = (isAdmin: boolean) => QUICKNAV_LINKS
    .map((g) => g.items.filter((i) => canSeeNav(i.href, isAdmin)).map((i) => i.href))

  // 관리자: 전부 그대로
  assert.deepEqual(sidebarFor(true), BEFORE.sidebarGroups)
  assert.deepEqual(quickFor(true), BEFORE.quickNav.map((g) => g.items))

  // 일반 사용자: 「서비스」 묶음이 통째로 빠지고 전체 메뉴에서 관리자 전용 둘이 빠진다.
  // 목록을 여기 손으로 적는 것이 일부러다 — `canSeeNav` 로 거르면 구현을 구현으로 시험하게 된다
  assert.deepEqual(sidebarFor(false), [{ key: 'pricing', items: ['/pricing/gpu', '/pricing/catalog'] }])
  assert.deepEqual(
    quickFor(false),
    BEFORE.quickNav.map((g) => g.items.filter((h) => h !== '/ai' && h !== '/trading')),
  )
})

test('★ 화면이 href 목록을 다시 손으로 들지 않는다', () => {
  for (const file of [MEMBER_LAYOUT, QUICKNAV]) {
    const src = readSrc(file)
    assert.doesNotMatch(
      src, /href:\s*'\/[^']*'/,
      `${file} 에 손으로 적은 href 목록이 있다 — lib/nav/menu.ts 의 배치에 적는다`,
    )
  }
})

test('★ 메뉴에 선 자리는 전부 그림이 있다 — 빈 그림은 오류처럼 안 보인다', () => {
  const cases: [string, string[]][] = [
    [MEMBER_LAYOUT, allMenuHrefs(SIDEBAR_GROUP_LINKS, SIDEBAR_TOP_LINKS)],
    [QUICKNAV, allMenuHrefs(QUICKNAV_LINKS)],
  ]
  for (const [file, hrefs] of cases) {
    const src = readSrc(file)
    const missing = hrefs.filter((h) => !new RegExp(`'${h}':\\s*<`).test(src))
    assert.deepEqual(missing, [], `${file} 그림표에 빠진 줄`)
  }
})

test('배치가 등재 안 된 표면을 가리키면 조용히 넘어가지 않는다', () => {
  assert.throws(() => menuLink({ surface: '없는표면' }), /등재 안 된 표면/)
})

// ── 등재부의 표면은 전부 이름이 있다 (I07a) ──
//
// 왜: `navLabel` 은 못 찾은 주소를 **그대로** 돌려준다. 메뉴만 보면 그 자리는 안 그려지니
//   아무 일도 안 일어나지만, 접근권한 화면(`/admin/access`)은 등재부 **전부**를 그린다.
//   실측 2026-09-21 — 표면 25개 중 6개(`/admin`·`/dept-tasks`·`/kpi`·`/operations`·
//   `/routine`·`/security`)가 이름 자리에 주소를 그렸다. 관리자는 그 줄이 무슨 화면인지
//   주소로 짐작해야 했고, 짐작으로 문을 여닫는 상태였다.
//
// 그래서 **배치가 아니라 등재부**를 기준으로 센다. 메뉴에 안 세운 화면도 이름은 있어야 한다.

test('★ 등재부의 모든 표면이 이름을 갖는다 — 주소가 이름 자리에 뜨지 않는다', () => {
  const nameless = SURFACES.filter((s) => navLabel(s.href) === s.href).map((s) => s.href)
  assert.deepEqual(
    nameless, [],
    `이름 없는 표면: ${nameless.join(', ')}\n` +
    'lib/nav/menu.ts 의 NAV_LABEL 에 이름을 적는다. 그 화면이 이미 쓰는 제목을 그대로 가져온다 — ' +
    '여기서 새로 지으면 같은 화면이 두 이름을 갖는다(N-4).',
  )
})

test('이름 표에 등재부에 없는 주소가 남아 있지 않다', () => {
  // 화면을 지웠는데 이름만 남으면 다음 사람이 그 주소를 살아 있는 화면으로 읽는다
  const stale = Object.keys(NAV_LABEL).filter((href) => !SURFACES.some((s) => s.href === href))
  assert.deepEqual(stale, [], `사라진 주소가 이름 표에 남아 있다: ${stale.join(', ')}`)
})

// ── AI 트레이딩은 소유자 한 사람의 모듈이다 (P0057 I03a) ──
//
// 메뉴에 띄워 놓고 라우트에서 막으면 **죽은 문**이 하나 생긴다 — 이 저장소가
// `/accounts`·`/contacts`·`/deals`·`/lead-intake` 넷으로 이미 겪은 모양이다.
// 그래서 일반 사용자에게는 메뉴에서부터 안 보인다.

test('★ AI 트레이딩은 일반 사용자 메뉴에 안 뜬다', () => {
  assert.equal(canSeeNav('/trading', false), false, '일반 사용자에게 죽은 문이 생겼다')
  assert.equal(canSeeNav('/trading', true), true, '관리자 메뉴에서도 사라지면 소유자가 들어갈 길이 없다')
  assert.equal(navLabel('/trading'), 'AI 트레이딩')
})

test('★ AI 트레이딩은 사이드바를 차지하지 않는다', () => {
  const sidebar = allMenuHrefs(SIDEBAR_GROUP_LINKS, SIDEBAR_TOP_LINKS)
  assert.equal(sidebar.includes('/trading'), false, '한 사람이 쓰는 모듈이 모두의 사이드바에 섰다')
  assert.equal(allMenuHrefs(QUICKNAV_LINKS).includes('/trading'), true, '전체 메뉴에도 없으면 들어갈 길이 없다')
})
