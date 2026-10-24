/**
 * 개발자센터 게이트웨이와 승인 요청 절 (P0164 I02)
 *
 * 화면(app/develop/GatewaySection.tsx)은 이 파일을 그리기만 한다
 *
 * 값의 출처
 *   경로 접두, 쓰기 한도, 키 길이, 사람만 하는 동작   lib/actions/dispatch-core.ts
 *   승인 요청 만료, 멱등 보관 시간                   supabase/migrations/318_api_key_scopes.sql
 *   경로 예시                                       lib/actions/generated/table.ts 의 실제 줄
 *   상태 이름, 단추 이름, 기록 탭 이름               lib/terms/api-key.ts
 *
 * dispatch-core.ts 와 table.ts 는 화면 묶음에 넣을 수 없다
 *   dispatch-core 는 node:crypto 를, table.ts 는 서버 라우트 모듈 전부를 끌고 온다
 *   그래서 여기 값을 두고 lib/api-docs/devcenter-docs.test.ts 가 원본을 직접 읽어 같은지 대조한다
 *   하나라도 갈리면 시험이 실패한다
 * 상대 경로와 .ts 확장자로 적는다, 가드가 node --test 로 이 파일을 직접 읽는다
 */

import { APPROVAL_SCOPES, type Scope } from '../actions/types.ts'
import { API_AUDIT_MAX } from '../public-api/api-audit.ts'
import { API_APPROVAL, API_APPROVAL_ERROR, API_APPROVAL_STATUS, API_AUDIT, API_CLI_DOC } from '../terms/api-key.ts'

/** dispatch-core.ts PUBLIC_PREFIX */
export const GATEWAY_PREFIX = '/api/public/v1'
/** dispatch-core.ts WRITE_LIMIT_PER_MINUTE */
export const GATEWAY_WRITE_LIMIT = 20
/** dispatch-core.ts IDEMPOTENCY_KEY_MAX */
export const GATEWAY_IDEMPOTENCY_KEY_MAX = 200
/** dispatch-core.ts HUMAN_ONLY_ACTIONS */
export const GATEWAY_HUMAN_ONLY: readonly string[] = ['meta.approval.decide']
/** dispatch.ts, 받은 X-Request-Id 를 이 길이에서 자른다 */
export const GATEWAY_REQUEST_ID_MAX = 100
/** 마이그레이션 318 api_approval_requests.expires_at 기본값 */
export const APPROVAL_EXPIRY_HOURS = 24
/** 마이그레이션 318 record_api_key_write_hit 가 지우는 api_idempotency 의 나이 */
export const IDEMPOTENCY_RETENTION_HOURS = 24

export type GatewayExampleKind = 'route' | 'web' | 'action' | 'approval'

export const GATEWAY_KIND_LABEL: Record<GatewayExampleKind, string> = {
  route: '라우트',
  web: '라우트(/web)',
  action: '서버 액션',
  approval: '승인 요청이 되는 호출',
}

export interface GatewayExample {
  kind: GatewayExampleKind
  /** 정의 표의 name, 가드가 이 이름으로 table.ts 의 줄을 찾는다 */
  name: string
  method: string
  /** 공개 경로, 접두 뒤 */
  mount: string
  /** 화면이 부르는 내부 경로 또는 파일#함수 */
  internal: string
  scope: Scope
  cli: string
  note: string
}

/** 경로 예시, 줄마다 table.ts 의 실제 항목과 같아야 한다 */
export const GATEWAY_EXAMPLES: readonly GatewayExample[] = [
  {
    kind: 'route', name: 'crm.company.create', method: 'POST', mount: '/crm/companies', internal: '/api/crm/companies',
    scope: 'write', cli: 'crm company create', note: '내부 경로에서 /api 를 뗀 경로',
  },
  {
    kind: 'web', name: 'crm.company.list', method: 'GET', mount: '/web/crm/companies', internal: '/api/crm/companies',
    scope: 'read', cli: 'crm company list', note: '같은 메서드와 경로의 공개 API 가 따로 있어 /web 아래로 옮긴 경로',
  },
  {
    kind: 'action', name: 'studio.chat.create-project', method: 'POST', mount: '/actions/studio/chat/create-project',
    internal: 'app/(ai)/ai/actions.ts#createProject', scope: 'write', cli: 'studio chat create-project', note: '서버 액션, 이름의 점을 빗금으로 바꾼 경로',
  },
  {
    kind: 'approval', name: 'crm.company.rm', method: 'DELETE', mount: '/crm/companies/{id}', internal: '/api/crm/companies/{id}',
    scope: 'delete', cli: 'crm company rm', note: 'delete 범위가 없는 키로 부르면 승인 요청(202)',
  },
]

