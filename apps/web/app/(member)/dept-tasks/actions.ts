'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import type { DailyLog, DailyLogEntryType, DailyLogThread, DeptTaskChecklistItem } from '@/types/database'

// 부서업무는 daily_logs(task_kind='dept_task')에 저장 — S1(075) 스키마 재사용.
// RLS가 부서 가시성/쓰기를 1차 강제하고, assignTask·트리거(076)가 담당자 무결성을 보강한다.

const DEPT_TASK_STATUSES: DailyLogEntryType[] = ['planned', 'doing', 'blocker', 'done']

export interface DeptTaskInput {
  content: string
  departmentId: string
  priority?: DailyLog['priority']
  targetDate?: string | null
  assigneeUserId?: string | null
  checklist?: DeptTaskChecklistItem[]
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}

function sanitizeChecklist(items: DeptTaskChecklistItem[] | undefined): DeptTaskChecklistItem[] {
  if (!Array.isArray(items)) return []
  return items
    .filter((it) => it && typeof it.label === 'string')
    .slice(0, 50)
    .map((it) => ({ label: it.label.trim().slice(0, 500), done: Boolean(it.done) }))
}

/** 담당자 지정 후보 = 해당 부서 서브트리 소속 person */
export async function listAssigneeCandidates(
  departmentId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const admin = createAdminClient()
  const scope = await resolveOrgScope(admin, user.id)
  // IDOR 방어: 내가 볼 수 있는 부서의 후보만 노출
  if (!scope.isExecutive && !scope.readableDeptIds.includes(departmentId)) return []
  const memberIds = deptMemberUserIds(scope, departmentId)
  if (memberIds.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('profiles').select('id,name').in('id', memberIds).is('deleted_at', null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as Array<{ id: string; name: string }>).map((p) => ({ userId: p.id, name: p.name }))
}

/** 부서업무 목록 (RLS가 가시 범위 강제) */
export async function listDeptTasks(opts?: {
  departmentId?: string
  status?: DailyLogEntryType
}): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('daily_logs') as any)
    .select('*').eq('task_kind', 'dept_task')
  if (opts?.departmentId) q = q.eq('department_id', opts.departmentId)
  if (opts?.status) q = q.eq('entry_type', opts.status)
  const { data } = await q.order('target_date', { ascending: true, nullsFirst: false }).limit(500)
  return (data ?? []) as DailyLog[]
}

