// 통합 활동이력 SSOT (migration 143 activity_log).
// 일일업무·부서업무 서버액션이 성공·실패 양쪽을 이 함수로 기록한다.
// best-effort: 로깅 실패가 본 작업을 깨뜨리지 않도록 예외를 삼키되 console.error로 남긴다.

export type ActivityModule = 'daily' | 'dept_task'
export type ActivityStatus = 'success' | 'failure' | 'partial'
// 통합 피드에서 project/weekly도 함께 보여주기 위한 확장 모듈(읽기 전용 정규화용).
export type FeedModule = ActivityModule | 'project' | 'weekly'

interface LogInput {
  module: ActivityModule
  action: string
  status: ActivityStatus
  actorId: string
  ownerId: string
  entityId?: string | null
  title?: string | null
  before?: unknown
  after?: unknown
  error?: unknown
  evidence?: unknown
}

export function normalizeActivityError(e: unknown): { message: string; code?: string | null } {
  if (e && typeof e === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyE = e as any
    if (typeof anyE.message === 'string') return { message: anyE.message, code: anyE.code ?? null }
  }
  if (e instanceof Error) return { message: e.message }
  return { message: String(e) }
}

/** 활동 1건 기록. supabase = 사용자 세션 클라이언트(RLS: actor_id=auth.uid()). */
export async function logActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: LogInput,
): Promise<void> {
  // 성공 변경은 DB 트리거(audit_log, 마이그146)가 자동·완전 기록하므로 앱단은 기록하지 않는다.
  // 앱단은 커밋되지 않은 '실패/부분'(트리거가 볼 수 없는 것)만 남긴다 → 이중기록 제거.
  if (input.status === 'success') return
  try {
    const { error } = await supabase.from('activity_log').insert({
      module: input.module,
      entity_id: input.entityId ?? null,
      user_id: input.ownerId,
      actor_id: input.actorId,
      action: input.action,
      status: input.status,
      title: (input.title ?? '').slice(0, 200) || null,
      before_snapshot: input.before ?? null,
      after_snapshot: input.after ?? null,
      error_detail: input.error != null ? normalizeActivityError(input.error) : null,
      evidence: input.evidence ?? null,
    })
    if (error) console.error('[activity-log] insert 실패', error)
  } catch (e) {
    console.error('[activity-log] 예외', e)
  }
}

// ── 통합 피드 표시 라벨(SSOT) — '이력' 탭과 API가 공유 ──
export const MODULE_LABEL: Record<FeedModule, string> = {
  daily: '일일업무', dept_task: '부서업무', project: '프로젝트', weekly: '주간보고',
}
export const STATUS_LABEL: Record<ActivityStatus, string> = {
  success: '성공', failure: '실패', partial: '부분',
}
// action 코드 → 한글(없으면 코드 그대로).
export const ACTION_LABEL: Record<string, string> = {
  create: '생성', update: '수정', delete: '삭제', status_change: '상태변경',
  assign: '담당지정', promote: '승격', carryover: '이월', memo: '메모',
  ai_confirm: 'AI확정', link_daily: '업무연결', unlink_daily: '업무해제', member_change: '멤버변경',
  edit: '수정', restore: '되살리기',
}

// 통합 피드 정규화 아이템.
export interface ActivityFeedItem {
  id: string
  module: FeedModule
  action: string
  status: ActivityStatus
  title: string | null
  occurredAt: string
  before: Record<string, unknown> | null   // 수정 전 스냅샷(diff·되살리기 근거). 생성/실패로그면 null
  after: Record<string, unknown> | null
  error: { message: string; code?: string | null } | null
  auditId: number | null   // audit_log.id (되살리기 대상). 실패로그/복구불가면 null
  restorable: boolean      // before 있음 + 화이트리스트 테이블 + 복구 지원 op
}

// audit_log.table_name → 피드 모듈. daily_logs는 task_kind로 daily/dept 분기.
export function auditTableToModule(tableName: string, row: Record<string, unknown> | null): FeedModule | null {
  if (tableName === 'daily_logs') return (row?.task_kind === 'dept_task') ? 'dept_task' : 'daily'
  if (tableName === 'weekly_reports') return 'weekly'
  if (tableName === 'projects') return 'project'
  return null   // calendar_events/daily_log_threads/work_entity_links 등 부속 테이블은 피드 비노출(감사엔 기록됨)
}

// 되살리기 지원 테이블(관계/부속 테이블 제외 — 권한 재획득 IDOR 차단).
export const RESTORABLE_TABLES = new Set(['daily_logs', 'weekly_reports', 'projects'])
