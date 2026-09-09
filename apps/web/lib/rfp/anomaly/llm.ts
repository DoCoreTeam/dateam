/**
 * 이상 조항 AI 층 (설계서 3.8.4)
 *
 * ## AI 가 여기서 하는 일은 «찾기» 뿐이다
 *
 * 규칙이 못 잡는 것은 있다 — 「사실상 한 업체만 가능한 조건들의 조합」 같은 것.
 * 그런데 AI 가 그것을 **판단하게 두면** 판단을 검증할 수 없고, 그 판단이 화면에서
 * 규칙의 판정과 같은 무게로 보인다. 그래서 AI 층 단독 발견은 **언제나 의심**이다.
 *
 * ## 업체명을 못 쓰게 막는다
 *
 * 프롬프트로 부탁하는 것으로는 부족하다. 모델은 부탁을 잊는다.
 * 그래서 **출력에서 걸러낸다** — 단정하는 표현이 들어오면 그 후보를 버린다.
 */

import type { AnomalySeverity } from './rules.ts'

export interface LlmCandidate {
  title: string
  rationale: string
  severity: AnomalySeverity
  blockIds: string[]
  quote: string
  modelId: string
}

/**
 * 단정하는 표현.
 *
 * 이 말들이 들어오면 그 후보를 **버린다.** 고쳐 쓰지 않는 이유:
 * 문장을 다듬어도 그 후보가 담고 있던 판단은 그대로 남는다.
 */
const ASSERTIVE_PATTERNS: readonly RegExp[] = [
  /특정\s*업체.{0,6}(유리|맞춤|위한)/,
  /(만을?|만이)\s*(수행|참여|충족)할\s*수\s*있/,
  /특혜/,
  /밀어주/,
  /짜고|담합/,
  /위법|불법|법령\s*위반/,
  /[가-힣A-Za-z]+(주식회사|㈜|\s?Inc\.?|\s?Corp\.?)\s*(를|을|이|가)?\s*(위한|겨냥)/,
]

/** 이 문장이 단정하는가 */
export function isAssertive(text: string): boolean {
  return ASSERTIVE_PATTERNS.some((re) => re.test(text))
}

export interface LlmFilterResult {
  kept: LlmCandidate[]
  /** 버린 후보와 이유 — 몇 건이 걸렸는지 남겨야 프롬프트를 고칠 수 있다 */
  dropped: { candidate: LlmCandidate; reason: 'assertive' | 'no_evidence' | 'short_quote' }[]
}

/** 인용이 이보다 짧으면 근거로 안 본다 */
export const MIN_LLM_QUOTE = 20

/**
 * AI 가 낸 후보를 거른다.
 *
 * 프롬프트로 부탁하는 것으로는 부족하다 — 모델은 부탁을 잊는다.
 */
export function filterCandidates(candidates: readonly LlmCandidate[]): LlmFilterResult {
  const kept: LlmCandidate[] = []
  const dropped: LlmFilterResult['dropped'] = []

  for (const c of candidates) {
    if (isAssertive(`${c.title} ${c.rationale}`)) {
      dropped.push({ candidate: c, reason: 'assertive' })
      continue
    }
    if (c.blockIds.length === 0) {
      // 근거 없는 이상 조항은 소문이다
      dropped.push({ candidate: c, reason: 'no_evidence' })
      continue
    }
    if (c.quote.trim().length < MIN_LLM_QUOTE) {
      dropped.push({ candidate: c, reason: 'short_quote' })
      continue
    }
    kept.push(c)
  }
  return { kept, dropped }
}

/** AI 층 프롬프트 — 무엇을 찾을지와 무엇을 쓰지 말지 */
export function buildAnomalyInstruction(): string {
  return [
    '아래 공고문에서 참여자에게 불리하거나 경쟁을 좁힐 수 있는 조항 후보를 찾는다.',
    '',
    '지켜야 할 것',
    '1. 원문 인용을 20자 이상 붙이고 블록 ID 를 적는다',
    '2. 특정 업체가 유리하다거나 특정 업체만 가능하다고 쓰지 않는다',
    '3. 위법·불법이라고 쓰지 않는다. 관측된 사실만 적는다',
    '4. 확신이 없으면 후보로 내지 않는다',
    '',
    '쓸 수 있는 문장의 예: 「요구 인증 3종을 모두 보유한 업체가 드물다」',
    '쓸 수 없는 문장의 예: 「이 조항은 특정 업체를 위한 것이다」',
  ].join('\n')
}
