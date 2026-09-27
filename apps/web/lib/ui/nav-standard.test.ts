// lib/ui/nav-standard.test.ts — 길의 축 가드 (정책 §2-3-3)
//
// **왜 생겼나**(실측 v0.7.609): 서비스가 넷인데 들어가는 문이 넷 다 달랐고 나가는 문이 셋 달랐다.
//   · `영업 CRM` 은 메인 메뉴에 있고 `콘텐츠 인텔리전스`는 **없었다**(전체 메뉴로만)
//   · 나가는 문이 **두 자리**(CI 사이드바 「사내 업무로」 + 계정 메뉴 「홈으로 나가기」)에 있었고
//     문구가 셋이었다 — **셋 다 `/home` 으로 간다**
//   · `/lead-intake` 가 사이드바 「프로젝트관리」 / 전체 메뉴 「리드 인테이크」로 **두 이름**이었다
//     (그 화면은 실제로 리드 인테이크다)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from './component-scan.ts'
import { NAV_LABEL, SERVICE_NAV, EXIT_TO_MAIN, SIDEBAR_GROUP_LINKS } from '../nav/menu.ts'
import { isNavActive, type NavMatchable } from './nav-active.ts'
import { TRADING_NAV } from '../trading/nav/groups.ts'
import { AI_NAV_GROUPS } from '../ai-chat/nav/groups.ts'
import { RFP_NAV_GROUPS } from '../rfp/nav/groups.ts'
import { CRM_NAV_GROUPS } from '../crm/nav/groups.ts'

const MEMBER_LAYOUT = 'app/(member)/layout.tsx'
const QUICKNAV = 'components/ui/QuickNav.tsx'

test('하위 서비스는 전부 메인 사이드바에 있다 (N-1)', () => {
  /**
   * **표를 펴 쓰는 것만 인정한다.** 항목을 손으로 적어도 되게 두면
   * 서비스가 하나 늘 때 그 목록만 안 고쳐진다 — 그게 CI 가 빠져 있던 이유다.
   *
   * v0.10.361 부터 사이드바 목록은 `lib/nav/menu.ts` 가 등재부에서 만든다.
   * 그래서 소스 글자(`items: SERVICE_NAV.map(`)가 아니라 **만들어진 목록**을 본다 —
   * 글자를 보면 화면이 그 글자만 남기고 다른 목록을 그려도 통과한다.
   * 손목록이 화면에 다시 생기는 것은 `lib/nav/menu.test.ts` 가 따로 막는다.
   */
  const service = SIDEBAR_GROUP_LINKS.find((g) => g.key === 'service')
  assert.ok(service, '사이드바에 「서비스」 묶음이 없습니다(§2-3-3 N-1)')

  /**
   * **동일성**을 본다. 빠진 것도 더 선 것도 잡는다.
   *
   * 하루 동안 포함(subset)으로 느슨하게 뒀던 적이 있다(v0.10.576). AI 트레이딩을 사이드바에
   * 세우면서 그 서비스가 `SERVICE_NAV` 에는 없었기 때문인데, 그 상태가 바로 문제였다 —
   * 들어가는 문만 같고 셸은 안 바뀌었다. 이 판에서 트레이딩이 진짜 서비스가 되어 표에
   * 들어갔으므로 느슨하게 둘 이유가 사라졌다.
   *
   * 느슨한 규칙은 **손으로 더한 줄**을 통과시킨다. 실제로 그 하루 동안 사이드바 묶음은
   * 표를 펴 쓴 넷 + 손으로 적은 하나였다. 그게 이 파일이 막으려던 손목록이다.
   */
  assert.deepEqual(
    service.items.map((i) => i.href),
    SERVICE_NAV.map((s) => s.href),
    `「서비스」 묶음이 서비스 표와 갈렸습니다(§2-3-3 N-1)`,
  )
})

/**
 * **섹션 루트가 하위 화면에서 같이 켜지지 않는다 (N-5)**
 *
 * 왜 생겼나 (사용자 지적 2026-09-28: 「왼쪽 메뉴중 현황에는 계속 색이 들어가 있네?」):
 * `isNavActive` 는 접두어로 맞춘다. 그래서 `/trading` 은 `/trading/settings` 에서도 켜졌고
 * AI 트레이딩은 일곱 화면 중 여섯에서 「현황」이 같이 켜져 있었다.
 *
 * `exact` 라는 장치는 **이미 있었다.** `/ai`·`/rfp`·`/ci` 는 쓰고 있었고 트레이딩만 안 달았다.
 * 규칙이 글로만 있으면 새 셸이 그것을 모른다 — 그래서 목록을 기계가 본다.
 *
 * **글자가 아니라 판정을 본다.** `exact: true` 가 적혀 있는지가 아니라 `isNavActive` 를 실제로
 * 불러 「다른 줄의 화면에서 이 줄이 켜지나」를 묻는다. 적어 두고 안 넘기는 것을 잡으려면
 * 값이 가는지를 봐야 한다.
 */
