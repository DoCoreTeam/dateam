/**
 * 모델 고르기가 무엇을 보여 줄지 — **`server-only` 밖에 있다**
 *
 * 판정은 여기 순수 함수에 있고, 화면은 그리기만 하고, 창구는 읽기만 한다.
 * 셋이 각자 판정하면 「화면은 고를 수 있다고 하는데 저장이 거절된다」가 생긴다.
 */

/** 모델 목록 한 줄. 화면이 쓰는 것만 */
export interface JudgeModelRow {
  provider: string
  modelId: string
  label: string | null
  availability: string | null
}

export type PickState =
  /** 고를 수 있다 */
  | { kind: 'ready'; count: number }
  /** 이 공급자에 키가 없다 — 등록이 먼저다 */
  | { kind: 'no_key' }
  /** 키는 있는데 목록이 비었다 — 새로고침이 먼저다 */
  | { kind: 'empty' }
  /** 못 읽었다. **빈 목록과 다른 사실이다** */
  | { kind: 'failed'; reason: string }

/**
 * 지금 무엇을 말해야 하나.
 *
 * **「모델이 없습니다」로 뭉치지 않는다.** 키가 없는 것과, 목록을 아직 안 받은 것과,
 * 못 읽은 것은 조치가 전부 다르다. 뭉치면 사람은 셋 중 아무거나 시도한다.
 */
export function pickState(input: {
  hasKey: boolean
  rows: readonly JudgeModelRow[] | null
  error: string | null
  provider: string
}): PickState {
  if (input.error) return { kind: 'failed', reason: input.error }
  if (!input.hasKey) return { kind: 'no_key' }
  if (!input.rows) return { kind: 'failed', reason: 'not_loaded' }
  const mine = input.rows.filter((r) => r.provider === input.provider)
  return mine.length > 0 ? { kind: 'ready', count: mine.length } : { kind: 'empty' }
}

export const PICK_STATE_LABEL: Record<PickState['kind'], string> = {
  ready: '',
  no_key: '이 공급자의 키가 아직 없습니다',
  empty: '이 공급자의 모델 목록이 아직 없습니다',
  failed: '모델 목록을 읽지 못했습니다',
}

export const PICK_STATE_REMEDY: Record<PickState['kind'], string> = {
  ready: '',
  no_key: '시스템 설정의 AI 공급자에서 키를 먼저 등록해 주세요',
  empty: '고르기 창에서 모델 새로고침을 한 번 눌러 주세요',
  failed: '잠시 뒤 다시 열어 주세요',
}

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