export const GATEWAY_ACTION_BODY_SAMPLE = `POST ${GATEWAY_PREFIX}/actions/studio/chat/create-project
X-API-Key: YOUR_KEY
Content-Type: application/json

{ "name": "영업 메모", "instructions": "고객사별로 정리" }`

/** 게이트웨이가 요청을 거치는 순서, dispatch.ts dispatchPublicApi 와 같은 순서 */
export const GATEWAY_STEPS: readonly string[] = [
  'API 키를 확인합니다. 없거나 폐기되었거나 만료된 키는 여기서 끝납니다.',
  '공개 경로와 메서드로 정의 표에서 동작을 찾습니다. 없으면 404 not_found 입니다.',
  `사람만 하는 동작(${GATEWAY_HUMAN_ONLY.join(', ')})이면 403 과 code human_only 를 돌려줍니다.`,
  '키 범위를 봅니다. 범위가 있으면 실행하고, 없으면 승인 요청이나 403 이 됩니다.',
  `쓰기라면 쓰기 분당 한도를 셉니다. ${GATEWAY_WRITE_LIMIT}회를 넘으면 429 입니다.`,
  'dryRun 이면 여기서 멈추고 판정만 돌려줍니다.',
  '승인이 필요한 호출이면 승인 요청을 만들고 202 를 돌려줍니다.',
  '같은 Idempotency-Key 로 이미 처리한 쓰기면 처음 결과를 그대로 돌려줍니다.',
  '키를 만든 계정으로 화면과 같은 처리 함수를 부르고, 쓰기라면 결과를 기록합니다.',
]

/** 승인 요청을 만들었을 때의 몸통 (dispatch.ts 의 202 응답과 같은 칸) */
export const APPROVAL_202_SAMPLE = `// HTTP 202
{
  "success": true,
  "status": "PENDING",
  "approvalId": "3d7e…",
  "approvalUrl": "/approvals/3d7e…",
  "requiredScope": "delete",
  "expiresAt": "2026-10-25T03:00:00.000Z"
}`

export const HUMAN_ONLY_MESSAGE = '이 작업은 사람이 화면에서 합니다.'
export const HUMAN_ONLY_SAMPLE = `// HTTP 403
{
  "success": false,
  "error": "${HUMAN_ONLY_MESSAGE}",
  "code": "human_only"
}`

const STATUS_DESC: Record<string, string> = {
  PENDING: '승인이나 거절을 기다립니다.',
  APPROVED: '승인되어 실행했습니다. result 에 실행 결과의 HTTP 상태와 몸통이 실립니다.',
  REJECTED: '거절되어 실행하지 않았습니다.',
  EXPIRED: `${APPROVAL_EXPIRY_HOURS}시간 안에 결정되지 않아 실행하지 않았습니다.`,
  FAILED: '승인했지만 실행이 서버 오류(5xx)로 끝났거나 그 동작을 더 이상 API 로 부를 수 없습니다.',
}

export interface ApprovalStatusRow { status: string; label: string; desc: string }

/** 승인 요청 상태 표, 줄은 API_APPROVAL_STATUS 에서 */
export const APPROVAL_STATUS_ROWS: readonly ApprovalStatusRow[] = Object.keys(API_APPROVAL_STATUS).map((status) => ({
  status,
  label: API_APPROVAL_STATUS[status],
  desc: STATUS_DESC[status] ?? '',
}))

