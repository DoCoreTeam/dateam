import { redirect } from 'next/navigation'

/**
 * api_user(외부 API 전용 계정)를 내부 화면에서 되돌린다 — 게이트 SSOT.
 *
 * 예전엔 이 판정이 **미들웨어**에 있었다. 그런데 미들웨어는 판정하려고
 * `profiles.role`을 매 요청 따로 조회했고, 그게 페이지 요청 하나당 **236ms**였다(실측).
 * 정작 (member)·admin·(ci) 레이아웃은 **이미 같은 행에서 role을 읽고 있었다** —
 * 렌더에 필요한 name·theme_preference 등을 가져오는 그 한 번의 조회에 role이 들어 있다.
 * 그래서 게이트를 레이아웃으로 내리면 왕복이 통째로 사라진다(추가 조회 0회).
 *
 * 화면 페이지 81개 전수 확인:
 *   76개 = (member)/admin/(ci) 레이아웃이 덮는다 → 이 함수가 막는다
 *    4개 = /api-keys·/change-password·/develop·/api-access → api_user에게 허용된 곳
 *    1개 = app/page.tsx → redirect('/home')뿐이라 (member)로 들어가 막힌다
 *
 * admin 레이아웃은 role !== 'admin'이면 이미 되돌리므로 api_user가 애초에 못 들어간다.
 * 그래도 같은 문장을 쓰게 해 둔다 — 나중에 admin 게이트가 느슨해져도 이건 남는다.
 */
export const API_USER_HOME = '/api-keys'

export function redirectApiUser(role: string | null | undefined): void {
  if (role === 'api_user') redirect(API_USER_HOME)
}
