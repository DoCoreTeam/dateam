// lib/ui/nav-active.ts — 사이드바에서 지금 어느 줄이 켜지나
//
// **왜 따로 나왔나** (사용자 지적 2026-09-28: 「왼쪽 메뉴중 현황에는 계속 색이 들어가 있네?」):
// 이 판정은 `MobileShell.tsx` 안에 숨어 있었다. 화면 부품 안이라 가드가 부를 수 없었고,
// 그래서 **섹션 루트가 하위 화면 전부에서 켜져 있는 것**을 아무도 못 봤다.
// AI 트레이딩은 일곱 화면 중 여섯에서 「현황」이 같이 켜져 있었다.
//
// 판정을 순수 모듈로 빼면 가드가 **실제 함수**를 부른다. 규칙을 옮겨 적으면 두 벌이 되고
// 두 벌은 갈라진다 — 이 저장소가 그 함정에 여러 번 빠졌다.

/** 활성 판정에 필요한 것만. 그림(icon)·배지는 이 판정과 무관하다 */
export interface NavMatchable {
  href: string
  /** 추가로 켤 경로. 하위 화면에 들어가도 자리를 잃지 않게 */
  match?: readonly string[]
  /**
   * 경로가 정확히 같을 때만 켠다.
   *
   * 섹션 루트(`/trading`·`/ci`)는 접두어로 맞추면 그 아래 **모든 화면에서 계속 켜져** 있어
   * 「홈이 항상 활성」으로 보인다. 그런 항목에만 켠다.
   */
  exact?: boolean
}

/** 메뉴 항목 활성 판정 — href 또는 match 경로 중 하나에 맞나 */
export function isNavActive(pathname: string, item: NavMatchable): boolean {
  const paths = [item.href, ...(item.match ?? [])]
  if (item.exact) return paths.some((p) => pathname === p)
  return paths.some((p) => pathname === p || pathname.startsWith(p + '/'))
}
