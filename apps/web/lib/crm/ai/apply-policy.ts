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

/**
 * 명세 4.3 마지막 줄 — autoApply 설정 자체가 불가능한 필드.
 *
 * v0.7.540에서 셋(`deletedAt`·`ownerId`·`role`)을 더했다.
 * 외부 HITL 기준이 "항상 사람 승인"으로 꼽는 다섯 가지 중 **삭제**와 **권한 변경**이
 * 우리 목록에 빠져 있었다(금융·배포·외부발신만 있었다). 되돌리기 비용이 다른 필드와 다르다 —
 * 소유권이 바뀌면 그 사람의 목록에서 사라지고, 삭제는 화면에서 통째로 사라진다.
 */
export const NEVER_AUTO_APPLY_FIELDS: ReadonlySet<string> = new Set([
  'amountMinor',
  'currency',
  'stageId',
  'status',
  'wonAt',
  'lostReason',
  // ↓ v0.7.540 추가
  'deletedAt',  // 삭제 — 화면에서 사라진다
  'ownerId',    // 소유권 이전 — 남의 목록으로 옮겨진다
  'role',       // 권한·역할 변경
])

/**
 * 사람 확인 없이 **새로 만들어도 되는** 대상.
 *
 * **왜 목록을 두나**: 예전에는 `isNewRecord`면 신뢰도와 무관하게 전부 사람에게 넘겼다.
 * 그 결과 신뢰도 1.00짜리 제안이 아무도 안 봐서 만료됐다(실측: 만료 29건 중 7건이 이 경로).
 * 외부 기준은 "되돌릴 수 있는 것은 자동, 되돌릴 수 없는 것만 큐"다.
 *
 * 인물·할 일은 되돌릴 수 있다 — 지우면 그만이고 다른 값을 덮어쓰지 않는다.
 * **회사·딜은 넣지 않는다** — 회사는 목록의 기준이 되고 딜은 파이프라인 합계를 바꾼다.
 * 그건 "만들었다가 지우면 되는 것"이 아니다.
 */
export const AUTO_CREATABLE_TARGETS: ReadonlySet<string> = new Set(['person'])

/** 새 레코드 생성이 자동으로 허용되는 축 — NEXT(할 일), RISK(읽을 거리, 만들 레코드 없음) */
export const AUTO_CREATABLE_AXES: ReadonlySet<string> = new Set(['NEXT', 'RISK'])

/** 명세 4.3 "confidence >= 0.6" — 이 아래는 저장조차 하지 않는다 */
export const MIN_SUGGESTION_CONFIDENCE = 0.6

/** ai_field_config.minConfidence 기본값 (스키마 @default(0.85)) */
export const DEFAULT_MIN_CONFIDENCE = 0.85

/**
 * `ai_field_config` 행이 없을 때의 autoApply 기본값.
 *
 * **false → true 로 뒤집었다(v0.7.540).** 근거는 실측이다 —
 * 설정 행은 워크스페이스 전체에 1개뿐이었고 그마저 꺼져 있었다.
 * 즉 "켤 수 있는 필드가 사실상 없는" 상태였고, 제안 36건 중 29건(81%)이
 * 반영되지 못한 채 만료됐다. 그중 22건이 이 기본값 때문이다.
 *
 * 켜는 비용을 사람에게 떠넘기면 아무도 켜지 않는다. **끄고 싶은 사람이 끈다.**
 * 안전판은 그대로다: NEVER_AUTO_APPLY_FIELDS · verifiedFields · minConfidence(0.85).
 */
export const DEFAULT_AUTO_APPLY = true

export type ApplyDecision = 'AUTO_APPLIED' | 'PENDING' | 'DISCARD'

export interface ApplyInput {
  confidence: number
  /** 갱신 대상 필드. 신규 생성 제안이면 없을 수 있다 */
  field?: string | null
  /** company | person | deal | deal_contact | task | meeting_summary */
  targetType: string
  /** 기존 레코드 갱신이 아니라 새 레코드를 만들자는 제안인가 */
  isNewRecord: boolean
  /** 5축 중 어느 축이 낸 제안인가 — 신규 생성 자동 허용 판정에 쓴다 */
  axis?: string | null
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
    confidence, field, isNewRecord, targetType, axis,
    autoApply = DEFAULT_AUTO_APPLY,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    verifiedFields = [],
  } = input

  // 4.3-3행: confidence < 0.6 → 저장하지 않음 (ai_run outputJson 에만 남는다)
  if (confidence < MIN_SUGGESTION_CONFIDENCE) {
    return { decision: 'DISCARD', reason: 'BELOW_THRESHOLD' }
  }

  // 신규 레코드 생성 — **되돌릴 수 있는 것만** 자동으로 만든다(v0.7.540).
  //
  // 예전에는 여기서 무조건 PENDING 이었다. 그래서 신뢰도 1.00 짜리 인물 제안이
  // 아무도 안 봐서 7일 뒤 만료됐다(실측 7건). 사람에게 물을 값어치가 없는 판단을
  // 물으면, 사람은 곧 인박스 전체를 안 본다.
  //
  // 회사·딜은 여기 없다 — 목록의 기준이 되고 파이프라인 합계를 바꾼다.
  if (isNewRecord) {
    const creatable =
      AUTO_CREATABLE_TARGETS.has(targetType) ||
      (typeof axis === 'string' && AUTO_CREATABLE_AXES.has(axis))
    if (!creatable) return { decision: 'PENDING', reason: 'NEW_RECORD_NEEDS_HUMAN' }
    if (!autoApply) return { decision: 'PENDING', reason: 'AUTO_APPLY_OFF' }
    if (confidence < minConfidence) return { decision: 'PENDING', reason: 'BELOW_FIELD_CONFIDENCE' }
    return { decision: 'AUTO_APPLIED', reason: 'AUTO_APPLIED' }
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
