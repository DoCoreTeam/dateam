/**
 * API(에이전트) 쓰기 기록 보기 (P0158 I11)
 *
 * 관문(lib/actions/dispatch.ts)이 api_write_audit 에 남긴 줄을 변경 이력과 키 관리 화면이 읽는다
 * 누가 보나: 본인 키 기록만, 관리자(profiles.role admin)는 전부
 * DB 를 모르는 모양 바꾸기와 조건 만들기만 여기 두고, 읽기는 부르는 쪽이 서비스롤로 한다
 */

export interface ApiAuditRow {
  id: number
  key_id: string | null
  user_id: string
  agent: string | null
  request_id: string | null
  action_name: string
  method: string
  path: string
  status: number
  dry_run: boolean
  approval_id: string | null
  created_at: string
}

/** 변경 이력 한 줄의 모양 (AuditClient Entry 와 같음) */
export interface ApiAuditEntry {
  id: string
  actorType: 'API'
  actorName: string
  action: string
  summary: string
  targetType: 'api'
  targetId: string
  changes: { field: string; from: string; to: string }[]
  createdAt: string
}

export const API_AUDIT_MAX = 100
export const API_AUDIT_COLUMNS = 'id, key_id, user_id, agent, request_id, action_name, method, path, status, dry_run, approval_id, created_at'

/** 관리자면 조건 없음, 아니면 본인 것만 */
export function auditScope(viewer: { userId: string; role: string | null | undefined }): { userId: string } | null {
  return viewer.role === 'admin' ? null : { userId: viewer.userId }
}

export function clampLimit(raw: unknown, fallback = 50): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), API_AUDIT_MAX)
}

export function toAuditEntry(r: ApiAuditRow): ApiAuditEntry {
  const tags = [r.dry_run ? 'dryRun' : '', r.approval_id ? 'approval' : ''].filter(Boolean).join(' ')
  return {
    id: `api-${r.id}`,
    actorType: 'API',
    actorName: r.agent ?? 'API',
    action: r.action_name,
    summary: `${r.action_name} ${r.status}${tags ? ` (${tags})` : ''}`,
    targetType: 'api',
    targetId: r.request_id ?? '',
    changes: [],
    createdAt: r.created_at,
  }
}

/*
 * 쓰기 기록에 싣는 값 꺼내기 (P0162 I03)
 * 관문(dispatch.ts)과 예전 공개 쓰기 창구(write-audit.ts)가 같은 함수를 쓴다
 */

const AGENT_MAX = 200

/** 부른 쪽 이름, x-agent 가 먼저고 없으면 user-agent */
export function agentOf(headers: Headers): string | null {
  return (headers.get('x-agent') ?? headers.get('user-agent') ?? '').slice(0, AGENT_MAX) || null
}

/** 부른 곳 주소, x-forwarded-for 의 첫 값이 먼저고 없으면 x-real-ip */
export function ipOf(headers: Headers): string | null {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || null
}

export interface WriteIdentity {
  keyId: string
  userId: string
}

// 요청 객체를 열쇠로 쓰는 WeakMap 이라 요청이 끝나면 같이 사라지고 다른 요청에서 안 보인다
const identities = new WeakMap<object, WriteIdentity>()

/** 키와 계정을 확인한 뒤에만 부른다, 키 값과 해시는 받지 않는다 */
export function rememberIdentity(request: object, identity: WriteIdentity): void {
  identities.set(request, { keyId: identity.keyId, userId: identity.userId })
}

export function identityOf(request: object): WriteIdentity | null {
  return identities.get(request) ?? null
}

export interface WriteAuditInput {
  identity: WriteIdentity
  name: string
  method: string
  url: string
  headers: Headers
  status: number
  requestId: string
}

/** api_write_audit 한 줄, 본문과 키 값은 싣지 않는다 */
export function writeAuditRow(input: WriteAuditInput) {
  return {
    key_id: input.identity.keyId,
    user_id: input.identity.userId,
    agent: agentOf(input.headers),
    ip: ipOf(input.headers),
    request_id: input.requestId,
    action_name: input.name,
    method: input.method,
    path: new URL(input.url).pathname,
    status: input.status,
    dry_run: false,
    approval_id: null,
  }
}
