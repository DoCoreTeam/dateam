import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

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
 * ⚠️ v0.7.617: `/develop`·`/api-access`는 이제 **로그인이 필요하다**(미들웨어 공개 목록에서 빠짐).
 *   공개 API 를 사내 자동화용으로 확정하면서 개발자센터를 로그인 뒤로 옮겼다.
 *   위 4개가 api_user에게 허용된다는 사실 자체는 그대로다 — 달라진 것은
 *   **로그인하지 않은 사람**이 /develop 을 볼 수 없다는 점이다.
 *   그래서 셸 밖 공개 화면은 이제 `/login`·`/change-password` 둘뿐이다.
 *
 * admin 레이아웃은 role !== 'admin'이면 이미 되돌리므로 api_user가 애초에 못 들어간다.
 * 그래도 같은 문장을 쓰게 해 둔다 — 나중에 admin 게이트가 느슨해져도 이건 남는다.
 */
export const API_USER_HOME = '/api-keys'

/**
 * 이미 목적지에 있는가 — **무한 리다이렉트를 막는 유일한 방어선**이다.
 *
 * `/api-keys`는 `(member)` 아래에 있고 그 레이아웃이 여기를 부른다. 그래서 조건 없이
 * 되돌리면 api_user가 자기 집에 들어갈 때마다 같은 곳으로 다시 보내진다(실측 v0.7.617:
 * 승인된 api_user 2명이 키를 한 번도 쓰지 못했다 — 들어갈 수가 없었다).
 *
 * pathname은 미들웨어가 `x-pathname`으로 실어 보낸다. 값이 없으면 **되돌린다** —
 * 판단 근거가 없을 때 문을 열어 두는 쪽이 훨씬 나쁘다. 대신 헤더가 사라지면
 * `api-user-gate.test.ts`가 실패해서 루프가 조용히 돌아오지 않는다.
 */
async function isAlreadyAtHome(): Promise<boolean> {
  // Next 15 부터 headers() 가 비동기다
  const path = (await headers()).get('x-pathname')
  if (!path) return false
  return path === API_USER_HOME || path.startsWith(`${API_USER_HOME}/`)
}

export async function redirectApiUser(role: string | null | undefined): Promise<void> {
  if (role === 'api_user' && !(await isAlreadyAtHome())) redirect(API_USER_HOME)
}

/**
 * 「관리자는 2단계 필수」가 켜져 있으면, 안 건 관리자를 등록 화면으로 보낸다.
 *
 * **왜 레이아웃인가**: 미들웨어에 두면 요청마다 profiles 를 한 번 더 조회한다.
 * 그 조회를 없애서 페이지당 236ms 를 줄인 전례가 있고 가드가 그것을 지킨다.
 * 레이아웃은 렌더에 쓸 role 을 **이미 읽고 있으므로** 여기서는 왕복이 0회다.
 * api_user 게이트가 같은 이유로 여기 있다.
 *
 * **막지 않고 보낸다**: 막으면 관리자가 자기 시스템에서 잠긴다.
 * 등록을 마치면 세션이 2단계가 되고 미들웨어가 그다음을 맡는다.
 *
 * 설정이 꺼져 있으면(기본값) 표 조회 한 번으로 끝나고 아무 일도 안 한다.
 */
export async function requireAdminMfa(role: string | null | undefined): Promise<void> {
  if (role !== 'admin') return

  const path = (await headers()).get('x-pathname') ?? ''
  // 등록하러 가는 길과 코드 넣는 길은 막지 않는다 — 막으면 영영 못 켠다
  if (path.startsWith('/security') || path.startsWith('/mfa') || path.startsWith('/change-password')) return

  const { isMfaRequiredForAdmin, getMfaState } = await import('./mfa.ts')
  if (!(await isMfaRequiredForAdmin())) return

  const state = await getMfaState()
  if (state.verified.length > 0) return

  redirect('/security?enroll=required')
}
