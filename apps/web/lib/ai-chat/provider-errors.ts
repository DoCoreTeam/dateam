// 프로바이더 에러 → 사용자 친절 메시지 매핑(SSOT, 순수·테스트 대상).
// fatalModel=이 모델이 근본적으로 못 쓰는 상태(404 삭제/미지원 · 할당량 0) → 카탈로그에서 비활성화 대상.
// "AI 응답 생성 실패" 같은 무의미 메시지 금지 — 사유별 액션 가능한 안내.

export function classifyProviderError(err: unknown): { message: string; fatalModel: boolean } {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (raw.includes('limit: 0') || raw.includes('quota') || raw.includes('429') || raw.includes('resource_exhausted')) {
    const zero = raw.includes('limit: 0')
    return {
      message: zero
        ? '이 모델은 현재 요금제에서 사용할 수 없습니다. 다른 모델을 선택하세요.'
        : 'AI 사용량 한도를 초과했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.',
      fatalModel: zero,
    }
  }
  if (raw.includes('404') || raw.includes('not found') || raw.includes('no longer available') || raw.includes('is not supported')) {
    return { message: '이 모델은 더 이상 사용할 수 없습니다. 다른 모델을 선택하세요.', fatalModel: true }
  }
  if (raw.includes('401') || raw.includes('403') || raw.includes('api key') || raw.includes('permission')) {
    return { message: 'AI 키 인증에 문제가 있습니다. 관리자에게 문의하세요.', fatalModel: false }
  }
  return { message: 'AI 응답을 생성하지 못했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.', fatalModel: false }
}
