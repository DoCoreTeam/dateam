// lib/ui/dock-exclusive.test.ts — 우측하단 고정 레이어 독점 (02-SYSTEM §4)
//
// 왜: QuickAddFab(bottom:1.5rem/right:1.5rem, z:90)과 CI AssistantPanel FAB
//   (bottom:var(--space-4)/right:var(--space-4), z:var(--z-sticky)=90)이 좌표·z가 모두 같아
//   실제로 겹쳐 잘렸다. ScrollJumpButtons는 그걸 피하려고 `bottom: 92`라는 매직넘버를 썼다.
//   "각자 좌표를 정하는" 구조가 원인이다 → 좌표는 Dock만 안다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read } from './component-scan.ts'
import { dockSafeAreaPx } from './dock-metrics.ts'

/** 우측하단 좌표를 직접 정해도 되는 곳 = Dock 구현체뿐. */
const DOCK_OWNERS = new Set([
  'components/ui/shell/Dock.tsx',
])

/**
 * 아직 Dock으로 안 옮긴 것 — Phase 1이 이 목록을 **비운다**.
 * QueryToast는 토스트 레이어(z-toast=300)로 Dock과 층이 다르다 → 영구 예외.
 */
const DOCK_MIGRATION_PENDING = new Set([
  'components/ui/QueryToast.tsx', // 토스트 층 — Dock 대상 아님
])