export const DRY_RUN_SAMPLE = `// HTTP 200
{
  "success": true,
  "dryRun": true,
  "action": "crm.company.rm",
  "scope": "delete",
  "decision": "approval",
  "params": { "id": "c-102" }
}`

export interface GatewayHeaderRow { name: string; direction: 'request' | 'response' | 'both'; desc: string }

export const GATEWAY_DIRECTION: Record<GatewayHeaderRow['direction'], string> = {
  request: '요청',
  response: '응답',
  both: '요청과 응답',
}

/** 게이트웨이가 읽거나 붙이는 헤더, 이름은 dispatch.ts dispatch-core.ts api-audit.ts 에 있는 그대로 */
export const GATEWAY_HEADERS: readonly GatewayHeaderRow[] = [
  { name: 'Idempotency-Key', direction: 'request', desc: `쓰기를 한 번만 실행하게 하는 키, ${GATEWAY_IDEMPOTENCY_KEY_MAX}자까지` },
  { name: 'x-dry-run', direction: 'request', desc: '1 이면 실행하지 않고 판정만 받습니다. 쿼리 ?dryRun=1 또는 ?dryRun=true 와 같습니다' },
  { name: 'X-Request-Id', direction: 'both', desc: `보내면 앞 ${GATEWAY_REQUEST_ID_MAX}자를 그대로 쓰고, 안 보내면 게이트웨이가 만듭니다. 응답에 항상 실리고 기록에도 남습니다` },
  { name: 'X-Agent', direction: 'request', desc: `부른 프로그램 이름, 기록의 「${API_AUDIT.agent}」 칸에 남습니다. 없으면 User-Agent 를 씁니다` },
  { name: 'Idempotent-Replay', direction: 'response', desc: '처음 결과를 다시 돌려준 응답이면 true' },
  { name: 'Retry-After', direction: 'response', desc: '분당 한도에 걸린 429 응답에서 다시 보낼 수 있을 때까지의 초' },
]

