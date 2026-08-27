/**
 * 5축의 말과 색 — SSOT (용어집 §04)
 *
 * **왜 옮겼나**: 같은 축을 두 화면이 **다른 말로** 부르고 있었다 —
 * 인박스는 RISK 를 「무엇이 막나」, 미팅 상세는 「걸림돌」이라고 했다.
 * 같은 제안을 두 화면에서 보면 다른 것처럼 읽힌다. 축 이름은 한 곳에서만 온다.
 *
 * `status` 가 `StatusKey` 라 **색이 자동으로 따라온다** — 화면이 색을 고르지 않는다.
 */

import type { StatusKey } from '../../tokens/status-colors.ts'

/** 스키마 `CrmSuggestionAxis` 와 정확히 같은 다섯. 여기에 없는 축은 DB 에도 없다 */
export type SuggestionAxis = 'WHO' | 'WHAT' | 'WHERE' | 'RISK' | 'NEXT'

export const AXIS_META: Record<SuggestionAxis, { label: string; status: StatusKey }> = {
  /** 누가 관여하나 */
  WHO: { label: '누가', status: 'doing' },
  /** 무엇을 얼마에 파나 */
  WHAT: { label: '무엇을', status: 'planned' },
  /** 지금 어디까지 왔나 */
  WHERE: { label: '어디까지', status: 'note' },
  /** 이 딜을 흔드는 것 */
  RISK: { label: '걸림돌', status: 'blocker' },
  /** 그래서 다음에 뭘 하나 */
  NEXT: { label: '다음에', status: 'done' },
}

/** 미팅에서 읽어 내는 순서 — 사람이 회의를 되짚는 순서다 */
export const AXIS_ORDER: SuggestionAxis[] = ['WHO', 'WHAT', 'WHERE', 'RISK', 'NEXT']

/**
 * 모르는 축이 와도 화면을 비우지 않는다 — 스키마가 늘었는데 여기를 안 고쳤을 때
 * 빈 칸을 보여 주느니 코드값이라도 보여 주는 편이 사람이 원인을 찾기 쉽다.
 */
export function axisMeta(axis: string): { label: string; status: StatusKey } {
  return AXIS_META[axis as SuggestionAxis] ?? { label: axis, status: 'note' }
}