/** `position:'fixed'` 주변에서 bottom+right만 지정 = 우측하단 점유 */
function occupiesBottomRight(src: string): boolean {
  for (const m of src.matchAll(/position: *['"]fixed['"]/g)) {
    const seg = src.slice(Math.max(0, m.index - 250), m.index + 250)
    if (/bottom: /.test(seg) && /right: /.test(seg) && !/left: /.test(seg) && !/top: /.test(seg)) return true
  }
  return false
}

test('우측하단 고정 레이어는 Dock만 좌표를 정한다', () => {
  const offenders = walkFiles('app', ['.tsx'])
    .concat(walkFiles('components', ['.tsx']))
    .filter((f) => !DOCK_OWNERS.has(f) && !DOCK_MIGRATION_PENDING.has(f))
    .filter((f) => occupiesBottomRight(read(f)))

  assert.deepEqual(offenders, [],
    `우측하단을 직접 점유하면 FAB끼리 겹친다. Dock 슬롯(primary/assistant/utility)으로 등록할 것:\n  ${offenders.join('\n  ')}`)
})

test('bottom 매직넘버(다른 FAB 피하기)를 새로 만들지 않는다', () => {
  // `bottom: 92`처럼 "남의 FAB 높이만큼 띄우기"는 Dock이 세로 스택을 관리하면 필요 없다.
  const offenders = walkFiles('app', ['.tsx'])
    .concat(walkFiles('components', ['.tsx']))
    .filter((f) => !DOCK_OWNERS.has(f) && !DOCK_MIGRATION_PENDING.has(f))
    .filter((f) => /bottom: *[0-9]{2,}\b/.test(read(f)))

  assert.deepEqual(offenders, [],
    `우측하단 여백을 손으로 계산하지 않는다. Dock의 --dock-safe-area를 쓸 것: ${offenders.join(', ')}`)
})

test('DOCK_MIGRATION_PENDING 항목은 실제로 아직 위반 상태여야 한다 (죽은 예외 방지)', () => {
  const stale = [...DOCK_MIGRATION_PENDING].filter((f) => {
    const src = read(f)
    return !occupiesBottomRight(src) && !/bottom: *[0-9]{2,}\b/.test(src)
  })
  assert.deepEqual(stale, [], `해소된 예외가 남아 있다. 목록에서 제거할 것: ${stale.join(', ')}`)
})

test('--dock-safe-area는 선언만 하고 끝나지 않는다 — 본문이 실제로 그 여백을 쓴다', () => {
  // 왜: 이 토큰은 "본문이 Dock을 피해야 할 때 쓰는 여백"으로 만들어졌는데 **아무도 쓰지 않았다**.
  //   그래서 목록 마지막 줄의 버튼이 Dock 아래에 깔려 스크롤을 끝까지 내려도 닿지 않았다
  //   (실측 /ci/monitoring). 선언만 있는 토큰은 "해결했다"는 착각만 남긴다.
  const css = read('app/globals.css')
  assert.ok(/--dock-safe-area:/.test(css), '--dock-safe-area 선언이 사라졌다')
  const consumers = css.split('\n').filter((l) => /var\(--dock-safe-area\)/.test(l))
  assert.ok(consumers.length > 0,
    '--dock-safe-area를 쓰는 규칙이 없다. 본문 스크롤 컨테이너의 padding-bottom에 적용할 것')
})

test('여백은 Dock이 실제로 잰 높이를 쓴다 — 상수로 두면 스택이 자랄 때 다시 덮는다', () => {
  // 왜: 5.5rem(88px) 고정이었는데 실측 스택은 176px, '수집 중 N건' 칩이 뜨면 250px이었다.
  //   여백이 절반이라 끝까지 스크롤해도 마지막 행 아이콘 버튼이 Dock 아래 남았고,
  //   누르면 그 자리의 어시스턴트·+ 버튼이 대신 받았다 — "안 눌린다"가 아니라 **다른 게 눌린다**
  //   (실측 /ci/inbox v0.7.547: 3행 열기·삭제, 4행 삭제). 상수로는 이 사고를 못 막는다.
  const css = read('app/globals.css')
  assert.match(css, /--dock-safe-area:[^;]*var\(--dock-height/,
    '--dock-safe-area가 Dock이 잰 --dock-height를 쓰지 않는다(상수로 되돌아갔다)')

  const dock = read('components/ui/shell/Dock.tsx')
  assert.match(dock, /setProperty\(\s*['"]--dock-height['"]/,
    'Dock이 자기 스택 높이를 --dock-height로 알려주지 않는다')
  assert.match(dock, /ResizeObserver/,
    '스택 높이는 런타임에 변한다(칩 등장) — 한 번 재고 끝내면 다시 덮인다')
  assert.match(dock, /removeProperty\(\s*['"]--dock-height['"]/,
    'Dock이 사라질 때 값을 걷지 않으면 Dock 없는 화면에 유령 여백이 남는다')
})

test('스택이 자라면 여백도 자란다 — QA가 실화면에서 못 밟은 상태를 숫자로 잠근다', () => {
  // 왜 여기서 잠그나: '수집 중 N건' 칩이 떠 스택이 250px로 커진 순간이 정확히 사고 지점인데,
  //   수집이 돌지 않으면 화면에 재현되지 않는다 — QA가 v0.7.550 판정에서 이 한 지점을
  //   미검증으로 남겼다(나머지 셋은 통과: 버튼 16/16 자기수신 · 화면별 가변 · 유령여백 0).
  //   실브라우저로 못 밟는 상태는 계산으로 밟는다.
  const VIEWPORT = 869          // QA 실측 뷰포트
  const CORNER = 16             // .app-dock bottom: var(--space-4)
  const topFor = (stack: number) => VIEWPORT - CORNER - stack

  // 실측 재현: 스택 176 + 코너 16 = 192 (QA가 /ci/inbox 하단에서 잰 값과 같아야 한다)
  assert.equal(dockSafeAreaPx(VIEWPORT, topFor(176)), 192,
    '실측 192px과 어긋난다 — 코너 여백을 빼먹었거나 높이만 재고 있다')

  // 칩이 떠 250px로 자란 상태: 여백이 반드시 더 커져야 한다(상수였다면 88px로 고정)
  const grown = dockSafeAreaPx(VIEWPORT, topFor(250))
  assert.equal(grown, 266)
  assert.ok(grown > dockSafeAreaPx(VIEWPORT, topFor(176)),
    '스택이 자랐는데 여백이 안 자란다 — 이 상태가 원래 사고 지점이다')
  assert.ok(grown > 88, '상수 5.5rem(88px)보다 작으면 그때 그 사고로 되돌아간다')

  // 화면별로 다른 값이 나와야 한다(QA 실측: /calendar 84 · /ci/inbox 152·192)
  assert.notEqual(dockSafeAreaPx(VIEWPORT, topFor(68)), dockSafeAreaPx(VIEWPORT, topFor(176)))

  // 부분 픽셀은 올림 — 1px 모자라 다시 걸리는 것을 막는다
  assert.equal(dockSafeAreaPx(869, 676.4), 193)

  // 비정상 입력은 0 (측정 실패가 화면 절반을 밀어내는 여백이 되면 안 된다)
  assert.equal(dockSafeAreaPx(Number.NaN, 100), 0)
  assert.equal(dockSafeAreaPx(869, Number.POSITIVE_INFINITY), 0)
  assert.equal(dockSafeAreaPx(869, 900), 0, 'Dock이 화면 밖이면 여백 0')
})

test('Dock은 여백 계산을 자기 안에서 다시 짜지 않는다 — 계산은 SSOT가 갖는다', () => {
  const dock = read('components/ui/shell/Dock.tsx')
  assert.match(dock, /dockSafeAreaPx/,
    'Dock이 lib/ui/dock-metrics의 계산을 쓰지 않는다')
  assert.ok(!/innerHeight *- *[a-z]/i.test(dock.replace(/dockSafeAreaPx\([^)]*\)/g, '')),
    'Dock 안에 여백 계산이 다시 생겼다 — 두 벌이 되면 한쪽만 고쳐진다')
})

test('셸의 스크롤 컨테이너는 라우트가 바뀌면 맨 위로 되돌린다', () => {
  // 왜: 스크롤 컨테이너가 window가 아니라 셸의 main이라 Next의 기본 스크롤 처리가 닿지 않는다.
  //   그대로 두면 상세 → 편집처럼 긴 화면끼리 이동했을 때 이전 위치가 남아
  //   **제목·뒤로가기가 화면 밖에 있는 채로** 열린다(실측: 영업기회 상세 → 편집).
  const shell = read('components/ui/MobileShell.tsx')
  assert.match(shell, /mainRef\.current\?\.scrollTo\(\{ *top: *0/,
    'MobileShell이 라우트 변경 시 main 스크롤을 맨 위로 되돌리지 않는다')
  // 같은 화면의 쿼리 변경(저장 후 토스트 등)까지 초기화하면 안 된다 → deps는 pathname이어야 한다
  assert.match(shell, /\}, \[pathname, closeMobile\]\)/,
    '스크롤 초기화가 pathname 외의 값에 반응하면 같은 화면의 쿼리 변경에서도 위치가 튄다')
})
