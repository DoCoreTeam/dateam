// 통합 입력 — 신뢰도 자동 게이트 (3구간 분류)
//
// AI 추출 결과를 신뢰도(0~100)로 3구간 분류해 검토 피로를 제거:
//   ≥90  → auto   : 자동 확정 후보(사람은 안 봐도 됨, 사후 감사 'auto')
//   70~90 → review : 사람 검토 필요(이 구간만 본다)
//   <70  → block  : 보류(모델 미상 등 — 확정 불가)
// 자기완결 모듈(외부 import 없음) — node:test 단위 테스트 대상.

export type ConfidenceBand = 'auto' | 'review' | 'block'

export const CONFIDENCE_AUTO_MIN = 90
export const CONFIDENCE_REVIEW_MIN = 70

/** 신뢰도 점수(0~100) → 3구간. 범위 밖 입력은 안전하게 클램프. */
export function classifyConfidence(score: number): ConfidenceBand {
  const s = Number.isFinite(score) ? Math.min(Math.max(score, 0), 100) : 0
  if (s >= CONFIDENCE_AUTO_MIN) return 'auto'
  if (s >= CONFIDENCE_REVIEW_MIN) return 'review'
  return 'block'
}

export interface ConfidenceItem {
  /** 0~100 */
  confidence: number
}

export interface ConfidencePartition<T extends ConfidenceItem> {
  auto: T[]
  review: T[]
  block: T[]
}

/** 항목 배열을 신뢰도 3구간으로 분할. 입력 배열은 변형하지 않음(불변). */
export function partitionByConfidence<T extends ConfidenceItem>(items: readonly T[]): ConfidencePartition<T> {
  const result: ConfidencePartition<T> = { auto: [], review: [], block: [] }
  for (const item of items) {
    result[classifyConfidence(item.confidence)].push(item)
  }
  return result
}

/** 구간별 라벨(화면 표기용). */
export function bandLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'auto': return '자동 확정 후보'
    case 'review': return '검토 필요'
    case 'block': return '차단'
  }
}
