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
import { NAV_LABEL, SERVICE_NAV, EXIT_TO_MAIN } from '../nav/menu.ts'

const MEMBER_LAYOUT = 'app/(member)/layout.tsx'
const QUICKNAV = 'components/ui/QuickNav.tsx'

test('하위 서비스는 전부 메인 사이드바에 있다 (N-1)', () => {
  const src = stripComments(read(MEMBER_LAYOUT))
  /**
   * **표를 펴 쓰는 것만 인정한다.** 항목을 손으로 적어도 되게 두면
   * 서비스가 하나 늘 때 그 목록만 안 고쳐진다 — 그게 CI 가 빠져 있던 이유다.
   *
   * 느슨하게 잡으면 안 잡힌다: `SERVICE_NAV` 글자만 찾으면 **import 줄**이 걸리고,
   * href 문자열을 찾으면 **아이콘 맵**(`SERVICE_ICON['/ci']`)이 걸린다.
   * 둘 다 초판에서 실제로 통과시켰다 — 일부러 깨서 두 번 발견했다.
   */
  assert.ok(
    /items:\s*SERVICE_NAV\.map\(/.test(src),
    `「서비스」 그룹은 SERVICE_NAV 를 펴 씁니다 — 손으로 적으면 서비스가 늘 때 빠집니다(§2-3-3 N-1). ` +
    `지금 목록: ${SERVICE_NAV.map((s) => s.href).join(' · ')}`,
  )
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