/** 화면 문구, 말투는 시작하기 절과 같다 */
export const GATEWAY_DOC = {
  nav: '게이트웨이와 승인 요청',
  title: '게이트웨이와 승인 요청',
  intro:
    `웹 화면에서 하는 동작은 게이트웨이 하나로 API 에서도 부를 수 있습니다. 게이트웨이(${GATEWAY_PREFIX})는 키를 확인하고, 키를 만든 계정으로 화면이 쓰는 처리 함수를 그대로 부릅니다. 그래서 화면과 API 의 결과가 같습니다.`,
  pathTitle: '경로',
  pathBody:
    `라우트는 ${GATEWAY_PREFIX} 뒤에 내부 경로에서 /api 를 뗀 경로를 붙입니다. 같은 메서드와 경로의 공개 API 가 따로 있으면 그쪽이 이기고, 게이트웨이 쪽은 /web 아래로 옮겨집니다. 서버 액션은 ${GATEWAY_PREFIX}/actions/ 뒤에 동작 이름의 점을 빗금으로 바꿔 붙이고 언제나 POST 입니다.`,
  actionBody:
    '서버 액션의 몸통은 매개변수 이름을 키로 한 객체입니다. 매개변수 순서대로 값을 담은 배열이나 { "args": [...] } 로 보내도 됩니다.',
  catalogue: `여기 예시는 일부입니다. 전체 목록은 참고의 ${API_CLI_DOC.nav} 절과 OpenAPI 절에 있습니다.`,
  exampleHead: { kind: '종류', method: '메서드', path: '공개 경로', scope: '범위', cli: 'CLI 명령' },
  stepsTitle: '처리 순서',
  approvalTitle: '승인 요청',
  approvalBody:
    `키에 ${APPROVAL_SCOPES.join(' ')} 범위가 없더라도 계정 역할이 그 범위를 가질 수 있으면, 게이트웨이는 실행하지 않고 승인 요청을 만들어 202 와 approvalId 를 돌려줍니다.`,
  approvalDecide:
    `키 주인이나 관리자가 웹의 /approvals/{id} 화면에서 「${API_APPROVAL.approve}」 또는 「${API_APPROVAL.reject}」를 누릅니다. 승인하면 그때 키 주인의 권한으로 실행되고, 결과는 GET ${GATEWAY_PREFIX}/approvals/{id} 로 확인합니다. teamda CLI 는 202 를 받으면 이 경로를 묻습니다.`,
  approvalHumanOnly:
    `승인 결정은 웹에서 사람만 합니다. ${GATEWAY_HUMAN_ONLY.join(', ')} 를 키로 부르면 범위와 상관없이 403 과 code human_only 를 받습니다. 키가 자기 승인 요청을 스스로 통과시키지 못하게 하려는 것입니다.`,
  approvalExpiry:
    `승인 요청은 만든 뒤 ${APPROVAL_EXPIRY_HOURS}시간이 지나면 만료됩니다. 만료된 요청은 승인을 눌러도 실행하지 않습니다. 화면 안내 그대로 옮기면 「${API_APPROVAL_ERROR.expired}」입니다.`,
  statusHead: { status: '상태', label: '화면 이름', desc: '뜻' },
  idemTitle: 'Idempotency-Key',
  idemBody:
    `쓰기 요청에 Idempotency-Key 헤더를 붙이면, 같은 키로 다시 보낸 요청은 실행하지 않고 처음 결과를 그대로 돌려주며 응답에 Idempotent-Replay: true 가 붙습니다. 같은 키로 메서드나 경로나 몸통이 다른 요청을 보내면 409 idempotency_key_reused 입니다. 키가 ${GATEWAY_IDEMPOTENCY_KEY_MAX}자를 넘으면 400 invalid_idempotency_key 입니다.`,
  idemScope:
    `키는 API 키마다 따로 세고 ${IDEMPOTENCY_RETENTION_HOURS}시간 동안 기억합니다. 조회 요청과 승인 요청이 되는 호출에는 쓰이지 않고, 서버 오류(5xx)로 끝난 결과는 기억하지 않으므로 같은 키로 다시 보낼 수 있습니다.`,
  dryTitle: 'dryRun',
  dryBody:
    '쿼리에 dryRun=1 이나 dryRun=true 를 붙이거나 x-dry-run: 1 헤더를 보내면 키 확인과 범위 판정과 쓰기 한도까지만 거치고 실행하지 않습니다. 응답에는 부를 동작(action), 범위(scope), 판정(decision, run 또는 approval), 경로 값(params)이 실립니다. 승인 요청도 만들지 않습니다. 쓰기라면 기록에 남고 쓰기 한도에도 셉니다.',
  limitTitle: '쓰기 한도',
  limitBody:
    `모든 요청은 키마다 정한 분당 한도(X-RateLimit-Limit)를 셉니다. 쓰기는 그와 따로 키마다 분당 ${GATEWAY_WRITE_LIMIT}회까지이고, 넘으면 429 와 Retry-After: 60 을 받습니다. 조회는 쓰기 한도를 세지 않고 키의 분당 한도만 셉니다.`,
  headerTitle: '헤더',
  headerHead: { name: '헤더', direction: '방향', desc: '설명' },
  auditTitle: '쓰기 기록',
  auditBody:
    '키로 한 쓰기는 성공과 실패, 403 과 429, Idempotency-Key 거절과 재생, dryRun, 승인 요청까지 전부 api_write_audit 에 남습니다. 키, 보낸 곳, X-Request-Id, IP, 결과 상태가 함께 기록되고, 승인 뒤 실행한 결과도 같은 요청 id 로 한 줄 더 남습니다.',
  auditWhere:
    `CRM 기록 화면(/crm/audit)의 「${API_AUDIT.tab}」 탭에서 키로 한 CRM 동작을 봅니다. 관리자는 모든 키의 것을, 그 밖의 계정은 자기 키의 것을 봅니다. API Keys 화면(/api-keys)에서 키마다 「${API_AUDIT.requests}」를 누르면 그 키의 최근 쓰기 ${API_AUDIT_MAX}건이 보입니다. 조회 요청은 횟수만 셉니다.`,
} as const
