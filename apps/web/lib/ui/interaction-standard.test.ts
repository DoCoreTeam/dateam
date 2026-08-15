// lib/ui/interaction-standard.test.ts — **행동(상호작용) 표준** 가드
//
// 지금까지의 가드는 전부 "모양"만 봤다(색·부품·클래스). 그런데 사용자가 실제로 겪은 불일치는
// 모양이 아니라 **행동**이었다:
//   · "행을 누르면 동작하는 게 왜 없지?"           → 목록 행이 죽어 있었다(/ci/inbox)
//   · "상세를 눌러야 상세가 보이는 것도 이상한데?" → 행은 죽고 '상세' 버튼만 살아 있었다(/ci/monitoring)
//   · "뒤로가기 버튼도 없고"                        → 상세 11곳이 제각각(자작 ArrowLeft 5 · 우측 버튼 1 · 없음 5)
//
// 모양이 같아도 **누르는 방식이 다르면 사용자에게는 다른 제품**이다. 그래서 행동도 잠근다.
// 규칙은 전부 부품이 이미 지원하는 것만 요구한다 — 화면은 상속만 하면 된다.
//   목록 행 열기 → `ListSurface`의 `rowHref`(라우트) / `onRowClick`(그 자리)
//   상세 복귀     → `PageHeader`(또는 `WorkPageShell`)의 `back`

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

function sources(): { file: string; src: string }[] {
  return [...walkFiles('app', ['.tsx']), ...walkFiles('components', ['.tsx'])]
    .map((file) => ({ file, src: stripComments(read(file)) }))
}

/** 동적 세그먼트(`[id]`) 아래 = 상세 화면 파일. 목록에서 들어와 되돌아갈 곳이 있다. */
function isDetailRouteFile(file: string): boolean {
  return /\/\[[^\]]+\]\//.test(file)
}

/**
 * 되돌아갈 목록이 없는 상세 — 공개 공유 링크는 로그인도 목록도 없다.
 * (여기 넣을 때는 "왜 되돌아갈 곳이 없는지"를 함께 적는다. 그냥 귀찮아서 넣지 않는다.)
 */
const NO_PARENT_LIST = new Set<string>([
  // 토큰으로 들어온 외부 열람자에게는 돌아갈 목록이 없다(로그인 사용자가 아니다)
  'app/(member)/ai-chat/shared/[token]/page.tsx',
  // 구 경로 호환 리다이렉트만 한다 — 화면이 아니다
  'app/admin/ai-chat/shared/[token]/page.tsx',
])

