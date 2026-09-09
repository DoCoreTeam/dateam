/**
 * 자기 검토 패스 (설계서 3.6.4)
 *
 * ## 모델에게 자기 답을 다시 보게 하는 이유
 *
 * 뽑을 때는 «찾아라» 가 목표라 모델이 **없는 것도 만들어 채운다.**
 * 검토할 때는 «틀린 것을 찾아라» 가 목표라 같은 모델이 자기 답의 허점을 곧잘 짚는다.
 * 목표가 다르면 다른 답이 나온다.
 *
 * ## 그런데 자기 검토를 믿지는 않는다
 *
 * 자기 검토는 **근거 대조와 규칙 검증 뒤에** 돈다. 앞의 둘은 사실이고 이것은 의견이다.
 * 그래서 자기 검토가 「괜찮다」고 해도 앞에서 잡힌 것은 그대로 남는다.
 */

import type { RuleFinding } from './rule-verify.ts'
import type { ValueNode } from './schema.ts'
import type { GroundingResult } from './grounding.ts'

export type ReviewVerdict = 'keep' | 'lower_confidence' | 'drop_value'

export interface ReviewItem {
  field: string
  verdict: ReviewVerdict
  reason: string
}

export interface SelfReviewInput {
  field: string
  node: ValueNode<unknown>
  grounding: GroundingResult<unknown>
  rules: RuleFinding[]
}

/**
 * 검토가 필요한 값만 고른다.
 *
 * 전부 다시 물으면 비용이 두 배가 된다. **의심스러운 것만** 묻는다 —
 * 근거가 안 잡혔거나, 규칙이 짚었거나, 모델 스스로 확신이 낮다고 한 값.
 */
export function needsReview(input: SelfReviewInput): boolean {
  if (input.grounding.demoted) return true
  if (input.rules.some((r) => r.fields.some((f) => f.endsWith(input.field)))) return true
  if (input.node.confidence !== null && input.node.confidence < SELF_REVIEW_CONFIDENCE) return true
  return false
}

/** 이보다 확신이 낮으면 다시 본다 */
export const SELF_REVIEW_CONFIDENCE = 0.7

/**
 * 검토 결과를 값에 반영한다.
 *
 * `drop_value` 를 써도 **근거와 사유는 남긴다** — 값만 사라지고 왜 사라졌는지 없으면
 * 사용자는 시스템이 못 찾은 것으로 오해한다.
 */
export function applyReview(node: ValueNode<unknown>, item: ReviewItem): ValueNode<unknown> {
  switch (item.verdict) {
    case 'keep':
      return node
    case 'lower_confidence':
      return {
        ...node,
        confidence: node.confidence === null ? 0.4 : Math.min(node.confidence, 0.4),
      }
    case 'drop_value':
      return {
        ...node,
        value: null,
        grounding: 'unconfirmed',
        confidence: null,
        // 근거는 남긴다. 사람이 「모델은 여길 봤는데 아니라고 판단했구나」를 볼 수 있게
      }
  }
}

export interface SelfReviewPlan {
  /** 다시 볼 필드들 */
  fields: string[]
  /** 전부 다시 묻지 않고 이만큼만 */
  skipped: number
}

/** 한 번에 검토할 필드 수 상한 — 넘으면 확신이 낮은 것부터 */
export const MAX_REVIEW_FIELDS = 20

export function planSelfReview(inputs: readonly SelfReviewInput[]): SelfReviewPlan {
  const candidates = inputs.filter(needsReview)
  if (candidates.length <= MAX_REVIEW_FIELDS) {
    return { fields: candidates.map((c) => c.field), skipped: 0 }
  }
  const sorted = Array.from(candidates).sort((a, b) =>
    (a.node.confidence ?? 0) - (b.node.confidence ?? 0))
  return {
    fields: sorted.slice(0, MAX_REVIEW_FIELDS).map((c) => c.field),
    // 몇 개를 안 봤는지 남긴다 — 조용히 자르면 「전부 검토됨」으로 읽힌다
    skipped: candidates.length - MAX_REVIEW_FIELDS,
  }
}

/** 검토 프롬프트 — 뽑을 때와 목표가 달라야 다른 답이 나온다 */
export function buildReviewInstruction(fields: readonly string[]): string {
  return [
    '아래 값들은 같은 문서에서 방금 뽑은 것이다. 이번에는 **틀린 것을 찾는 것**이 목표다.',
    '각 값마다 다음을 판정한다.',
    '- keep: 원문 근거가 값을 그대로 뒷받침한다',
    '- lower_confidence: 근거가 약하거나 다르게 읽힐 여지가 있다',
    '- drop_value: 원문에 근거가 없다',
    '판정마다 사유를 한 문장으로 적는다. 사유 없이 keep 만 적지 않는다.',
    `볼 값: ${fields.join(', ')}`,
  ].join('\n')
}

export interface SelfReviewSummary {
  reviewed: number
  kept: number
  lowered: number
  dropped: number
  skipped: number
}

export function summarize(items: readonly ReviewItem[], skipped: number): SelfReviewSummary {
  return {
    reviewed: items.length,
    kept: items.filter((i) => i.verdict === 'keep').length,
    lowered: items.filter((i) => i.verdict === 'lower_confidence').length,
    dropped: items.filter((i) => i.verdict === 'drop_value').length,
    skipped,
  }
}
