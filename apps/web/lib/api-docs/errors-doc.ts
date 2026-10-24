/**
 * 개발자센터 오류 코드 절 (P0164 I05)
 *
 * 화면(app/develop/page.tsx ErrorsSection, app/develop/ErrorCodeTable.tsx)은 이 파일을 그리기만 한다
 *
 * 값의 출처
 *   게이트웨이 몸통 예시    gateway-doc.ts, auth-doc.ts 의 예시를 그대로 다시 쓴다
 *   멱등 키 거절 문구       lib/actions/dispatch.ts
 *   CRM 오류 코드와 상태    lib/crm/domain/errors.ts CRM_ERROR_CODES, CRM_ERROR_HTTP (가져와서 줄을 만든다)
 *
 * CRM 코드의 뜻은 errors.ts 에 사람이 읽는 설명이 없어 여기 코드별로 둔다
 * lib/api-docs/devcenter-docs.test.ts 가 이 표의 키와 CRM_ERROR_CODES 가 양쪽으로 같은지 본다
 * 상대 경로와 .ts 확장자로 적는다, 가드가 node --test 로 이 파일을 직접 읽는다
 */

import { CRM_ERROR_CODES, CRM_ERROR_HTTP, type CrmErrorCode } from '../crm/domain/errors.ts'
import { APPROVAL_SCOPES } from '../actions/types.ts'
import { APPROVAL_202_SAMPLE, HUMAN_ONLY_SAMPLE, GATEWAY_IDEMPOTENCY_KEY_MAX, GATEWAY_PREFIX } from './gateway-doc.ts'
import { AUTH_SCOPE_403_SAMPLE, AUTH_EXPIRED_SAMPLE } from './auth-doc.ts'

export interface HttpErrorRow { code: number; name: string; cause: string; fix: string }

/** 공통 HTTP 상태 표 */
export const HTTP_ERROR_ROWS: readonly HttpErrorRow[] = [
  { code: 400, name: 'Bad Request', cause: '필수 파라미터 누락·형식 오류', fix: '응답의 error 문장이 무엇이 잘못됐는지 알려 줍니다.' },
  { code: 401, name: 'Unauthorized', cause: 'X-API-Key 없음 또는 형식 오류', fix: '헤더 이름과 키 앞자리(ax_live_)를 확인하세요.' },
  { code: 403, name: 'Forbidden', cause: '폐기된 키 · 비활성 계정 · 권한 부족', fix: '키를 발급한 계정의 권한을 확인하세요. 남의 레코드는 관리자만 고칠 수 있습니다.' },
  { code: 404, name: 'Not Found', cause: '없는 id', fix: '목록 API로 id를 다시 확인하세요.' },
  { code: 429, name: 'Too Many Requests', cause: '분당 한도 초과', fix: 'Retry-After 초만큼 기다린 뒤 다시 시도하세요.' },
  { code: 500, name: 'Server Error', cause: '서버 처리 실패', fix: '잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.' },
]

/** dispatch.ts 가 보내는 멱등 키 거절 문구 */
export const IDEM_REUSED_ERROR = 'idempotency_key_reused'
export const IDEM_INVALID_ERROR = 'invalid_idempotency_key'

export const IDEM_REUSED_SAMPLE = `// HTTP 409
{
  "success": false,
  "error": "${IDEM_REUSED_ERROR}"
}`

export const IDEM_INVALID_SAMPLE = `// HTTP 400
{
  "success": false,
  "error": "${IDEM_INVALID_ERROR}"
}`

export interface GatewayErrorRow {
  /** 화면 안 복사 단추의 id 에 쓴다 */
  id: string
  status: number
  /** 응답에서 이 경우를 가려 보는 칸 */
  mark: string
  when: string
  fix: string
  sample: string
}

/** 게이트웨이가 돌려주는 성공 아닌 응답, 몸통 예시는 인증 절과 게이트웨이 절의 것을 그대로 쓴다 */
export const GATEWAY_ERROR_ROWS: readonly GatewayErrorRow[] = [
  {
    id: 'approval', status: 202, mark: 'approvalId',
    when: `키에 ${APPROVAL_SCOPES.join(' ')} 범위가 없지만 계정 역할은 그 범위를 가질 수 있습니다. 실행하지 않고 승인 요청을 만들었습니다.`,
    fix: `approvalUrl 을 키 주인에게 전하고, 결정 뒤 GET ${GATEWAY_PREFIX}/approvals/{id} 로 결과를 확인하세요.`,
    sample: APPROVAL_202_SAMPLE,
  },
  {
    id: 'scope', status: 403, mark: 'requiredScope',
    when: '키에 이 작업의 범위가 없습니다. 필요한 범위 이름이 requiredScope 에 실립니다.',
    fix: '그 범위를 고른 키를 새로 만들어 쓰세요.',
    sample: AUTH_SCOPE_403_SAMPLE,
  },
  {
    id: 'human-only', status: 403, mark: 'code: human_only',
    when: '승인 결정처럼 사람이 웹 화면에서만 하는 작업을 키로 불렀습니다. 범위와 상관없이 거절됩니다.',
    fix: '웹의 승인 화면에서 직접 결정하세요.',
    sample: HUMAN_ONLY_SAMPLE,
  },
  {
    id: 'expired', status: 403, mark: 'error 문장',
    when: '만료일이 지난 키입니다. 만료를 범위보다 먼저 보기 때문에 requiredScope 는 실리지 않습니다.',
    fix: '새 키를 만들어 바꿔 넣으세요.',
    sample: AUTH_EXPIRED_SAMPLE,
  },
  {
    id: 'idem-reused', status: 409, mark: IDEM_REUSED_ERROR,
    when: '같은 Idempotency-Key 로 메서드나 경로나 몸통이 다른 쓰기를 보냈습니다.',
    fix: '다른 요청에는 새 Idempotency-Key 를 쓰세요. 같은 요청을 다시 보내는 것이면 몸통을 처음과 똑같이 맞추세요.',
    sample: IDEM_REUSED_SAMPLE,
  },
  {
    id: 'idem-invalid', status: 400, mark: IDEM_INVALID_ERROR,
    when: `Idempotency-Key 가 ${GATEWAY_IDEMPOTENCY_KEY_MAX}자를 넘습니다.`,
    fix: `${GATEWAY_IDEMPOTENCY_KEY_MAX}자 이하의 키로 다시 보내세요. UUID 하나면 충분합니다.`,
    sample: IDEM_INVALID_SAMPLE,
  },
]