test('상세 화면의 제목에는 상위로 돌아갈 길이 붙는다 — PageHeader의 back(§2-3)', () => {
  const offenders = sources()
    .filter(({ file }) => isDetailRouteFile(file) && !NO_PARENT_LIST.has(file))
    .filter(({ src }) => /<PageHeader\b|<WorkPageShell\b/.test(src))
    .filter(({ src }) => !/\bback=\{/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [],
    `상세 화면에 뒤로가기가 없다. PageHeader(또는 WorkPageShell)에 back={{ href, label }}을 넘길 것:\n  ${offenders.join('\n  ')}`)
})

test('뒤로가기를 화면이 자작하지 않는다 — 위치·모양이 화면마다 갈린다', () => {
  // 실측: 자작 ArrowLeft 링크 5곳 · 우측 상단 "목록으로" 버튼 1곳 · 아무것도 없음 5곳.
  // 같은 기능이 왼쪽 위였다가 오른쪽 위였다가 사라진다 — 사용자는 매번 다시 찾아야 했다.
  const offenders = sources()
    .filter(({ file }) => isDetailRouteFile(file))
    .filter(({ src }) => /<ArrowLeft\b/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [],
    `상세 화면이 뒤로가기를 직접 그린다. PageHeader의 back을 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('목록에 상세 진입 수단이 있으면 행 자체도 열린다 — 버튼만 살아 있는 목록 금지', () => {
  // 왜: 행이 죽어 있으면 사용자는 "눌러도 아무 일이 없다"를 먼저 겪는다.
  //   그리고 화면마다 '상세' 버튼의 자리·이름이 달라 매번 찾아야 한다.
  //   `ListSurface`는 rowHref/onRowClick을 이미 지원한다 — 화면은 넘기기만 하면 된다.
  const offenders = sources()
    .filter(({ src }) => /<ListSurface\b/.test(src))
    // 상세로 들어가는 수단이 컬럼에 있는가 — **앱 내부 경로**로 가는 링크이거나 '상세' 라벨.
    // '열기'는 빼야 한다: 외부 원본을 새 탭으로 여는 링크(`<a target="_blank">열기</a>`)와
    // 구분되지 않아 오탐이 난다(실제로 /ci/assets가 그렇게 잡혔다).
    .filter(({ src }) => /<Link\s+href=\{`\//.test(src) || />\s*(상세|자세히)\s*</.test(src))
    .filter(({ src }) => !/\browHref=\{|\bonRowClick=\{/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [],
    `목록 행이 죽어 있다. ListSurface에 rowHref(라우트) 또는 onRowClick(그 자리)을 넘길 것:\n  ${offenders.join('\n  ')}`)
})

/**
 * 액션 칸이 아직 `flexWrap`으로 늘어놓는 화면 — **늘리지 말 것.**
 * 여기 있는 화면은 지금 폭에서는 접히지 않는 것을 실측으로 확인했다(`e2e/ui-consistency.spec.ts` 통과).
 * 하지만 버튼이 하나 늘거나 라벨이 길어지면 바로 접힌다 — 건드릴 때 `RowActions`로 옮기고 여기서 지운다.
 */
const ROW_ACTIONS_PENDING = new Set<string>([
  'app/(ci)/ci/assets/AssetsView.tsx',
  'app/(ci)/ci/briefs/[id]/BriefEditor.tsx',
  'app/(ci)/ci/inbox/InboxView.tsx',
  'app/(ci)/ci/publish/PublishView.tsx',
  'app/(ci)/ci/trends/TrendsView.tsx',
  'app/(member)/accounts/page.tsx',
  'app/(member)/api-keys/page.tsx',
])

function wrappingActionCellFiles(): string[] {
  return sources()
    .filter(({ src }) => /key: ['"]actions?['"]/.test(src))
    .filter(({ src }) => {
      const cell = src.slice(src.search(/key: ['"]actions?['"]/))
      // 다음 컬럼 정의 전까지만 본다 — 화면 다른 곳의 flexWrap까지 끌어오면 오탐이 난다
      const scope = cell.slice(0, cell.search(/\n\s*\{\s*\n?\s*(\/\/[^\n]*\n\s*)*key: /) + 1 || cell.length)
      return /flexWrap: ['"]wrap['"]/.test(scope)
    })
    .map(({ file }) => file)
}

test('새 액션 칸은 접힐 수 없게 만든다 — RowActions를 쓴다', () => {
  // 왜: 액션 칸을 `flexWrap: 'wrap'`으로 늘어놓으면 좁은 칸에서 접혀 **그 행만 세로로 커진다.**
  //   실측 /admin/members 관리 칸 135px에 버튼 5개 → 5줄, 행 216px(다른 정보는 50px). 32명이면 화면이 그만큼 길어졌다.
  //   /admin/partner-tiers는 버튼 둘뿐인데도 170px 칸에서 접혀 119px였다 — "몇 개까지는 괜찮다"가 성립하지 않는다.
  //   폭을 재서 맞추는 건 화면마다 다시 틀린다. `RowActions`가 **접힐 수 없는 구조**로 만든다.
  //
  // 이 정적 가드는 "접힐 수 있는가"만 본다. **실제로 접혔는가**는 렌더된 픽셀을 재는
  // `e2e/ui-consistency.spec.ts`(표셀컨트롤줄바꿈)가 판정한다 — 둘은 역할이 다르다.
  const offenders = wrappingActionCellFiles().filter((f) => !ROW_ACTIONS_PENDING.has(f))
  assert.deepEqual(offenders, [],
    `액션 칸이 접힐 수 있다(flexWrap). components/ui/list/RowActions로 감쌀 것:\n  ${offenders.join('\n  ')}`)
})

test('ROW_ACTIONS_PENDING은 실제로 아직 flexWrap이어야 한다 (죽은 예외 방지)', () => {
  const still = new Set(wrappingActionCellFiles())
  const stale = [...ROW_ACTIONS_PENDING].filter((f) => !still.has(f))
  assert.deepEqual(stale, [], `이미 이관된 파일이 예외 목록에 남아 있다. 지울 것: ${stale.join(', ')}`)
})

test('행이 열리는 목록의 액션 칸은 클릭 전파를 멈춘다 — 버튼 눌렀는데 상세가 열리는 사고 방지', () => {
  // 행 전체가 눌리면, 행 안의 버튼(재시도·지켜보기·삭제)도 같이 행 클릭을 발화시킨다.
  // 그러면 "지켜보기를 눌렀는데 상세로 튕기는" 일이 생긴다 — 실제로 promote 버튼에서 겪었다.
  const offenders = sources()
    .filter(({ src }) => /\browHref=\{|\bonRowClick=\{/.test(src))
    .filter(({ src }) => /key: 'action|key: 'actions/.test(src))
    .filter(({ src }) => !/stopPropagation/.test(src))
    .map(({ file }) => file)
  assert.deepEqual(offenders, [],
    `행이 열리는 목록의 액션 칸에 stopPropagation이 없다:\n  ${offenders.join('\n  ')}`)
})
