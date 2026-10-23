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
