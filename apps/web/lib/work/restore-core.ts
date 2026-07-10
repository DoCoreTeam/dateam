// 되살리기 순수 코어(SSOT) — 컬럼 화이트리스트·SELECT 컬럼·게이트 판정.
// restore-action.ts('use server')는 async만 export 가능하므로, 단위테스트 가능한 순수 로직을
// 여기로 분리해 방어(화이트리스트 필터·워크플로 잠금) 회귀를 테스트로 잡는다.

// ── 컬럼 화이트리스트 — 테이블별 "사용자 콘텐츠" 필드만. 상태/관계/권한 컬럼은 제외.
//    user_id·deleted_at·ai_*·embedding 등을 되돌리면 소유권 이전·권한 상승이 되므로 절대 포함 금지. ──
export const RESTORABLE_COLUMNS: Record<string, readonly string[]> = {
  // 제외: user_id·assignee_user_id·department_id·task_kind·ai_*·deleted_at(별도 처리)·is_resolved 등
  daily_logs: ['content', 'entry_type', 'priority', 'checklist', 'target_date', 'log_date'],
  // 제외: confirmed_at·seq·user_id·deleted_at(별도 처리)
  weekly_reports: ['performance', 'plan', 'issues', 'category'],
  // 제외: user_id·deleted_at(별도 처리)·embedding
  projects: ['name', 'year', 'quarter', 'half', 'month', 'start_date', 'end_date', 'budget', 'currency', 'status'],
}

export const REVALIDATE_PATHS: Record<string, readonly string[]> = {
  daily_logs: ['/daily', '/home'],
  weekly_reports: ['/weekly-report'],
  projects: ['/work'],
}

// 현재행 조회용 SELECT 컬럼(SELECT * 금지 — 화이트리스트 필드 + 게이트 판단 최소 컬럼).
export const CURRENT_ROW_SELECT: Record<string, string> = {
  daily_logs: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.daily_logs].join(', '),
  weekly_reports: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.weekly_reports].join(', '),
  projects: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.projects].join(', '),
}

/**
 * 컬럼 화이트리스트 필터(순수) — before 스냅샷에서 그 테이블의 복구 허용 컬럼만 골라낸다.
 * 화이트리스트 밖 키(user_id·deleted_at·embedding·ai_* 등)는 절대 통과시키지 않는다(권한상승 차단).
 */
export function pickRestorableColumns(tableName: string, before: Record<string, unknown> | null): Record<string, unknown> {
  const columns = RESTORABLE_COLUMNS[tableName]
  if (!columns || !before) return {}
  const patch: Record<string, unknown> = {}
  for (const col of columns) {
    if (col in before) patch[col] = before[col]
  }
  return patch
}

/**
 * 확정/잠금 워크플로 게이트(순수) — best-effort. 판정 불가면 차단하지 않는다(fail-open).
 * 보안 경계가 아니라 운영 워크플로 보호(취합 이후 조작 방지). weekly_reports.confirmed_at 잠금 선반영.
 */
export function checkWorkflowLock(tableName: string, current: Record<string, unknown> | null): string | null {
  if (!current) return null
  if (tableName === 'weekly_reports' && current.confirmed_at != null) {
    return '확정된 항목은 되살릴 수 없습니다'
  }
  return null
}
