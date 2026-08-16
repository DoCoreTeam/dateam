/**
 * AI 판정 규칙 — 답을 데이터로 바꾸는 기준 (구현명세서 4.3)
 *
 * 이 파일이 CLAUDE_dacrm 절대규칙 1·2·3 을 코드로 만든 것이다.
 *   1. AI 출력은 코어 테이블에 직접 쓰지 않는다 → 여기서 나온 판정만이 반영 경로를 연다
 *   2. verifiedFields 에 등록된 필드는 **어떤 confidence 에서도** 자동 반영하지 않는다
 *   3. 금액·스테이지 전이·won/lost 는 auto_apply 대상이 될 수 없다 (코드 하드코딩)
 *
 * 규칙 3 이 설정이 아니라 코드인 이유: 설정으로 두면 언젠가 누가 켠다.
 * 금액이 사람 확인 없이 바뀌면 파이프라인 합계가 조용히 틀리고, 그 사실을 아무도 모른다.
 */

/** 명세 4.3 마지막 줄 — autoApply 설정 자체가 불가능한 필드 */
export const NEVER_AUTO_APPLY_FIELDS: ReadonlySet<string> = new Set([
  'amountMinor',
  'currency',
  'stageId',
  'status',
  'wonAt',
  'lostReason',
])

/** 명세 4.3 "confidence >= 0.6" — 이 아래는 저장조차 하지 않는다 */
export const MIN_SUGGESTION_CONFIDENCE = 0.6

/** ai_field_config.minConfidence 기본값 (스키마 @default(0.85)) */
export const DEFAULT_MIN_CONFIDENCE = 0.85

export type ApplyDecision = 'AUTO_APPLIED' | 'PENDING' | 'DISCARD'

export interface ApplyInput {
  confidence: number
  /** 갱신 대상 필드. 신규 생성 제안이면 없을 수 있다 */
  field?: string | null
  /** company | person | deal | deal_contact | task | meeting_summary */
  targetType: string
  /** 기존 레코드 갱신이 아니라 새 레코드를 만들자는 제안인가 */
  isNewRecord: boolean
  /** ai_field_config.autoApply */
  autoApply?: boolean
  /** ai_field_config.minConfidence */
  minConfidence?: number
  /** 사람이 검증 확정한 필드 목록 (레코드의 verifiedFields) */
  verifiedFields?: readonly string[]
}

export interface ApplyVerdict {
  decision: ApplyDecision
  /** 왜 그렇게 판정했는가 — 로그와 테스트용 식별자 */
  reason:
    | 'BELOW_THRESHOLD'
    | 'NEW_RECORD_NEEDS_HUMAN'
    | 'FIELD_NEVER_AUTO'
    | 'FIELD_VERIFIED_BY_HUMAN'
    | 'AUTO_APPLY_OFF'
    | 'BELOW_FIELD_CONFIDENCE'
    | 'AUTO_APPLIED'
}

/**
 * 명세 4.3 표를 위에서 아래로 그대로 판정한다.
 * 순서가 중요하다 — 위쪽 규칙이 아래쪽을 덮는다.
 */
export function decideApply(input: ApplyInput): ApplyVerdict {
  const {
    confidence, field, isNewRecord,
    autoApply = false,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    verifiedFields = [],
  } = input

  // 4.3-3행: confidence < 0.6 → 저장하지 않음 (ai_run outputJson 에만 남는다)
  if (confidence < MIN_SUGGESTION_CONFIDENCE) {
    return { decision: 'DISCARD', reason: 'BELOW_THRESHOLD' }
  }

  // 4.3-4행: 신규 레코드 생성 제안은 confidence 무관 항상 PENDING (자동 생성 금지)
  if (isNewRecord) {
    return { decision: 'PENDING', reason: 'NEW_RECORD_NEEDS_HUMAN' }
  }

  // 4.3-5행: 금액·스테이지 전이·won/lost 는 항상 PENDING (절대규칙 3, 하드코딩)
  if (field && NEVER_AUTO_APPLY_FIELDS.has(field)) {
    return { decision: 'PENDING', reason: 'FIELD_NEVER_AUTO' }
  }

  // 4.3-1행 조건 중 하나: 대상 필드가 verifiedFields 에 없어야 한다 (절대규칙 2)
  if (field && verifiedFields.includes(field)) {
    return { decision: 'PENDING', reason: 'FIELD_VERIFIED_BY_HUMAN' }
  }

  if (!autoApply) {
    return { decision: 'PENDING', reason: 'AUTO_APPLY_OFF' }
  }

  if (confidence < minConfidence) {
    return { decision: 'PENDING', reason: 'BELOW_FIELD_CONFIDENCE' }
  }

  return { decision: 'AUTO_APPLIED', reason: 'AUTO_APPLIED' }
}

/**
 * 설정 UI 가 이 필드에 autoApply 를 켤 수 있는지.
 * 켤 수 없는 필드를 화면에서 토글로 보여주면 안 된다(껐다 켰다 해도 아무 일도 안 일어난다).
 */
export function canConfigureAutoApply(field: string): boolean {
  return !NEVER_AUTO_APPLY_FIELDS.has(field)
}
