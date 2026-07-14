// AI 토큰 비용 추정 SSOT (세션 3 §5-4) — 순수 함수, 단위테스트 대상.
// 비용 대시보드(/admin/ai-usage 확장)가 이 단가표를 import해 추정 비용 컬럼을 렌더한다.
// 단가 = USD / 백만 토큰(MTok). 미등록 모델은 null(대시보드에서 '-' 표기).

export interface ModelPrice {
  in: number // 입력 백만 토큰당 USD
  out: number // 출력 백만 토큰당 USD
}

// 단가표(USD per MTok). 모델 id는 provider가 보고하는 표기와 정합.
export const PRICE_PER_MTOK: Record<string, ModelPrice> = {
  // Claude
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  // Gemini
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini-1.5-pro': { in: 1.25, out: 5 },
  'gemini-embedding-001': { in: 0.15, out: 0 },
  // OpenAI
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'o1': { in: 15, out: 60 },
  'o3-mini': { in: 1.1, out: 4.4 },
}

/**
 * 추정 비용(USD). 등록 모델이면 숫자, 미등록이면 null.
 * 계산: (promptTokens/1e6)*in + (outputTokens/1e6)*out.
 */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  outputTokens: number,
): number | null {
  const price = PRICE_PER_MTOK[model]
  if (!price) return null
  const p = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0
  const o = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0
  return (p / 1_000_000) * price.in + (o / 1_000_000) * price.out
}
