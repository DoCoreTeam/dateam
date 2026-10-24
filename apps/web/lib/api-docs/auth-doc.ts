/**
 * 개발자센터 인증 절의 키 범위와 만료와 실제 권한 (P0164 I01)
 *
 * 화면(app/develop/KeyScopeSection.tsx)은 이 파일을 그리기만 한다
 * 범위 줄은 Scope 와 API_KEY_SCOPE 에서, 만료 선택지는 API_KEY_EXPIRY_OPTIONS 에서 만든다
 * 손으로 옮겨 적은 값이 없어야 범위나 기간이 바뀔 때 화면이 같이 바뀐다
 *
 * 근거 코드
 *   실제 권한   lib/public-api/scopes.ts effectiveScopes (계정 역할 범위 ∩ 키 범위)
 *   범위 판정   lib/actions/dispatch-core.ts decideAccess (실행, 승인 요청, 403)
 *   403 몸통    lib/actions/dispatch.ts, lib/publicApiAuth.ts (requiredScope)
 *   만료        lib/publicApiAuth.ts (만료를 범위보다 먼저 본다)
 *   내 키 확인  app/api/public/v1/me/route.ts
 *
 * 문구 대조는 lib/api-docs/devcenter-docs.test.ts 가 한다
 * 상대 경로와 .ts 확장자로 적는다, 가드가 node --test 로 이 파일을 직접 읽는다
 */

import { SCOPES, APPROVAL_SCOPES, type Scope } from '../actions/types.ts'
import { effectiveScopes } from '../public-api/scopes.ts'
import {
  API_KEY_SCOPE, API_KEY_EXPIRY_OPTIONS, API_KEY_DEFAULT_EXPIRY_DAYS, API_KEY_ONCE, API_KEY_FIELD,
} from '../terms/api-key.ts'

/** 키를 만들 수 있는 계정 역할, GET /me 의 role 값과 같다 */
export const AUTH_ROLES: readonly string[] = ['admin', 'member', 'api_user']

export interface AuthScopeRow {
  scope: Scope
  label: string
  roles: string[]
  whenMissing: string
}

/** 승인 요청으로 바뀌지 않는 범위 */
const PLAIN_SCOPES: readonly Scope[] = SCOPES.filter((s) => !APPROVAL_SCOPES.includes(s))

const MISSING_APPROVAL = '승인 요청(202), 계정이 가질 수 없는 범위면 403'
const MISSING_PLAIN = '403'

/** 범위 표, 줄은 Scope 의 순서 그대로 */
export const AUTH_SCOPE_ROWS: readonly AuthScopeRow[] = SCOPES.map((scope) => ({
  scope,
  label: API_KEY_SCOPE[scope],
  roles: AUTH_ROLES.filter((role) => effectiveScopes(role, [scope]).length > 0),
  whenMissing: APPROVAL_SCOPES.includes(scope) ? MISSING_APPROVAL : MISSING_PLAIN,
}))

export interface AuthExpiryRow {
  days: number
  label: string
  isDefault: boolean
}

/** 만료 선택지, 키 만들기 화면과 같은 목록 */
export const AUTH_EXPIRY_ROWS: readonly AuthExpiryRow[] = API_KEY_EXPIRY_OPTIONS.map((o) => ({
  days: o.days,
  label: o.label,
  isDefault: o.days === API_KEY_DEFAULT_EXPIRY_DAYS,
}))

const DEFAULT_EXPIRY_LABEL =
  API_KEY_EXPIRY_OPTIONS.find((o) => o.days === API_KEY_DEFAULT_EXPIRY_DAYS)?.label ?? `${API_KEY_DEFAULT_EXPIRY_DAYS}일`

/** 범위가 없을 때 게이트웨이가 돌려주는 몸통 (dispatch.ts, publicApiAuth.ts 와 같은 모양) */
export const AUTH_SCOPE_403_SAMPLE = `// HTTP 403
{
  "success": false,
  "error": "이 작업에는 write 범위가 필요합니다.",
  "requiredScope": "write"
}`

/** 만료된 키의 몸통, 어떤 범위가 필요한지는 알려 주지 않는다 */
export const AUTH_EXPIRED_MESSAGE = '만료된 API 키입니다. 새 키를 발급받아 주세요.'
export const AUTH_EXPIRED_SAMPLE = `// HTTP 403
{
  "success": false,
  "error": "${AUTH_EXPIRED_MESSAGE}"
}`

