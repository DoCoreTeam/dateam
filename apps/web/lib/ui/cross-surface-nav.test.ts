/**
 * 표면을 건너가는 내비게이터는 **판정을 본다** (P0049)
 *
 * ## 왜
 *
 * P0046 이 사이드바와 전체 메뉴에서 죽은 문을 없앴는데, **한 층 아래가 남아 있었다.**
 * 실측 2026-09-22 — 업무 탭바는 탭 다섯(일일업무·주간보고·부서 업무·프로젝트 현황·이력)을,
 * 구 영업 탭바는 넷(리드 인테이크·거래처·인물·딜)을 **손목록으로** 그리고 있었다.
 * 관리자가 그중 하나를 닫으면 사이드바에서는 사라지는데 탭바에는 그대로 남아,
 * 누르면 「접근할 권한이 없습니다」가 뜬다. 닫는 단추가 절반만 듣는 셈이다.
 *
 * ## 무엇을 세나
 *
 * `'use client'` 부품 중 **다른 표면·자리의 주소를 여럿 적어 둔 것**을 찾는다.
 * 그런 자리는 반드시 열렸는지 물어야 한다(`useIsOpen`).
 *
 * 같은 표면 안에서만 도는 링크(상세·새로 만들기)는 대상이 아니다 — 레이아웃 게이트가
 * 이미 지난 자리라 거기서 또 물으면 같은 답을 두 번 묻는 것이다.
 *
 * ## 왜 목록을 두나
 *
 * 아직 안 고친 것을 **사유와 함께** 적어 두고 그 수가 늘지 않게 잠근다.
 * 목록이 0이 되면 이 가드는 전수 차단이 된다(P0049 I05 에서 0이 된다).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFiles, read, stripComments } from './component-scan.ts'
import { SURFACES } from '../access/surfaces.ts'

// 경로에 한글이 들어 있어 URL.pathname 은 퍼센트 인코딩된 문자열을 준다 — 파일을 못 찾는다
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/'
const rel = (f: string): string => (f.startsWith(WEB) ? f.slice(WEB.length) : f)

/** 판정을 본다는 흔적 */
const ASKS = /useIsOpen\b/

/**
 * 아직 판정을 안 보는 내비게이터. **줄기만 하고 늘지 않는다.**
 * 각 줄에 왜 아직인지 적는다 — 사유 없는 유예는 잊은 것과 구분되지 않는다.
 */
const NOT_YET: Record<string, string> = {
  'components/ui/ProjectTabs.tsx':
    '구 영업 탭 넷. 네 표면을 건너간다 — P0049 I04 가 붙인다.',
  'app/(member)/home/page.tsx':
    '홈에서 루틴·KPI·본부 운영·주간보고로 보내는 자리 — P0049 I05 가 붙인다.',
  'components/ui/SidebarProfile.tsx':
    '계정 메뉴에서 API Keys·개발자센터·보안으로 보내는 자리 — P0049 I05 가 붙인다.',
  'app/(ai)/ai/analyze/WorkflowHandoffModal.tsx':
    'AI 분석 결과를 업무로 넘기는 모달. 부서 업무·주간보고·프로젝트 현황을 가리킨다 — P0049 I05 가 붙인다.',
}

/**
 * **셸 밖** 화면 — 판정이 닿지 않는 자리라 물을 것이 없다.
 *
 * `OpenSurfacesProvider` 는 `AppShell` 이 깔고, 로그인·개발자센터는 그 밖에 있다.
 * 거기서 `useIsOpen` 을 불러도 컨텍스트가 없어 늘 참이다 — 부르는 것이 오히려 거짓말이 된다.
 * 셸 계약의 면제 목록(`lib/ui/shell-contract.test.ts`)과 같은 자리들이다.
 */
const OUTSIDE_SHELL: Record<string, string> = {
  'app/develop/page.tsx':
    '개발자센터는 로그인 없이 외부인도 보는 셸 밖 화면이다. 컨텍스트가 없고 판정 대상도 아니다.',
}

/** 표면·자리의 주소. 자리는 경로 자리만(탭 자리는 주소가 표면과 같아 글로 못 가른다) */
const TARGETS: string[] = SURFACES.flatMap((s) => [
  s.href,
  ...(s.zones ?? []).filter((z) => !z.tab).map((z) => `${s.href}/${z.name}`),
])

/** 이 파일이 **자기 표면 밖**의 주소를 몇 개나 적어 뒀나 */
function crossSurfaceHrefs(file: string, src: string): string[] {
  const body = stripComments(src)
  const own = TARGETS.filter((t) => rel(file).includes(`app/(member)${t}/`) || rel(file).includes(`app${t}/`))
  const found = new Set<string>()
  for (const t of TARGETS) {
    // `href: '/x'` 또는 `href="/x"` 로 **그 주소 자체**를 가리키는 자리만 — 하위 경로는 자기 화면 안이다
    if (new RegExp(`href[:=]\\s*['"\`]${t}(['"\`?])`).test(body)) found.add(t)
  }
  for (const o of own) found.delete(o)
  return [...found].sort()
}

function clientFiles(): string[] {
  return [...walkFiles(join(WEB, 'app')), ...walkFiles(join(WEB, 'components'))]
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
}

/** 건너가는 주소를 **둘 이상** 적어 둔 부품 = 내비게이터 */
function navigators(): { file: string; hrefs: string[] }[] {
  const out: { file: string; hrefs: string[] }[] = []
  for (const f of clientFiles()) {
    const src = read(f)
    const hrefs = crossSurfaceHrefs(f, src)
    if (hrefs.length >= 2) out.push({ file: rel(f), hrefs })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

test('세는 일 자체가 되고 있다', () => {
  // 걷기가 조용히 0건이 되면 아래 단정이 전부 통과해 버린다
  assert.ok(TARGETS.length > 25, `표면·자리를 ${TARGETS.length}개만 찾았다`)
  assert.ok(clientFiles().length > 100, `화면 파일을 ${clientFiles().length}개만 찾았다`)
})

test('★ 표면을 건너가는 내비게이터는 판정을 본다', () => {
  const blind = navigators()
    .filter((n) => !ASKS.test(read(join(WEB, n.file))))
    .filter((n) => !(n.file in NOT_YET) && !(n.file in OUTSIDE_SHELL))
  assert.deepEqual(
    blind.map((n) => `${n.file} → ${n.hrefs.join(' ')}`), [],
    '닫힌 곳으로 보내는 자리가 생겼습니다.\n' +
    '  ① `useIsOpen()` 을 불러 열린 것만 그린다 (components/ui/QuickNav.tsx 참고)\n' +
    '  ② 이 판에서 못 고치면 이 파일 NOT_YET 에 **사유와 함께** 적는다',
  )
})

test('유예·면제 목록이 실제 파일을 가리키고 사유가 적혀 있다', () => {
  const all = new Set(navigators().map((n) => n.file))
  for (const [file, why] of Object.entries({ ...NOT_YET, ...OUTSIDE_SHELL })) {
    assert.ok(all.has(file), `NOT_YET 의 ${file} 이 내비게이터로 안 잡힌다 — 이미 고쳤으면 지운다`)
    assert.ok(why.length > 20, `${file} 의 사유가 너무 짧다`)
  }
})

test('이미 고친 부품이 유예 목록에 남아 있지 않다', () => {
  const fixed = navigators()
    .filter((n) => ASKS.test(read(join(WEB, n.file))))
    .map((n) => n.file)
    .filter((f) => f in NOT_YET)
  assert.deepEqual(fixed, [], `이미 판정을 보는데 유예 목록에도 있다: ${fixed.join(', ')}`)
})