/** 부서업무 생성 — 부서원도 가능(RLS: readable dept). 담당자 타인 지정은 부서장만(아래 검증). */
export async function createDeptTask(input: DeptTaskInput): Promise<ActionResult<DailyLog>> {
  if (!input.content?.trim()) return { ok: false, error: '업무 내용을 입력해 주세요.' }
  if (!input.departmentId) return { ok: false, error: '부서를 선택해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 담당자를 *타인*으로 지정하려면 부서장(editable) 권한 필요 (D-3)
  const assignee = input.assigneeUserId ?? null
  if (assignee && assignee !== user.id) {
    const guard = await ensureEditable(user.id, input.departmentId)
    if (!guard.ok) return guard
  }

  try {
    const { data, error } = await (supabase.from('daily_logs') as never as {
      insert: (v: unknown) => { select: () => { single: () => Promise<{ data: DailyLog | null; error: unknown }> } }
    })
      .insert({
        user_id: user.id,
        log_date: new Date().toISOString().slice(0, 10),
        content: input.content.trim(),
        entry_type: 'planned' as DailyLogEntryType,
        task_kind: 'dept_task',
        department_id: input.departmentId,
        assignee_user_id: assignee,
        priority: input.priority ?? 'normal',
        target_date: input.targetDate ?? null,
        checklist: sanitizeChecklist(input.checklist),
      })
      .select().single()
    if (error) return { ok: false, error: getErrorMessage(error) }
    revalidatePath('/dept-tasks')
    return { ok: true, data: data as DailyLog }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/** 상태/진행률/체크리스트 갱신 — 담당자/작성자/부서장(RLS UPDATE 정책이 강제) */
export async function updateDeptTaskProgress(
  id: string,
  patch: { status?: DailyLogEntryType; progress?: number; checklist?: DeptTaskChecklistItem[] },
): Promise<ActionResult<DailyLog>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const updates: Record<string, unknown> = {}
  if (patch.status) {
    if (!DEPT_TASK_STATUSES.includes(patch.status)) return { ok: false, error: '잘못된 상태값입니다.' }
    updates.entry_type = patch.status
    updates.is_resolved = patch.status === 'done'
  }
  if (typeof patch.progress === 'number') {
    if (patch.progress < 0 || patch.progress > 100) return { ok: false, error: '진행률은 0~100입니다.' }
    updates.progress = Math.round(patch.progress)
  }
  if (patch.checklist) updates.checklist = sanitizeChecklist(patch.checklist)
  if (Object.keys(updates).length === 0) return { ok: false, error: '변경 내용이 없습니다.' }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('daily_logs') as any)
      .update(updates).eq('id', id).eq('task_kind', 'dept_task').select().single()
    if (error) return { ok: false, error: getErrorMessage(error) }
    if (!data) return { ok: false, error: '권한이 없거나 업무를 찾을 수 없습니다.' }
    revalidatePath('/dept-tasks')
    return { ok: true, data: data as DailyLog }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/** 담당자 지정/변경 — 부서장(editable)·admin만 (D-3). 트리거(076)가 부서소속 무결성 2차 검증. */
export async function assignTask(id: string, assigneeUserId: string | null): Promise<ActionResult<DailyLog>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 대상 업무의 부서 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: task } = await (supabase.from('daily_logs') as any)
    .select('id,department_id,task_kind').eq('id', id).eq('task_kind', 'dept_task').single()
  if (!task?.department_id) return { ok: false, error: '부서업무를 찾을 수 없습니다.' }

  const guard = await ensureEditable(user.id, task.department_id as string)
  if (!guard.ok) return guard

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('daily_logs') as any)
      .update({ assignee_user_id: assigneeUserId }).eq('id', id).eq('task_kind', 'dept_task').select().single()
    if (error) return { ok: false, error: getErrorMessage(error) } // 트리거: 부서 외 담당자면 여기서 거부
    revalidatePath('/dept-tasks')
    return { ok: true, data: data as DailyLog }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/** 부서업무 삭제 — 부서장·작성자(RLS DELETE 정책이 강제) */
export async function deleteDeptTask(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }
  try {
    // daily_logs는 하드삭제 방식(soft-delete 컬럼 없음) — 기존 daily 패턴과 동일
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('daily_logs') as any)
      .delete().eq('id', id).eq('task_kind', 'dept_task')
    if (error) return { ok: false, error: getErrorMessage(error) }
    revalidatePath('/dept-tasks')
    return { ok: true, data: { id } }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/** 댓글 목록 (RLS: 로그 가시자만) */
export async function getDeptTaskComments(logId: string): Promise<DailyLogThread[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('daily_log_threads') as any)
    .select('*').eq('log_id', logId).order('created_at', { ascending: true }).limit(300)
  return (data ?? []) as DailyLogThread[]
}

/** 댓글 작성 — author_user_id=본인 (RLS·트리거가 강제). parentThreadId는 동일 로그만(트리거 076). */
export async function addDeptTaskComment(
  logId: string, content: string, parentThreadId?: string | null,
): Promise<ActionResult<DailyLogThread>> {
  if (!content.trim()) return { ok: false, error: '댓글 내용을 입력해 주세요.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('daily_log_threads') as any)
      .insert({
        log_id: logId, author_type: 'user', author_user_id: user.id,
        content: content.trim(), parent_thread_id: parentThreadId ?? null,
      }).select().single()
    if (error) return { ok: false, error: getErrorMessage(error) }
    revalidatePath('/dept-tasks')
    return { ok: true, data: data as DailyLogThread }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/** 부서장(editable) 또는 admin 권한 확인 — 담당자 지정 게이트 (D-3) */
async function ensureEditable(userId: string, departmentId: string): Promise<ActionResult<true>> {
  const admin = createAdminClient()
  // admin 역할이면 통과
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prof } = await (admin as any)
    .from('profiles').select('role').eq('id', userId).is('deleted_at', null).single()
  if (prof?.role === 'admin') return { ok: true, data: true }

  const scope = await resolveOrgScope(admin, userId)
  if (scope.editableDeptIds.includes(departmentId) || scope.isExecutive) return { ok: true, data: true }
  return { ok: false, error: '담당자 지정은 부서장만 가능합니다.' }
}
