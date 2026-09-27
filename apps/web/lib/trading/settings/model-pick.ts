/**
 * 모델 고르기가 무엇을 보여 줄지 — **`server-only` 밖에 있다**
 *
 * 판정은 여기 순수 함수에 있고, 화면은 그리기만 하고, 창구는 읽기만 한다.
 * 셋이 각자 판정하면 「화면은 고를 수 있다고 하는데 저장이 거절된다」가 생긴다.
 */

/**
 * **「모델이 없습니다」로 뭉치지 않는다.**
 *
 * 목록이 비었는지·못 읽었는지·막힌 모델이 몇 개인지는 공용 모달
 * (`components/ui/ModelPickerModal`)이 가려 말한다 — 연동 카드와 같은 말을 쓴다.
 * 여기 남는 것은 그 모달이 모르는 사실 하나뿐이다: **고를 공급자가 아예 없다.**
 */
export const NO_KEY_WHY = '아직 쓸 수 있는 AI 공급자가 없습니다'
export const NO_KEY_HOW = '시스템 설정의 AI 공급자에서 키를 먼저 등록해 주세요'

export const MODEL_PICK = '모델 고르기'
export const MODEL_NOT_PICKED = '아직 안 골랐습니다'

/* ── 공급자와 모델은 한 벌이다 ─────────────────────────── */

/**
 * 어떤 설정 쌍이 「공급자 + 모델」인가.
 *
 * **쌍으로 둔다.** 모델만 바꾸고 공급자가 그대로면 그 공급자에 없는 모델을 가리키게 되고,
 * 화면에는 이름이 멀쩡히 적혀 있는데 판단은 한 건도 안 남는다. 둘은 같이 바뀌어야 한다.
 */
export interface ModelPair {
  providerKey: string
  modelKey: string
}

export const MODEL_PAIRS: readonly ModelPair[] = [
  { providerKey: 'jev_provider', modelKey: 'jev_model' },
  { providerKey: 'knowledge_provider', modelKey: 'knowledge_model' },
]

/** 이 설정이 모델 쪽인가. 화면이 그 자리만 고르기로 그린다 */
export function pairForModelKey(key: string): ModelPair | null {
  return MODEL_PAIRS.find((p) => p.modelKey === key) ?? null
}

/** 탭에 세울 공급자 — **키가 등록된 것만.** 없는 키를 고르면 그 자리는 영영 안 돈다 */
export function tabsFor(all: readonly string[], withKey: readonly string[]): string[] {
  return all.filter((id) => withKey.includes(id))
}
