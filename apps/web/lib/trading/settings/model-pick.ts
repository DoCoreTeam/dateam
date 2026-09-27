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

/* ── 지금 고른 쌍이 실제로 돌 수 있나 ─────────────────── */

/**
 * **고를 수 있는 것과 도는 것은 다르다.**
 *
 * 실측 2026-09-28: 판단 공급자가 `jev`, 판단 모델이 `gemini-3.6-flash` 로 저장돼 있었고
 * `ai_provider_keys` 에 `jev` 키는 0개였다(gemini 4 · groq 1 · openai 1). 화면에는
 * 「jev · gemini-3.6-flash」가 멀쩡히 적혀 있었고, 판단은 한 건도 안 남았다.
 * 값이 비어 있으면 사람이 알아채지만 **채워져 있는데 안 도는 것**은 아무도 못 본다.
 *
 * 그래서 고른 자리가 스스로 말한다 — 창을 열지 않아도.
 */
export type ModelPickTroubleKind =
  /** 키가 등록된 공급자가 하나도 없다 */
  | 'no_provider_at_all'
  /** 고른 공급자에 키가 없다 */
  | 'provider_has_no_key'
  /** 그 모델은 다른 공급자 것이다 */
  | 'model_elsewhere'
  /** 고른 공급자의 목록에 그 이름이 없다 */
  | 'model_unknown'

export interface ModelPickTrouble {
  kind: ModelPickTroubleKind
  /** 무엇이 막혔나 */
  why: string
  /** 무엇을 하면 풀리나 */
  how: string
}

export interface ModelPickState {
  provider: string
  model: string
  /**
   * 키가 등록된 공급자. **값이 아니라 있음·없음만** 온다 —
   * 비밀을 개수로만 답하는 규칙이 여기서 끝나야 화면까지 안 샌다
   */
  withKey: readonly string[]
  /** 고를 수 있는 모델. 못 읽었으면 빈 배열이고, 그때는 아무 판정도 안 한다 */
  catalog: readonly { provider: string; modelId: string }[]
  /** 공급자를 사람이 부르는 이름으로. 표를 이 모듈에 두지 않는다 */
  providerName?: (id: string) => string
}

export function pickTroubles(s: ModelPickState): ModelPickTrouble[] {
  const name = s.providerName ?? ((id: string) => id)

  // 아무 데도 키가 없으면 그것 하나만 말한다. 나머지는 그 뒤의 이야기다
  if (s.withKey.length === 0) {
    return [{ kind: 'no_provider_at_all', why: NO_KEY_WHY, how: NO_KEY_HOW }]
  }

  const out: ModelPickTrouble[] = []

  if (!s.withKey.includes(s.provider)) {
    out.push({
      kind: 'provider_has_no_key',
      why: `${name(s.provider)}에 키가 없어 판단을 못 부릅니다`,
      how: `키가 있는 공급자: ${s.withKey.map(name).join(', ')}`,
    })
  }

  // 아직 안 골랐거나 목록을 못 읽었으면 **지어내지 않는다** — 모르는 것은 모르는 것이다
  if (s.model === '' || s.catalog.length === 0) return out

  const here = s.catalog.some((c) => c.provider === s.provider && c.modelId === s.model)
  if (here) return out

  const elsewhere = [...new Set(s.catalog.filter((c) => c.modelId === s.model).map((c) => c.provider))]
  if (elsewhere.length > 0) {
    out.push({
      kind: 'model_elsewhere',
      /** 조사를 변수 뒤에 안 붙인다 — 모델 이름은 영문이라 「이/가」가 반반씩 틀린다 */
      why: `${name(s.provider)}에는 ${s.model} 모델이 없습니다`,
      how: `이 모델은 ${elsewhere.map(name).join(', ')} 쪽에 있습니다. 공급자를 바꾸거나 다른 모델을 고르세요`,
    })
  } else {
    out.push({
      kind: 'model_unknown',
      why: `${name(s.provider)}의 모델 목록에 없는 이름입니다 (${s.model})`,
      how: '모델 고르기에서 다시 골라 주세요',
    })
  }
  return out
}
