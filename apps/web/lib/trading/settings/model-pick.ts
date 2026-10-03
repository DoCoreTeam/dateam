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
import { ACTION } from '../../terms/action.ts'

export const NO_KEY_WHY = '아직 쓸 수 있는 AI 공급자가 없습니다'
export const NO_KEY_HOW = '시스템 설정의 AI 공급자에서 키를 먼저 등록해 주세요'

export const MODEL_PICK = `모델 ${ACTION.select}`
export const MODEL_LIST_FETCH = '모델 목록 받기'
export const MODEL_LIST_FETCHING = '목록을 받는 중…'

/**
 * 모델을 만들지 않고 **여러 벤더 앞에 서는 관문**. 이름이 `벤더/모델` 꼴이라
 * 다른 공급자의 이름을 그대로 넣으면 관문이 모르는 이름이 된다 (실측 2026-09-28 jev 403)
 */
export const GATEWAY_PROVIDERS: readonly string[] = ['jev']
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
  /**
   * 키는 있는데 **이 판에서는 안 쓴다** (운영 키를 개발 판이 집지 않게 하는 규칙).
   *
   * 실측 2026-09-28: Jev 키가 등록돼 있는데 화면은 「키가 없어 판단을 못 부릅니다」를
   * 말했다. 조치가 정반대다 — 「키를 넣으세요」는 이미 넣은 사람에게 할 말이 아니다.
   */
  | 'provider_key_not_for_this_env'
  /**
   * 키는 있는데 **안 쓰기로 해 뒀다** (관리자가 그 공급자를 끔).
   *
   * 「키가 없다」와 할 일이 정반대다 — 저쪽은 키를 넣어야 하고 이쪽은 스위치를 켜야 한다.
   * 섞어 적으면 이미 있는 키를 또 넣으려 든다.
   */
  | 'provider_disabled'
  /** 그 모델은 다른 공급자 것이다 */
  | 'model_elsewhere'
  /** 고른 공급자의 목록에 그 이름이 없다 */
  | 'model_unknown'
  /**
   * 그 공급자의 모델을 **한 번도 받아 온 적이 없다.**
   *
   * 실측 2026-09-28: `ai_model_catalog` 의 jev 모델이 0개인데 화면은
   * 「공급자를 바꾸거나 다른 모델을 고르세요」라고 말했다 — 고를 것이 하나도 없는데.
   * 고칠 수 없는 것을 고치라고 말하는 화면은 없느니만 못하다.
   */
  | 'catalog_empty'

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
  /**
   * 공급자마다 왜 쓸 수 있나 없나. 창구가 `resolveProviderKey` 에서 그대로 옮겨 준다.
   * **키 값이 아니라 사유 글자다.** 안 주면 예전처럼 있음·없음 둘로만 본다
   */
  keyState?: Readonly<Record<string, 'pool' | 'meta' | 'no_key' | 'env_blocked' | 'disabled'>>
  /** 「이 판에서는 운영 키를 안 씁니다」를 뭐라고 말하나. 문장은 한 곳에만 둔다 */
  envBlockedText?: string
  /**
   * 이 공급자의 모델 이름이 `벤더/모델` 꼴인가 (관문이 그렇다).
   * 지금 값이 그 꼴이 아니면 그것이 「없는 이름」의 이유다 — 짐작이 아니라 사실을 말한다
   */
  slashModelIds?: boolean
}

export function pickTroubles(s: ModelPickState): ModelPickTrouble[] {
  const name = s.providerName ?? ((id: string) => id)

  // 아무 데도 키가 없으면 그것 하나만 말한다. 나머지는 그 뒤의 이야기다
  if (s.withKey.length === 0) {
    return [{ kind: 'no_provider_at_all', why: NO_KEY_WHY, how: NO_KEY_HOW }]
  }

  const out: ModelPickTrouble[] = []

  if (!s.withKey.includes(s.provider)) {
    /**
     * **키가 없는 것과 이 판에서 안 쓰는 것을 가른다.**
     * 둘 다 「못 부른다」지만 할 일이 정반대라, 같은 말로 뭉치면 이미 키를 넣은 사람이
     * 키를 또 넣는다 (실측 2026-09-28).
     */
    const state = s.keyState?.[s.provider]
    if (state === 'disabled') {
      // 키는 멀쩡하다. 끈 것이다 — 「키를 넣으세요」는 할 말이 아니다
      out.push({
        kind: 'provider_disabled',
        why: `${name(s.provider)} 공급자를 안 쓰기로 해 두었습니다`,
        how: '관리자 설정에서 그 공급자를 다시 켜면 쓸 수 있습니다',
      })
    } else {
      out.push(state === 'env_blocked'
        ? {
          kind: 'provider_key_not_for_this_env',
          why: `${name(s.provider)} 키는 있지만 이 판에서는 쓰지 않습니다`,
          how: s.envBlockedText ?? '이 판에서 쓸 키를 따로 등록하면 켜집니다',
        }
        : {
          kind: 'provider_has_no_key',
          why: `${name(s.provider)}에 키가 없어 판단을 못 부릅니다`,
          how: `키가 있는 공급자: ${s.withKey.map(name).join(', ')}`,
        })
    }
  }

  /**
   * **목록이 비었으면 「다른 것을 고르라」고 하지 않는다.**
   * 고를 것이 없는데 고르라고 하는 것은 할 일을 알려 주는 것이 아니라 떠넘기는 것이다.
   */
  const mine = s.catalog.filter((c) => c.provider === s.provider)
  if (mine.length === 0) {
    out.push({
      kind: 'catalog_empty',
      why: `${name(s.provider)}의 모델 목록을 아직 안 받았습니다`,
      how: s.slashModelIds
        ? '목록 받기를 누르면 관문이 아는 모델을 받아 옵니다 (이름이 벤더/모델 꼴입니다)'
        : '목록 받기를 누르면 고를 수 있습니다',
    })
    return out
  }

  // 아직 안 골랐으면 **지어내지 않는다** — 모르는 것은 모르는 것이다
  if (s.model === '') return out

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
      how: s.slashModelIds && !s.model.includes('/')
        // 관문 이름은 `벤더/모델` 꼴이다. 그 꼴이 아니면 그것이 바로 이유다
        ? `${name(s.provider)}는 관문이라 이름이 벤더/모델 꼴입니다 (예: google/gemini-2.5-flash). ${MODEL_PICK}에서 다시 골라 주세요`
        : `${MODEL_PICK}에서 다시 골라 주세요`,
    })
  }
  return out
}
