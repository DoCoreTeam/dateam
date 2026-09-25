/**
 * 트레이딩 지식이 AI 원장에 남기는 이름 — **순수하게 둔다**
 *
 * `ai-call.ts` 는 `server-only` 라 시험이 import 할 수 없다. 이름을 그 안에 두면
 * 「표면이 하나인가」를 시험으로 못 묻고, 못 묻는 규칙은 언젠가 갈라진다.
 */

/**
 * 표면 이름 **하나**.
 *
 * 기능이 여섯인데 저마다 다른 이름을 쓰면 「트레이딩이 AI 를 얼마나 썼나」를 한 번에 못 센다.
 * 실측 전례: 상한을 아는 자리가 0곳이라 하루 23,318건이 나갔고 22,131건은 어차피 한도로 실패했다.
 */
export const KNOWLEDGE_SURFACE = 'trading_knowledge'

/** 무엇을 하는 호출인가. 원장이 기능별로 갈라 셀 수 있게 */
export const KNOWLEDGE_PURPOSES = [
  'knowledge_card', 'source_analysis', 'pattern_report',
  'spec_candidate', 'signal_explain', 'setting_help',
] as const
export type KnowledgePurpose = (typeof KNOWLEDGE_PURPOSES)[number]

/** 원장에 적히는 기능 이름. 배경 작업이라 이 이름이 주인을 대신한다 */
export function knowledgeFeature(purpose: KnowledgePurpose): string {
  return `${KNOWLEDGE_SURFACE}:${purpose}`
}
