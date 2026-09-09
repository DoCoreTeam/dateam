// 프로바이더 에러 → 사용자 친절 메시지 매핑(SSOT, 순수·테스트 대상).
// fatalModel=이 모델이 근본적으로 못 쓰는 상태(404 삭제/미지원 · 할당량 0) → 카탈로그에서 비활성화 대상.
// "AI 응답 생성 실패" 같은 무의미 메시지 금지 — 사유별 액션 가능한 안내.

/**
 * **무엇이 죽었는가** — 폴백 체인이 다음에 무엇을 건너뛸지 정하는 축(lib/ai-chat/model-chain.ts).
 *
 * `fatalModel`(카탈로그를 비활성화할지)과 다른 질문이다. 저건 "이 모델을 목록에서 내릴까",
 * 이건 "지금 이 요청을 어디로 넘길까"다. 둘을 한 값으로 묶으면 429에서 같은 공급자의
 * 다른 모델로 넘어가 **또 429를 맞는다**.
 *
 * - `model`    이 모델만 못 쓴다. 같은 공급자의 다른 모델은 살아 있다(404 삭제 · 요금제 미지원)
 * - `provider` 이 공급자(키)로는 뭘 해도 안 된다. 모델을 바꿔도 같이 죽는다
 * - `transient` 원인 불명. 이 후보만 건너뛴다
 *
 * `provider` 범위의 근거(실측 2026-08-27, lib/ai/fallback-text.ts 머리주석):
 * 무료 티어 한도는 **프로젝트별로 모델마다** 걸려서 모델을 갈아타도 같은 프로젝트면
 * 함께 소진된다. flash 계열 3종이 동시에 429였다. 그래서 429는 공급자를 통째로 건너뛴다.
 */
export type ProviderFailureScope = 'model' | 'provider' | 'transient'

export function classifyProviderError(err: unknown): {
  message: string
  fatalModel: boolean
  availability?: 'limited' | 'unavailable'
  scope: ProviderFailureScope
} {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (raw.includes('limit: 0') || raw.includes('quota') || raw.includes('429') || raw.includes('resource_exhausted')) {
    const zero = raw.includes('limit: 0')
    return {
      message: zero
        ? '이 모델은 현재 요금제에서 사용할 수 없습니다. 다른 모델을 선택하세요.'
        : 'AI 사용량 한도를 초과했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.',
      fatalModel: zero,
      availability: zero ? 'unavailable' : 'limited',
      // limit: 0 은 "이 요금제가 이 모델을 안 준다" — 같은 키의 다른 모델은 멀쩡하다.
      // 그냥 429는 할당량 소진이라 같은 키의 다른 모델도 함께 죽어 있다.
      scope: zero ? 'model' : 'provider',
    }
  }
  if (raw.includes('404') || raw.includes('not found') || raw.includes('no longer available') || raw.includes('is not supported')) {
    return { message: '이 모델은 더 이상 사용할 수 없습니다. 다른 모델을 선택하세요.', fatalModel: true, availability: 'unavailable', scope: 'model' }
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('api key') || raw.includes('permission')) {
    // 키가 문제라 모델을 바꿔 봐야 같은 답이 온다 — 공급자를 통째로 건너뛴다
    return { message: 'AI 키 인증에 문제가 있습니다. 관리자에게 문의하세요.', fatalModel: false, scope: 'provider' }
  }
  return { message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.', fatalModel: false, scope: 'transient' }
}
