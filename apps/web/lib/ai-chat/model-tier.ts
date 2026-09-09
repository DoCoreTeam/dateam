// 모델을 **성능 성격**으로 묶는다 (SSOT, 순수 함수)
//
// ## 왜 공급자로 안 묶나
//
// 고르는 사람이 알고 싶은 것은 "누가 만들었나"가 아니라 **"얼마나 잘하나, 얼마나 빠른가"**다.
// 공급자로 묶으면 Gemini 28개가 한 덩어리로 쏟아지고 그 안에서 다시 골라야 한다.
// claude.ai 가 모델을 「가장 강력 / 균형 / 빠름」으로 세우는 것과 같은 이유다.
//
// ## 판정 근거
//
// 카탈로그에 성능 등급 칼럼이 없다. 있는 것은 이름과 능력 플래그와 컨텍스트 길이뿐이다.
// 그래서 **이름의 관용어**로 가른다 — 공급자들이 실제로 그렇게 이름을 짓는다
// (pro·opus·ultra = 무거운 쪽, flash·lite·mini·haiku·turbo = 가벼운 쪽).
// 이름으로 못 가르면 능력 플래그(reasoning)를 본다. 둘 다 아니면 범용이다.
//
// 틀릴 수 있는 판정이라 **감추는 데 쓰지 않는다** — 순서를 정하는 데만 쓴다.
// 잘못 묶여도 모델은 전부 목록에 있고, 사용자가 눌러서 고를 수 있다.

export type ModelTier = 'reasoning' | 'balanced' | 'fast'

/** 위에서부터 이 순서로 세운다 — 잘하는 것이 먼저다 */
export const MODEL_TIER_ORDER: readonly ModelTier[] = ['reasoning', 'balanced', 'fast']

export const MODEL_TIER_LABEL: Record<ModelTier, string> = {
  reasoning: '고성능',
  balanced: '범용',
  fast: '빠름',
}

export const MODEL_TIER_HINT: Record<ModelTier, string> = {
  reasoning: '어려운 추론·분석·코딩',
  balanced: '일상 대화와 문서 작업',
  fast: '간단한 질문·분류·대량 처리',
}

/**
 * ⚠️ 낱말 경계가 필수다. 경계 없이 `mini` 를 찾으면 **`gemini` 가 걸린다** —
 * 그러면 Gemini 전 모델이 「빠름」으로 내려가 순서가 통째로 거짓말을 한다(테스트로 잡았다).
 * 모델 이름은 `-` `_` `.` 로 마디를 나누므로 그 앞자리만 본다.
 */
const FAST_RE = /(^|[-_. ])(flash|lite|mini|haiku|turbo|nano|small|8b|instant)/i
const HEAVY_RE = /(^|[-_. ])(pro|opus|ultra|thinking|max|o1|o3|reason)/i

/**
 * 대화에 쓸 모델인가.
 *
 * 실측 v0.7.716: 폴백이 `gemma-4-26b-a4b-it` 로 갈아탄 뒤 **모델이 자기 초안을 답으로 뱉었다**
 * ("User input: … Intent: … Option 1 (Literal): … Option 2 …" 를 그대로 화면에 적었다).
 * Gemma 는 공개가중치 instruct 계열이라 이 앱이 기대하는 대화 규약을 안 지킨다
 * (같은 이유로 v0.7.571 에서 JSON 모드를 조용히 무시한 전적이 있다 — lib/ai/gemini-model).
 *
 * 임베딩·이미지·영상·음성 모델도 카탈로그에 함께 실린다. 대화 후보가 아니다.
 * **자동 폴백이 이런 것을 고르면 사용자는 고장으로 읽는다.** 그래서 후보에서 뺀다.
 */
export function isChatModel(m: TierInput): boolean {
  const id = m.modelId.toLowerCase()
  // 양쪽 경계를 다 본다 — 앞만 보면 `my-gemmalike-model` 같은 남의 이름까지 잡는다
  if (/(^|[-_./])gemma([-_.\d]|$)/.test(id)) return false
  return !/(embedding|imagen|veo|tts|aqa|image-gen|vision-only)/.test(id)
}

export interface TierInput {
  modelId: string
  label?: string | null
  capabilities?: { reasoning?: boolean } | null
}

/**
 * 가벼운 쪽 이름이 먼저다 — `gemini-2.5-flash-lite` 처럼 **둘 다 들어간 이름**이 있다.
 * 그때 무거운 쪽으로 읽으면 빠른 모델이 맨 위에 서서 순서가 거짓말을 한다.
 */
export function modelTier(m: TierInput): ModelTier {
  const name = `${m.modelId} ${m.label ?? ''}`
  if (FAST_RE.test(name)) return 'fast'
  if (HEAVY_RE.test(name)) return 'reasoning'
  if (m.capabilities?.reasoning === true) return 'reasoning'
  return 'balanced'
}

export interface SortableModel extends TierInput {
  /** 지금 고를 수 있는가 — 못 고르는 것은 순서와 무관하게 맨 뒤로 간다 */
  usable: boolean
}

/**
 * 메뉴에 세울 순서.
 *
 * 1. 쓸 수 있는 것이 먼저다 — 못 쓰는 것을 위에 두면 매번 지나쳐 내려가야 한다
 * 2. 그 안에서 고성능 → 범용 → 빠름
 * 3. 같은 칸 안에서는 들어온 순서를 지킨다(카탈로그가 최신순이다)
 */
export function sortModelsForMenu<T extends SortableModel>(models: readonly T[]): T[] {
  const rank = (m: T) => MODEL_TIER_ORDER.indexOf(modelTier(m))
  return models
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.usable !== b.m.usable) return a.m.usable ? -1 : 1
      const d = rank(a.m) - rank(b.m)
      return d !== 0 ? d : a.i - b.i
    })
    .map((x) => x.m)
}
