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
 * - `key`      **이 키로는** 뭘 해도 안 된다(429 한도 · 401 인증). 같은 공급자라도 다른 키면 산다
 * - `provider` 이 공급자로는 뭘 해도 안 된다
 * - `transient` 원인 불명. 이 후보만 건너뛴다
 *
 * `key` 가 `provider` 에서 갈라져 나온 이유:
 * 무료 티어 한도는 **키(프로젝트) 단위**로 걸린다(실측 2026-08-27, lib/ai/fallback-text.ts).
 * 모델을 갈아타도 같은 키면 함께 소진돼서 flash 계열 3종이 동시에 429였다.
 * 그때는 키가 공급자당 하나뿐이라 「키가 죽음 = 공급자가 죽음」이었고 한 값으로 써도 같았다.
 * 이제 키를 여러 개 두므로(ai_provider_keys) 둘은 다른 말이다 — 키가 마르면
 * **같은 공급자의 다음 키**로 이어 가고, 그 공급자의 키가 다 마른 뒤에야 공급자를 뺀다.
 */
export type ProviderFailureScope = 'model' | 'key' | 'provider' | 'transient'

/**
 * 이 실패가 **그 키를 어떻게 만들었나** — `lib/ai/key-pool.ts` 의 `KeyOutcome` 중
 * 키 상태를 실제로 바꾸는 둘이다. 기다리면 풀리는 것(`quota`)과 사람이 고쳐야 하는 것(`auth`).
 *
 * 왜 `availability` 로 못 읽나: 저건 `ai_model_catalog` 에 쓰는 **모델의** 상태다.
 * 키가 말랐다고 모델을 「제한됨」으로 적으면 다른 키를 가진 사람에게도 그 모델이 내려간다.
 *
 * `scope` 가 `key` 일 때만 있다. 404 는 키가 멀쩡한데 모델이 없어진 것이라 여기 해당이 없다 —
 * 그때 키에 쉬는 시간을 매기면 멀쩡한 키가 애먼 벌을 받는다.
 */
export type KeyFailureOutcome = 'quota' | 'auth'

export function classifyProviderError(err: unknown): {
  message: string
  fatalModel: boolean
  availability?: 'limited' | 'unavailable'
  scope: ProviderFailureScope
  /** scope 가 'key' 일 때 그 키를 어떻게 처리할지. 아니면 없음 */
  keyOutcome?: KeyFailureOutcome
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
      // 그냥 429는 할당량 소진이라 **그 키로는** 어느 모델을 불러도 같이 막혀 있다.
      scope: zero ? 'model' : 'key',
      ...(zero ? {} : { keyOutcome: 'quota' as const }),
    }
  }
  if (raw.includes('404') || raw.includes('not found') || raw.includes('no longer available') || raw.includes('is not supported')) {
    return { message: '이 모델은 더 이상 사용할 수 없습니다. 다른 모델을 선택하세요.', fatalModel: true, availability: 'unavailable', scope: 'model' }
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('api key') || raw.includes('permission')) {
    // 모델을 바꿔 봐야 같은 답이 온다. 기다려도 안 풀리니 그 키는 사람이 고칠 때까지 멈춘다
    return { message: 'AI 키 인증에 문제가 있습니다. 관리자에게 문의하세요.', fatalModel: false, scope: 'key', keyOutcome: 'auth' }
  }
  return { message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.', fatalModel: false, scope: 'transient' }
}