const NAV_LISTS: readonly { name: string; items: readonly NavMatchable[] }[] = [
  { name: 'AI 트레이딩', items: TRADING_NAV },
  { name: 'AI 채팅', items: AI_NAV_GROUPS.flatMap((g) => g.items) },
  { name: '제안서', items: RFP_NAV_GROUPS.flatMap((g) => g.items) },
  // 영업 CRM 의 사이드바 줄은 묶음 자신이다 (묶음 안의 tabs 는 탭바라 축이 다르다)
  { name: '영업 CRM', items: CRM_NAV_GROUPS },
]

test('★ 섹션 루트는 하위 화면에서 같이 켜지지 않는다 (N-5)', () => {
  const bad: string[] = []
  for (const { name, items } of NAV_LISTS) {
    for (const item of items) {
      for (const other of items) {
        if (other.href === item.href) continue
        // 다른 줄의 화면을 열었을 때 이 줄이 같이 켜지면 어디 있는지가 사라진다
        if (isNavActive(other.href, item)) bad.push(`${name}: ${other.href} 에서 ${item.href} 가 같이 켜진다`)
      }
    }
  }
  assert.deepEqual(bad, [],
    `섹션 루트에 exact 가 없습니다 — 그 아래 모든 화면에서 계속 켜져 있습니다:\n  ${bad.join('\n  ')}`)
})

/**
 * **목록이 정한 exact 가 화면까지 간다.**
 *
 * 위 시험은 **목록**만 본다. 그래서 목록에 `exact: true` 를 적어 두고 셸이 그 값을 안 넘겨도
 * 초록이었다 — 이 가드를 만들며 일부러 깨뜨려 보고 알았다(2026-09-28).
 * 「선언만 하고 안 넘긴다」는 이 저장소가 여러 번 반복한 결함이라 그 자리를 따로 잠근다.
 *
 * 함께 막는 것 하나 더: 레이아웃에서 `it.href === '/ai'` 처럼 박으면 목록을 고쳐도
 * 화면이 안 따라오고, 새 셸은 그런 줄이 있는지도 모른다.
 */
test('★ 레이아웃은 목록이 정한 exact 를 그대로 넘긴다 (N-5)', () => {
  const layouts = ['app/(ai)/layout.tsx', 'app/(rfp)/layout.tsx', 'app/(trading)/layout.tsx']
  const hardcoded: string[] = []
  const notPassed: string[] = []
  for (const f of layouts) {
    const src = stripComments(read(f))
    if (/exact:\s*[A-Za-z_$][\w$]*\.href\s*===/.test(src)) hardcoded.push(f)
    // 목록 항목의 exact 를 **읽는** 자리가 있어야 한다. `exact: true` 를 셸이 직접 적는 것은
    // 목록을 안 읽은 것이므로 통과시키지 않는다
    if (!/\.exact\b/.test(src)) notPassed.push(f)
  }
  assert.deepEqual(hardcoded, [], `레이아웃이 exact 를 href 비교로 정합니다 — 목록이 정해야 합니다: ${hardcoded.join(', ')}`)
  assert.deepEqual(notPassed, [], `목록의 exact 를 셸이 안 넘깁니다 — 목록만 맞고 화면은 그대로입니다: ${notPassed.join(', ')}`)
})

