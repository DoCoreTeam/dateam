// lib/ui/shell-contract.test.ts — 셸 계약 (02-SYSTEM §3)
//
// 왜: 셸이 `MobileShell(footer, headerRight)` 자유 슬롯이라 셸마다 꽂는 게 달랐다.
//   그래서 admin에는 전역검색·테마·비밀번호·패치노트가 통째로 없었고, CI에는 검색이 없었다.
//   "빠뜨릴 수 있는 구조"가 원인이므로, 셸을 **새로 만드는 것 자체**를 막는다.
//
// 이 가드가 잡는 것
//   ① MobileShell 직접 사용 — AppShell 내부 구현이므로 화면/레이아웃이 직접 쓰면 안 된다
//   ② 셸 없는 새 화면 — PublicSurface 4경로만 면제(로그인·비번변경·개발자문서·API신청)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { walkFiles, read } from './component-scan.ts'

/** MobileShell을 직접 import해도 되는 곳 = AppShell 계열 내부 구현뿐. */
const MOBILE_SHELL_ALLOWED = new Set([
  'components/ui/MobileShell.tsx',
  'components/ui/shell/AppShell.tsx',
  // MobileShell이 조립해 넣는 부품들 (타입/컨텍스트 참조)
  'components/ui/QuickNav.tsx',
  'components/ui/GlobalSearchBox.tsx',
  'components/ui/SidebarProfile.tsx',
])

/**
 * 셸이 없는 것이 정상인 화면 (PublicSurface).
 * 사이드바·전역검색·Dock·계정메뉴가 없다. 단 토큰·폼 클래스·프리미티브는 동일 적용된다.
 * 여기 없는 새 경로가 셸 없이 생기면 실패한다 — "셸 안 써도 되네"를 막는 명시적 목록.
 */
const PUBLIC_SURFACES = [
  'app/(auth)/login',
  'app/change-password',
  'app/develop',
  'app/api-access',
]

/** 아직 AppShell로 안 옮긴 셸 — Phase 1이 이 목록을 **비운다**. */
const SHELL_MIGRATION_PENDING = new Set<string>([])

const SHELL_MARKERS = ['AppShell', 'MobileShell', 'CiShell']

test('MobileShell을 직접 import하는 곳은 AppShell 내부 구현뿐이다 (새 셸 신설 금지)', () => {
  const offenders = walkFiles('app', ['.tsx'])
    .concat(walkFiles('components', ['.tsx']))
    .filter((f) => !MOBILE_SHELL_ALLOWED.has(f) && !SHELL_MIGRATION_PENDING.has(f))
    .filter((f) => /from '@\/components\/ui\/MobileShell'/.test(read(f)))

  assert.deepEqual(offenders, [],
    `셸은 AppShell 하나다. MobileShell은 그 내부 구현이므로 직접 쓰지 않는다: ${offenders.join(', ')}`)
})

test('모든 화면은 셸 레이아웃 아래에 있다 (PublicSurface 4경로만 면제)', () => {
  const uncovered: string[] = []

  for (const page of walkFiles('app', ['.tsx']).filter((f) => f.endsWith('page.tsx'))) {
    if (read(page).includes("redirect('/")) continue // app/page.tsx 같은 리다이렉트 전용
    if (PUBLIC_SURFACES.some((p) => page.startsWith(p + '/'))) continue

    let dir = dirname(page)
    let covered = false
    while (dir.startsWith('app')) {
      const layout = join(dir, 'layout.tsx')
      if (existsSync(layout) && SHELL_MARKERS.some((m) => read(layout).includes(m))) {
        covered = true
        break
      }
      dir = dirname(dir)
    }
    if (!covered) uncovered.push(page)
  }

  assert.deepEqual(uncovered, [],
    `셸 없이 렌더되는 화면이다. AppShell 레이아웃 아래로 넣거나, 공개 화면이면 PUBLIC_SURFACES에 등재할 것:\n  ${uncovered.join('\n  ')}`)
})

test('면제·유예 목록 항목은 실제로 존재해야 한다 (죽은 예외 방지)', () => {
  const missing = PUBLIC_SURFACES.filter((p) => !existsSync(join(p, 'page.tsx')))
  assert.deepEqual(missing, [], `없는 경로가 면제 목록에 남아 있다: ${missing.join(', ')}`)

  const stale = [...SHELL_MIGRATION_PENDING].filter(
    (f) => !existsSync(f) || !/from '@\/components\/ui\/MobileShell'/.test(read(f)),
  )
  assert.deepEqual(stale, [], `이미 이관된 셸이 유예 목록에 남아 있다. 제거할 것: ${stale.join(', ')}`)
})