/** GET /me 응답의 data 칸, 이름은 app/api/public/v1/me/route.ts 와 같다 */
export const AUTH_ME_FIELDS: readonly { name: string; type: string; desc: string }[] = [
  { name: 'userId', type: 'string', desc: '키를 만든 계정' },
  { name: 'role', type: 'string', desc: `계정 역할 (${AUTH_ROLES.join(', ')})` },
  { name: 'keyId', type: 'string', desc: '키 식별자, 키 값은 싣지 않습니다' },
  { name: 'keyName', type: 'string', desc: '키를 만들 때 붙인 이름' },
  { name: 'scopes', type: 'string[]', desc: '실제로 쓸 수 있는 범위 (계정 권한과 키 범위가 겹치는 것)' },
  { name: 'rateLimitPerMinute', type: 'number', desc: '이 키의 분당 요청 한도' },
  { name: 'expiresAt', type: 'string | null', desc: `만료 시각(ISO 8601), 만료일이 없는 예전 키는 null (${API_KEY_FIELD.noExpiry})` },
  { name: 'remainingThisMinute', type: 'number', desc: '이번 분에 남은 요청 수, X-RateLimit-Remaining 과 같은 값' },
]

export const AUTH_ME_SAMPLE = `{
  "success": true,
  "data": {
    "userId": "6f1c…",
    "role": "member",
    "keyId": "a2b9…",
    "keyName": "영업 자동화 스크립트",
    "scopes": ["read", "write"],
    "rateLimitPerMinute": 60,
    "expiresAt": "2027-01-22T03:00:00.000Z",
    "remainingThisMinute": 58
  }
}`

/** 화면 문구, 말투는 시작하기 절의 나머지와 같다 */
export const AUTH_DOC = {
  inheritBody:
    '키로 할 수 있는 것은 그 키를 만든 계정의 권한과 키를 만들 때 고른 범위가 겹치는 부분입니다. 화면에서 못 하는 것은 API로도 못 하고, 범위를 고르지 않은 동작은 계정 권한이 있어도 키로 바로 실행되지 않습니다.',
  issue: `키는 API Keys 화면(/api-keys)에서 만들고 폐기합니다. 만든 직후 키 값이 한 번만 보입니다. 화면 안내 그대로 옮기면 「${API_KEY_ONCE}」입니다.`,
  scopeTitle: '키 범위',
  scopeIntro:
    '키를 만들 때 범위를 하나 이상 고릅니다. 범위 이름은 API 응답의 requiredScope 와 teamda CLI 오류에 그대로 나옵니다. 계정 역할이 가질 수 없는 범위는 고를 수 없고, 고르면 키 만들기가 거절됩니다.',
  scopeHead: { scope: '범위', label: '허락하는 것', roles: '가질 수 있는 계정 역할', missing: '범위가 없을 때' },
  effectiveTitle: '실제 권한',
  effectiveBody:
    '실제로 쓸 수 있는 범위는 계정 역할이 가질 수 있는 범위와 키 범위의 교집합입니다. 계정 역할이 바뀌어 범위를 잃으면 키에 적힌 범위도 그 순간 효력이 없어지고, 관리자 계정이라도 키 범위에 없는 동작은 바로 실행되지 않습니다.',
  missingBody:
    `${PLAIN_SCOPES.join(' 나 ')} 범위가 없으면 403 과 함께 필요한 범위를 requiredScope 로 돌려줍니다. ${APPROVAL_SCOPES.join(' ')} 범위가 없을 때 게이트웨이로 부른 동작은 403 대신 승인 요청(202)이 되어 키 주인의 승인을 기다립니다. 다만 계정이 그 범위를 가질 수 없으면 403 이고, DELETE /accounts/{id} 처럼 전용 라우트가 있는 경로도 승인 요청 없이 403 입니다.`,
  expiryTitle: '만료',
  expiryIntro: `키를 만들 때 만료 기간을 고릅니다. 고르지 않으면 ${DEFAULT_EXPIRY_LABEL}입니다.`,
  expiryHead: { label: '기간', days: '일수', note: '비고' },
  expiryDefault: '기본값',
  expiredBody:
    '만료일이 지난 키는 어떤 요청이든 403 을 받습니다. 만료를 범위보다 먼저 보기 때문에 만료된 키에는 어떤 범위가 필요한지 알려 주지 않습니다. 새 키를 만들어 바꿔 넣으세요.',
  meTitle: '내 키 확인 (GET /me)',
  meIntro:
    '키가 누구로 무엇을 할 수 있는지 확인합니다. 범위와 상관없이 부를 수 있고, 만료되거나 폐기된 키는 여기서도 403 입니다. teamda auth status 가 이 응답을 읽습니다.',
  meHead: { name: '필드', type: '타입', desc: '설명' },
} as const
