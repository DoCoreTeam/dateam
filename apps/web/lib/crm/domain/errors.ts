/**
 * CRM 오류 규격 — 구현명세서 7장
 *
 * 응답 형식은 고정이다:
 *   { "error": { "code": "INVALID_TRANSITION", "message": "사용자 노출 한국어 문장", "details": {} } }
 *
 * message 는 **사용자가 읽는 문장**이다. 스택트레이스나 영어 원문을 그대로 넣지 않는다.
 */

export const CRM_ERROR_CODES = [
  'VALIDATION_FAILED',
  'AI_PARSE_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE',
  'INVALID_TRANSITION',
  'OPEN_DEALS_EXIST',
  'BUDGET_BLOCKED',
  // 아래는 7장 표에 없지만 앱 계층 방어(명세 2.2)가 필요로 한다.
  // 워크스페이스 가드가 불일치를 잡았다는 것은 호출부 버그이지 사용자 입력 문제가 아니다.
  'WORKSPACE_MISMATCH',
] as const

export type CrmErrorCode = (typeof CRM_ERROR_CODES)[number]

/** 코드 → HTTP 상태 (명세 7장 표) */
export const CRM_ERROR_HTTP: Record<CrmErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AI_PARSE_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  INVALID_TRANSITION: 422,
  OPEN_DEALS_EXIST: 422,
  BUDGET_BLOCKED: 429,
  WORKSPACE_MISMATCH: 500,
}

/** 코드 → 사용자 노출 기본 문장. 호출부가 더 구체적인 문장을 주면 그것을 쓴다. */
const DEFAULT_MESSAGE: Record<CrmErrorCode, string> = {
  VALIDATION_FAILED: '입력값을 확인해 주세요.',
  AI_PARSE_FAILED: 'AI가 형식에 맞는 결과를 내지 못했습니다. 다시 시도해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다.',
  FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
  NOT_FOUND: '대상을 찾을 수 없습니다.',
  CONFLICT: '다른 사람이 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요.',
  DUPLICATE: '이미 등록된 항목입니다.',
  INVALID_TRANSITION: '지금 상태에서는 할 수 없는 변경입니다.',
  OPEN_DEALS_EXIST: '진행 중인 딜이 있어 삭제할 수 없습니다.',
  BUDGET_BLOCKED:
    'AI 예산이 소진되어 이번 달 AI 기능이 중지되었습니다. 설정에서 상한을 조정할 수 있습니다.',
  WORKSPACE_MISMATCH: '요청을 처리할 수 없습니다.',
}

export class CrmError extends Error {
  readonly code: CrmErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: CrmErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? DEFAULT_MESSAGE[code])
    this.name = 'CrmError'
    this.code = code
    this.status = CRM_ERROR_HTTP[code]
    this.details = details
  }

  /** 명세 7장의 응답 본문 그대로 */
  toResponseBody(): { error: { code: CrmErrorCode; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } }
  }
}

export function isCrmError(e: unknown): e is CrmError {
  return e instanceof CrmError
}