/** CRM 오류 코드의 뜻, 키는 CRM_ERROR_CODES 와 같아야 한다 */
export const CRM_ERROR_MEANING: Record<CrmErrorCode, string> = {
  VALIDATION_FAILED: '보낸 값이 형식이나 필수 조건에 맞지 않습니다. message 를 보고 값을 고쳐 다시 보내세요.',
  AI_PARSE_FAILED: 'AI 가 형식에 맞는 결과를 내지 못했습니다. 같은 요청을 다시 보내면 됩니다.',
  UNAUTHORIZED: '로그인이나 API 키가 없습니다.',
  FORBIDDEN: '이 레코드나 작업에 대한 권한이 없습니다. 남의 레코드는 관리자만 고칠 수 있습니다.',
  NOT_FOUND: '대상을 찾을 수 없습니다. 목록 API 로 id 를 다시 확인하세요.',
  CONFLICT: '다른 사람이 먼저 수정했습니다. 다시 읽은 뒤 고쳐 보내세요.',
  DUPLICATE: '이미 등록된 항목입니다. 기존 레코드를 찾아 쓰세요.',
  INVALID_TRANSITION: '지금 상태에서는 할 수 없는 상태 변경입니다.',
  OPEN_DEALS_EXIST: '진행 중인 딜이 있어 삭제할 수 없습니다. 딜을 먼저 정리하세요.',
  BUDGET_BLOCKED: '이번 달 AI 예산이 소진되어 AI 기능이 멈췄습니다. 설정에서 상한을 조정할 수 있습니다.',
  PROVIDER_QUOTA: 'AI 공급자 쪽 사용량 한도에 걸렸습니다. 우리 예산과는 다른 원인이고, 잠시 후 다시 시도하거나 다른 모델을 고르세요.',
  WORKSPACE_MISMATCH: '요청을 처리할 수 없습니다. 같은 요청을 반복하지 말고 관리자에게 알려 주세요.',
  INTERNAL: '예상하지 못한 서버 실패입니다. 입력을 고칠 일이 아니라 잠시 후 다시 시도할 일입니다.',
}

export interface CrmErrorRow { code: CrmErrorCode; status: number; meaning: string }

/** CRM 오류 표, 줄과 상태는 errors.ts 에서 온다 */
export const CRM_ERROR_ROWS: readonly CrmErrorRow[] = CRM_ERROR_CODES.map((code) => ({
  code,
  status: CRM_ERROR_HTTP[code],
  meaning: CRM_ERROR_MEANING[code],
}))

/** CRM 경로의 실패 몸통, errors.ts CrmError.toResponseBody 와 같은 모양 */
export const CRM_ERROR_SAMPLE = `// HTTP ${CRM_ERROR_HTTP.INVALID_TRANSITION}
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "지금 상태에서는 할 수 없는 변경입니다.",
    "details": {}
  }
}`

/** 화면 문구, 말투는 이웃 절과 같다 */
export const ERRORS_DOC = {
  title: '오류 코드',
  description: '실패도 성공과 같은 봉투로 옵니다. error 문장은 사람이 읽을 수 있는 말입니다.',
  httpHead: { code: '코드', name: '이름', cause: '원인', fix: '대응' },
  gatewayTitle: '게이트웨이 응답',
  gatewayBody:
    '게이트웨이는 범위와 승인 요청과 Idempotency-Key 때문에 아래 응답을 돌려줍니다. 같은 상태 코드라도 몸통의 칸으로 경우를 가려 봅니다. 202 는 실패가 아니라 아직 실행하지 않았다는 뜻입니다.',
  gatewayHead: { status: '상태', mark: '가려 보는 칸', when: '언제', fix: '대응' },
  crmTitle: 'CRM 오류 코드',
  crmBody:
    'CRM 경로는 실패하면 error 안에 code, message, details 를 담아 보냅니다. message 는 사람이 읽는 문장이고, 프로그램은 code 로 갈라 처리하세요.',
  crmHead: { code: 'code', status: 'HTTP', meaning: '뜻' },
  retryTitle: '다시 시도 예시',
} as const
