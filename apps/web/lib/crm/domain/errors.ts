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
  /**
   * AI 프로바이더 쪽 한도(429)·모델 사용 불가. **우리 예산(BUDGET_BLOCKED)과 다른 사건이다.**
   *
   * 왜 코드를 나눴나(v0.7.574): 프로바이더 429 가 `VALIDATION_FAILED` 로 던져지고 있었다.
   * 그래서 ① 화면에는 400 "입력값을 확인해 주세요" 계열로 나가고
   *      ② 일괄 처리의 **중단 조건에 걸리지 않아** 20곳을 끝까지 돌았다
   *         (회사당 2회 재시도 = 최대 40번의 확정된 실패 호출).
   * 남은 회사도 전부 같은 이유로 실패할 것이 확실하므로 **한 번 말하고 멈춰야 한다.**
   */
  'PROVIDER_QUOTA',
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
  // 프로바이더 한도도 429 다 — 우리 예산과 원인은 다르지만 "지금은 안 되고 나중엔 된다"가 같다
  PROVIDER_QUOTA: 429,
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
  // 호출부(runner)가 프로바이더가 준 사유로 더 구체적인 문장을 넘긴다 — 이건 그마저 없을 때의 말
  PROVIDER_QUOTA: 'AI 사용량 한도를 초과했습니다. 잠시 후 다시 시도하거나 다른 모델을 선택하세요.',
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

/**
 * 여러 건을 도는 작업에서 **더 해 봐야 소용없는** 실패.
 *
 * 남은 건도 같은 이유로 실패할 것이 확실할 때만 넣는다 — 개별 건의 실패
 * (모델이 헛소리를 했다 · 이 회사만 못 찾았다)는 여기 넣지 않는다. 그건 나머지를 계속해야 한다.
 *
 * 목록을 손으로 나열하지 않고 이 상수를 쓰는 이유: 조건을 호출부마다 적으면
 * 새 중단 사유가 생겼을 때 **한 곳만 고치고 나머지는 그대로 도는** 상태가 된다.
 * (실제로 그랬다 — `enrich-web` 만 BUDGET_BLOCKED 를 보고 있었고 429 는 아무도 안 봤다.)
 */
export const CRM_STOP_BATCH_CODES: readonly CrmErrorCode[] = ['BUDGET_BLOCKED', 'PROVIDER_QUOTA']

/** 이 오류를 만나면 남은 건을 시작하지 말아야 하는가 */
export function stopsBatch(e: unknown): e is CrmError {
  return e instanceof CrmError && CRM_STOP_BATCH_CODES.includes(e.code)
}
