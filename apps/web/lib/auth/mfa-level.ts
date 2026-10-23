/**
 * 2단계 인증 단계 판정 — 순수 함수만 둔다
 *
 * `mfa.ts` 와 나눈 이유: 그쪽은 `server-only` 를 물고 있어 테스트 러너가 못 읽는다.
 * 판정 규칙은 가장 틀리기 쉬운 자리인데 그것을 못 재면 가드가 소용없다.
 */

export type AalLevel = 'aal1' | 'aal2' | null

/**
 * 2단계를 아직 안 지난 세션인가.
 *
 * **토큰 안의 단계 두 개만** 본다. 「등록된 장치가 있나」를 따로 묻지 않는 이유는,
 * 장치를 막 지운 사람의 옛 토큰이 남아 못 들어오게 만들 수 있기 때문이다.
 * Supabase 가 nextLevel 을 계산해 주므로 그것만 믿는다.
 */
export function needsChallenge(state: { currentLevel: AalLevel; nextLevel: AalLevel }): boolean {
  return state.currentLevel === 'aal1' && state.nextLevel === 'aal2'
}

/**
 * 액세스 토큰에 적힌 단계. 서명은 보지 않는다
 *
 * 서버 클라이언트는 getUser 가 그 토큰을 인증 서버에서 검증한 **뒤에만** 이 값을 읽는다.
 * 검증 전 토큰으로 판정하지 않는다.
 */
export function aalFromAccessToken(token: string | null | undefined): AalLevel {
  const body = token?.split('.')[1]
  if (!body) return null
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    const aal = (JSON.parse(json) as { aal?: unknown }).aal
    return aal === 'aal1' || aal === 'aal2' ? aal : null
  } catch {
    return null
  }
}

/**
 * API 와 서버 액션에서 이 사람을 아직 「로그인 안 함」으로 볼 것인가
 *
 * 화면은 미들웨어가 /mfa 로 보내지만 /api 는 미들웨어를 안 탄다(matcher 가 뺀다).
 * 그래서 비밀번호만 아는 사람이 쿠키를 들고 /api 를 바로 부르면 2단계가 없는 것과 같았다.
 * 장치 수는 인증 서버가 방금 돌려준 사용자에서 센다, 쿠키 안의 옛 사용자 정보를 믿지 않는다.
 */
export function blocksBeforeSecondFactor(state: { tokenAal: AalLevel; verifiedFactors: number }): boolean {
  return needsChallenge({
    currentLevel: state.tokenAal,
    nextLevel: state.verifiedFactors > 0 ? 'aal2' : state.tokenAal,
  })
}
