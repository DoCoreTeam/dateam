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
