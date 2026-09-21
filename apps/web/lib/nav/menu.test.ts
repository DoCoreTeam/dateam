import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NAV_LABEL, navLabel, SERVICE_NAV, EXIT_TO_MAIN } from './menu.ts'
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
    { label: '별도 서비스', items: ['/ci', '/ai', '/rfp', '/api-keys', '/develop'] },
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

  // 일반 사용자: 「서비스」 묶음이 통째로 빠지고 전체 메뉴에서 /ai 만 빠진다 — 지금과 같다
  assert.deepEqual(sidebarFor(false), [{ key: 'pricing', items: ['/pricing/gpu', '/pricing/catalog'] }])
  assert.deepEqual(
    quickFor(false),
    BEFORE.quickNav.map((g) => g.items.filter((h) => h !== '/ai')),
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
