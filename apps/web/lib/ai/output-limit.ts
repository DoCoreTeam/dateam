// lib/ai/output-limit.ts — 한 번의 답을 얼마나 길게 받을까, 생각을 시킬까 (순수 표)
//
// ## 왜 생겼나
//
// 출력 상한이 어디서나 32,768 이었다. 「생략하지 말라」는 정제 계약 때문에 길게 잡아 둔 값인데,
// 그 계약이 없는 일까지 전부 같은 상한을 썼다. 상한은 «최대»이지 «쓸 만큼»이 아니므로 대개는
// 안 채우지만, 모델은 상한이 넉넉하면 넉넉하게 답한다 — 상한 자체가 길이를 부른다.
//
// 생각 예산은 더 심했다. 끄는 자리가 **한 곳뿐**이었다(daily/flow-reason). 나머지는 전부
// 벤더 기본값으로 생각을 했고, 생각 토큰은 답에 안 보이면서 값은 그대로 나간다.
//
// ## 기본을 뒤집는다
//
// 생각은 **끄는 것이 기본**이고 켜는 능력만 목록에 적는다. 끄는 쪽을 기본으로 두면
// 빠뜨렸을 때 싸지고, 켜는 쪽을 기본으로 두면 빠뜨렸을 때 비싸진다. 빠뜨리는 일은 반드시
// 생기므로 어느 쪽으로 빠뜨릴지를 고르는 문제다.

import type { AiCapability } from '@ax/ai-core'

/**
 * 능력별 출력 상한.
 *
 * 잘리면 안 되는 일(사람이 그대로 쓰는 글, 받아쓰기)은 넉넉히, 짧게 끝나야 하는 일은
 * 짧게. 상한에 닿으면 잘렸다고 말하는 길이 이미 있으므로(gemini-call 의 truncated)
 * 낮게 잡아도 조용히 잘리지는 않는다.
 */
export const OUTPUT_LIMIT: Record<AiCapability, { tokens: number; why: string }> = {
  extract: { tokens: 8_192, why: '목록 추출은 항목 수만큼 길어진다, 잘리면 무손실 계약이 깨진다' },
  summarize: { tokens: 4_096, why: '요약이 원문만큼 길면 요약이 아니다' },
  judge: { tokens: 2_048, why: '판정과 근거 몇 줄이면 된다' },
  suggest: { tokens: 1_024, why: '후보 목록이고 사람이 고른다' },
  generate: { tokens: 16_384, why: '사람이 그대로 내보내는 글이다, 잘리면 못 쓴다' },
  answer: { tokens: 4_096, why: '답과 출처 목록, 길어지면 답이 아니라 요약이 된다' },
  transcribe: { tokens: 16_384, why: '받아쓰기는 말한 길이에 비례한다' },
  search: { tokens: 512, why: '순위와 한 줄 근거, 본문은 이미 우리가 들고 있다' },
}

/**
 * 생각을 시킬 능력.
 *
 * 여기 없는 능력은 생각 예산이 0 이다. 목록을 늘리려면 **왜 이 일에 생각이 필요한지**를
 * 적는다 — 생각 토큰은 답에 안 보이면서 값은 그대로 나가므로, 늘리는 쪽이 근거를 댄다.
 */
export const THINKING_ON: Partial<Record<AiCapability, string>> = {
  judge: '규칙과 대조해 참·거짓을 가르는 일이라 중간 단계가 답의 근거가 된다',
}

/** 생각 예산을 안 끄는 벤더 기본값에 기대지 않는다 — 0 을 명시한다 */
export const NO_THINKING = { thinkingBudget: 0 } as const

export interface GenerationConfig {
  maxOutputTokens: number
  thinkingConfig: { thinkingBudget: number } | { thinkingLevel: string }
}

/**
 * 이 능력의 생성 설정.
 *
 * 부르는 쪽이 값을 직접 주면 그것이 이긴다 — 이미 재어 보고 정한 값이 있는 자리가 있고
 * (daily/flow-reason 의 300토큰·생각 0 이 그렇다), 표가 그 값을 덮으면 잰 일이 사라진다.
 */
export function generationFor(
  capability: AiCapability,
  override?: { maxOutputTokens?: number; thinkingConfig?: GenerationConfig['thinkingConfig'] },
): GenerationConfig {
  return {
    maxOutputTokens: override?.maxOutputTokens ?? OUTPUT_LIMIT[capability].tokens,
    thinkingConfig: override?.thinkingConfig
      ?? (THINKING_ON[capability] ? { thinkingLevel: 'low' } : NO_THINKING),
  }
}

/** 표가 능력 여덟을 전부 덮고 있나 */
export function missingOutputLimits(all: readonly AiCapability[]): AiCapability[] {
  return all.filter((c) => !(c in OUTPUT_LIMIT))
}
