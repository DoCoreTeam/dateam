// 프로젝트 감사로그 기록 SSOT (migration 142 project_activity).
// 모든 프로젝트 저장 경로(POST/PATCH/DELETE/ai_confirm)가 성공·실패 양쪽을 이 함수로 남긴다.
// best-effort: 로깅 실패가 본 요청을 깨뜨리지 않도록 예외를 삼키되 console.error로 남긴다.

export type ProjectActivityAction =
  | 'create' | 'update' | 'delete' | 'ai_confirm' | 'link_daily' | 'unlink_daily' | 'member_change'
export type ProjectActivityStatus = 'success' | 'failure' | 'partial'

export interface ProjectActivityRow {
  id: string
  project_id: string | null
  user_id: string
  actor_id: string
  action: ProjectActivityAction
  status: ProjectActivityStatus
  before_snapshot: Record<string, unknown> | null
  after_snapshot: Record<string, unknown> | null
  error_detail: { message: string; code?: string | null } | null
  evidence: Record<string, unknown> | null
  occurred_at: string
}

interface LogInput {
  projectId?: string | null
  ownerId: string
  actorId: string
  action: ProjectActivityAction
  status: ProjectActivityStatus
  before?: unknown
  after?: unknown
  error?: unknown
  evidence?: unknown
}

export function normalizeError(e: unknown): { message: string; code?: string | null } {
  if (e && typeof e === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyE = e as any
    if (typeof anyE.message === 'string') return { message: anyE.message, code: anyE.code ?? null }
  }
  if (e instanceof Error) return { message: e.message }
  return { message: String(e) }
}

export async function logProjectActivity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: LogInput,
): Promise<void> {
  try {
    const { error } = await supabase.from('project_activity').insert({
      project_id: input.projectId ?? null,
      user_id: input.ownerId,
      actor_id: input.actorId,
      action: input.action,
      status: input.status,
      before_snapshot: input.before ?? null,
      after_snapshot: input.after ?? null,
      error_detail: input.error != null ? normalizeError(input.error) : null,
      evidence: input.evidence ?? null,
    })
    if (error) console.error('[project-activity] insert 실패', error)
  } catch (e) {
    console.error('[project-activity] 예외', e)
  }
}

// 액션·상태 한글 라벨(표시 SSOT — 드로어가 import).
export const ACTIVITY_ACTION_LABEL: Record<ProjectActivityAction, string> = {
  create: '생성', update: '수정', delete: '삭제', ai_confirm: 'AI 확정',
  link_daily: '업무 연결', unlink_daily: '업무 해제', member_change: '멤버 변경',
}
export const ACTIVITY_STATUS_LABEL: Record<ProjectActivityStatus, string> = {
  success: '성공', failure: '실패', partial: '부분 성공',
}
