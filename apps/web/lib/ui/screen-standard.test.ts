// lib/ui/screen-standard.test.ts — 화면 표준 계약 가드
//
// 여기 있는 규칙들은 지금까지 **문서에만** 있었다(CLAUDE.md §2-2/§2-3). 문서만 있는 규칙은
// 만드는 사람이 바쁠 때 가장 먼저 빠진다 — 실제로 페이지 헤더·모달 ESC가 화면마다 갈렸다.
// 가드가 없으면 "표준을 지킨다"는 말은 희망이지 사실이 아니다.
//
// 규칙 셋 다 **지금 위반 0**이다. 예외 목록으로 시작하지 않는다 — 0에서 잠근다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

const SCREEN_ROOTS = ['app', 'components'] as const

function sources(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  for (const root of SCREEN_ROOTS) {
    for (const file of walkFiles(root, ['.tsx'])) out.push({ file, src: stripComments(read(file)) })
  }
  return out
}

test('페이지 제목은 PageHeader로만 그린다 — raw <h1> 금지(§2-3)', () => {
  // 왜: raw <h1>은 토큰을 하나만 빠뜨려도 다른 화면과 크기·자간이 달라진다.
  //   실제로 헤더가 페이지마다 갈려 같은 성격의 화면이 서로 다르게 보였다.
  //   PageHeader에 없는 슬롯(뒤로가기·아이콘) 때문에 자작한 곳이 있었고, 그건 부품을 고쳐서 해결했다.
  const offenders = sources()
    .filter(({ file }) => file !== 'components/ui/PageHeader.tsx')
    .filter(({ src }) => /<h1[\s>]/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [], `raw <h1>을 쓰는 화면이 생겼다. PageHeader를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

/**
 * 표준 이전 화면 — **늘리지 말 것**. 건드리면 SegmentedTabs로 옮기고 여기서 지운다.
 * (GPU 콕핏 내부 세그먼트 — 도메인 전용 스킨이라 이관 시 그 화면의 눈으로 확인이 필요하다)
 */
const TAB_PENDING = new Set<string>([
  'components/pricing/gpu/unified/DetailPanel.tsx',
  'components/pricing/gpu/unified/ViewSwitcher.tsx',
])

function selfMadeTabFiles(): string[] {
  return sources()
    .filter(({ file }) => file !== 'components/ui/SegmentedTabs.tsx')
    .filter(({ src }) => /role=["']tab["']/.test(src))
    .map(({ file }) => file)
}

test('탭은 SegmentedTabs가 유일한 렌더러다 — role="tab" 자작 금지', () => {
  // 왜: 탭 마크업이 다섯 벌이던 시절 활성 판정·키보드 규약이 제각각이었다.
  //   지금은 한 벌로 모았다(화면 축 실측: 표준 17 / 자작 0). 다시 갈라지지 않게 잠근다.
  const offenders = selfMadeTabFiles().filter((f) => !TAB_PENDING.has(f))
  assert.deepEqual(offenders, [], `탭 마크업을 자작한 화면이 생겼다. SegmentedTabs를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('TAB_PENDING은 실제로 아직 표준 밖이어야 한다 (죽은 예외 방지)', () => {
  // 이관이 끝난 파일이 목록에 남아 있으면, 그 파일이 다시 탭을 자작해도 가드가 못 잡는다.
  const still = new Set(selfMadeTabFiles())
  const stale = [...TAB_PENDING].filter((f) => !still.has(f))
  assert.deepEqual(stale, [], `이미 이관된 파일이 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})

test('화면을 덮는 대화상자는 ESC로 닫힌다(§2-2)', () => {
  // 왜: 마우스로만 닫히는 대화상자는 키보드 사용자를 가둔다. 제목(tape-title)처럼
  //   "제목이 있는 모달에만" 해당하는 규칙과 달리, ESC는 **모든** 대화상자에 보편적으로 참이다
  //   — 그래서 예외 없이 검사한다(제목·질감은 docs/ui-system/scan-screens.mjs가 본다).
  const offenders = sources()
    .filter(({ src }) => /role=["']dialog["']/.test(src))
    .filter(({ src }) => !/NbModal/.test(src))       // 공용 모달이 대신 처리
    .filter(({ src }) => !/useEscClose/.test(src) && !/['"]Escape['"]/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [], `ESC로 닫히지 않는 대화상자가 생겼다. useEscClose를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('입력과 버튼은 공용 높이를 쓴다 — 같은 줄에서 어긋나지 않게', () => {
  // 왜: 공용 높이 규약이 없어 입력 41px · 버튼 39px로 달랐다(실측 /ci/channels 상세에서 10px 어긋남).
  //   그래서 화면들이 `min-height: 44px`를 각자 붙여 왔고(dup-btn·sched-btn·cockpit-*-btn …),
  //   안 붙인 화면은 그대로 어긋났다. 값은 CLAUDE.md의 "터치 영역 최소 44px"를 따른다.
  const css = read('app/globals.css')
  assert.match(css, /--control-h:/, '공용 컨트롤 높이 토큰(--control-h)이 없다')
  const rule = css.match(/\.input-field,\s*\n\s*\.btn-primary,\s*\n\s*\.btn-ghost \{ min-height: var\(--control-h\); \}/)
  assert.ok(rule, '입력·버튼이 --control-h를 함께 쓰지 않는다 (한쪽만 바뀌면 다시 어긋난다)')
})

test('화면 간 이동 탭은 제목 아래에 둔다 — 레이아웃에서 그리지 않는다', () => {
  // 왜: 레이아웃(`layout.tsx`)이 탭을 그리면 페이지 제목은 `children` 안에 있으므로 **구조상 탭이 항상 위**다.
  //   그러면 사용자는 지금 보고 있는 화면의 이름을 알기 전에 다른 화면 목록부터 읽는다.
  //   실측: 리서치(/ci)는 제목 → StageNav(PageHeader의 below)인데 업무·CRM은 탭 → 제목으로 **반대**였다
  //   (사용자 지적: "다 맞춰야지 통일 시켜 안정감있게").
  //   지금은 셋 다 "제목 → 화면 간 탭 → 화면 내부 탭 → 본문"이다. 되돌아가지 않게 잠근다.
  const NAV_TABS = /<(ProjectTabs|WorkTabBar|StageNav)\b/
  const offenders = sources()
    .filter(({ file }) => file.endsWith('/layout.tsx'))
    .filter(({ src }) => NAV_TABS.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [],
    `레이아웃이 화면 간 탭을 그린다(구조상 제목 위가 된다). 각 화면 PageHeader의 below로 옮길 것:\n  ${offenders.join('\n  ')}`)
})