test('나가는 문은 한 자리에만 있다 (N-2)', () => {
  // 계정 메뉴(SidebarProfile)가 다시 문을 그리면 두 벌이 된다
  const profile = stripComments(read('components/ui/SidebarProfile.tsx'))
  assert.ok(
    !/exitLinkFor\s*\(/.test(profile),
    '계정 메뉴에 나가는 문이 다시 생겼습니다 — 사이드바 하단(ShellExit) 한 자리입니다(§2-3-3 N-2)',
  )
  // 셸은 문을 항상 그린다 — 화면이 넘길 때만 그리면 넘기기를 잊은 서비스에 문이 없어진다(CRM 이 그랬다)
  const shell = stripComments(read('components/ui/shell/AppShell.tsx'))
  assert.ok(/<ShellExit\s*\/>/.test(shell), '셸이 ShellExit 를 항상 그려야 합니다')
})

test('나가는 문구는 하나다 (N-2)', () => {
  const OLD = ['사내 업무로', '홈으로 나가기']
  const bad: string[] = []
  for (const f of [MEMBER_LAYOUT, QUICKNAV, 'components/ui/shell/AppShell.tsx',
                   'components/ui/SidebarProfile.tsx', 'components/ui/shell/ShellExit.tsx',
                   'app/(crm)/layout.tsx', 'app/(ci)/layout.tsx']) {
    const src = stripComments(read(f))
    for (const o of OLD) if (src.includes(o)) bad.push(`${f} — ${o}`)
  }
  assert.deepEqual(bad, [], `EXIT_TO_MAIN.label(「${EXIT_TO_MAIN.label}」)을 쓰세요:\n${bad.join('\n')}`)
})

test('그룹은 항목 2개 이상일 때만 — 이름이 같은 그룹은 없앤다 (N-3)', () => {
  const src = stripComments(read(MEMBER_LAYOUT))
  // 「프로젝트관리 ▸ 프로젝트관리」처럼 그룹명과 항목명이 같은 자리가 있었다
  for (const m of src.matchAll(/label:\s*'([^']+)',\s*items:\s*\[\s*\{[^}]*label:\s*'([^']+)'/g)) {
    assert.notEqual(m[1], m[2], `그룹 「${m[1]}」의 유일 항목 이름이 그룹과 같습니다 — 그룹을 없애세요(N-3)`)
  }
})

test('같은 경로는 어디서든 같은 이름 (N-4)', () => {
  // 사이드바와 전체 메뉴가 각자 문자열을 적으면 갈린다. 둘 다 표를 읽는지 본다.
  const bad: string[] = []
  for (const f of [MEMBER_LAYOUT, QUICKNAV]) {
    const src = stripComments(read(f))
    for (const [href, label] of Object.entries(NAV_LABEL)) {
      // 그 경로를 쓰면서 **표에 있는 것과 다른 이름**을 직접 적었으면 위반
      const re = new RegExp(`href:\\s*'${href.replace(/\//g, '\\/')}'\\s*,\\s*label:\\s*'([^']+)'`)
      const m = src.match(re)
      if (m && m[1] !== label) bad.push(`${f} — ${href}: '${m[1]}' ≠ 표의 '${label}'`)
    }
  }
  assert.deepEqual(bad, [], `lib/nav/menu.ts 의 navLabel(href) 를 쓰세요:\n${bad.join('\n')}`)
})

// ── 계정 메뉴: 한 벌이어야 하고, 한 벌 안에서도 갈리면 안 된다 ──
//
// 사용자 지적(v0.7.716): "사용자명 눌렀을 때 나오는 메뉴가 조금씩 다른 것 같은데 별도 구현이야?"
// 구현은 한 벌이 맞았다(SidebarProfile). 갈린 것은 **그 안**이었다 —
// 여덟 줄을 각자 손으로 적어서 호버색이 셋(rgba(0,0,0,0.05)·--nav-hover-bg·--surface-muted),
// 구분선이 둘(rgba(0,0,0,0.1)·--border-light)이었다.

import { readFileSync as readFile } from 'node:fs'
import { join as joinPath } from 'node:path'

const PROFILE_SRC = readFile(
  joinPath(import.meta.dirname, '..', '..', 'components', 'ui', 'SidebarProfile.tsx'),
  'utf8',
)

test('★ 계정 메뉴 줄은 한 자리에서 그린다 — 손으로 적으면 같은 메뉴 안에서 색이 갈린다', () => {
  assert.doesNotMatch(PROFILE_SRC, /rgba\(0, ?0, ?0/, '하드코딩 호버·구분선 색이 남아 있다')
  assert.doesNotMatch(PROFILE_SRC, /rgba\(239/, '하드코딩 위험색이 남아 있다')
})

test('★ 서비스로 가는 문은 계정 메뉴에 두지 않는다 — 셋 중 하나만 있으면 대접이 달라 보인다', () => {
  for (const href of ['/crm', '/ci', '/ai']) {
    assert.doesNotMatch(
      PROFILE_SRC,
      new RegExp(`href="${href}"`),
      `${href} 문이 계정 메뉴에 박혀 있다 — 사이드바 「서비스」 묶음과 전체 메뉴가 그 길이다`,
    )
  }
})
