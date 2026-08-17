// lib/ui/dock-metrics.ts — Dock이 본문에 알려 줄 여백 계산 (SSOT)
//
// 왜 함수로 빼는가: 이 계산은 `Dock.tsx`의 useEffect 안에 있었고, 그래서 검증할 방법이
// **실브라우저뿐**이었다. 그런데 정작 확인해야 하는 상태('수집 중 N건' 칩이 떠 스택이
// 250px로 자란 순간)는 수집이 돌지 않으면 화면에 재현되지 않는다 — QA가 그 지점을
// 미검증으로 남겼다(v0.7.550 판정). 계산을 밖으로 빼면 그 상태를 숫자로 재현할 수 있다.
//
// 규약: 여백 = 화면 밑변에서 스택 맨 위까지의 거리.
//   높이만 재면 코너 여백(bottom: var(--space-4))만큼 모자라 마지막 줄이 여전히 걸린다.
//   스택이 자라면 dockTop이 작아지므로 여백은 **반드시 같이 커진다**.

/**
 * 본문이 Dock을 피하는 데 필요한 하단 여백(px).
 *
 * @param viewportHeight 화면 높이(window.innerHeight)
 * @param dockTop        Dock 사각형의 위쪽 y(getBoundingClientRect().top)
 *
 * 실측 기준(v0.7.550 · /ci/inbox 뷰포트 869): 스택 176 + 코너 여백 16 → 192px.
 * 상수 5.5rem(88px)은 그 절반이었고, 그래서 끝까지 스크롤해도 아이콘 버튼이 Dock 아래
 * 남아 클릭이 어시스턴트·+ 버튼으로 갔다.
 */
export function dockSafeAreaPx(viewportHeight: number, dockTop: number): number {
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(dockTop)) return 0
  // 부분 픽셀에서 1px 모자라 다시 걸리는 것을 막으려고 올림한다(내림 금지).
  return Math.max(0, Math.ceil(viewportHeight - dockTop))
}
