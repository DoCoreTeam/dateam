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
