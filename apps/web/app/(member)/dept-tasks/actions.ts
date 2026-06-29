'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import { kstTodayKey } from '@/lib/datetime/kst'
import { isDeptTaskStatus, normalizeProgress, sanitizeChecklist, computeProgress, compareDeptTaskUrgency, summarizeDeptTasks, type DeptTaskCounts } from '@/lib/dept-task-utils'
import type { DailyLog, DailyLogEntryType, DailyLogPriority, DailyLogThread, DeptTaskChecklistItem } from '@/types/database'

// 부서업무는 daily_logs(task_kind='dept_task')에 저장 — S1(075) 스키마 재사용.
// RLS가 부서 가시성/쓰기를 1차 강제하고, assignTask·트리거(076)가 담당자 무결성을 보강한다.
// 순수 로직(상태/진행률/체크리스트 검증)은 lib/dept-task-utils.ts(SSOT) 재사용.

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
  // 부서장 포함 — deptMemberUserIds(SSOT)가 서브트리 person + head_user_id 합집합을 반환한다.
  const candidateIds = deptMemberUserIds(scope, departmentId)
  if (candidateIds.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('profiles').select('id,name').in('id', candidateIds).is('deleted_at', null)
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

/**
 * 부서업무 상세/목록용: 원본 일일 인용 + 작성자/담당자 이름.
 * dept_task 가시성은 RLS가 1차 강제. promoted_from_log_id → 원본 일일 content 인용(서비스롤로
 * 출처 한 줄만 노출), 작성자(user_id)·담당자(assignee_user_id) 이름은 profiles로 resolve(nameMap SSOT).
 * 입력 tasks는 이미 RLS 통과한 가시 행만 들어온다는 전제(listDeptTasks 결과). 추가 노출 없음.
 */
export interface DeptTaskOrigin {
  originContent: string | null   // 원본 일일 인용(없으면 null)
}
export interface DeptTaskActorsResult {
  origins: Record<string, DeptTaskOrigin>   // deptTaskId → 원본 인용
  nameMap: Record<string, string>           // userId → 이름 (작성자·담당자)
}

export async function getDeptTaskActors(
  tasks: Array<Pick<DailyLog, 'id' | 'user_id' | 'assignee_user_id' | 'promoted_from_log_id'>>,
): Promise<DeptTaskActorsResult> {
  const empty: DeptTaskActorsResult = { origins: {}, nameMap: {} }
  if (!Array.isArray(tasks) || tasks.length === 0) return empty

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return empty

  // IDOR 방어: 클라이언트가 준 user_id/promoted_from_log_id를 신뢰하지 않는다.
  // 입력 id로 RLS(authenticated) 재조회 → 통과한 가시 행의 값만 사용.
  const ids = Array.from(new Set(
    tasks.slice(0, 500).map((t) => t.id).filter((v): v is string => typeof v === 'string' && !!v),
  ))
  if (ids.length === 0) return empty
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vis } = await (supabase.from('daily_logs') as any)
    .select('id,user_id,assignee_user_id,promoted_from_log_id')
    .eq('task_kind', 'dept_task').in('id', ids).limit(500)
  const rows = (vis ?? []) as Array<Pick<DailyLog, 'id' | 'user_id' | 'assignee_user_id' | 'promoted_from_log_id'>>
  if (rows.length === 0) return empty

  // 작성자 + 담당자 이름 resolve — 재조회로 확정된 가시 task의 관계자만 (nameMap SSOT)
  const userIds = Array.from(new Set(
    rows.flatMap((t) => [t.user_id, t.assignee_user_id]).filter(Boolean) as string[],
  ))
  let nameMap: Record<string, string> = {}
  if (userIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profs } = await (supabase.from('profiles') as any)
      .select('id,name').in('id', userIds).is('deleted_at', null)
    nameMap = Object.fromEntries(((profs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
  }

  // 원본 일일 인용 — 재조회 행의 promoted_from_log_id만, RLS(authenticated)로 content 조회.
  // 본인 가시 범위 밖 원본이면 RLS가 막아 content 미노출.
  const origins: Record<string, DeptTaskOrigin> = {}
  const srcIds = Array.from(new Set(rows.map((t) => t.promoted_from_log_id).filter(Boolean) as string[]))
  if (srcIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: srcs } = await (supabase.from('daily_logs') as any)
      .select('id,content').in('id', srcIds).limit(500)
    const contentById = Object.fromEntries(
      ((srcs ?? []) as Array<{ id: string; content: string }>).map((s) => [s.id, s.content]),
    )
    for (const t of rows) {
      if (t.promoted_from_log_id) {
        origins[t.id] = { originContent: contentById[t.promoted_from_log_id] ?? null }
      }
    }
  }

  return { origins, nameMap }
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
        log_date: kstTodayKey(), // KST 오늘(datetime SSOT) — UTC slice 금지(자정 경계 1일 오차)
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

/**
 * 일일업무 → 부서업무 승격(참조). 원본 일일 행은 그대로 두고, dept_task를 새로 만들어
 * promoted_from_log_id 로 원본을 가리킨다(복제 아님 — 출처 추적·역참조 가능).
 * 본인 소유의 personal 로그만 승격 가능. 동일 원본 재승격은 차단(멱등).
 */
export async function promoteDailyToDeptTask(
  sourceLogId: string,
  input: { departmentId: string; assigneeUserId?: string | null; targetDate?: string | null; priority?: DailyLogPriority },
): Promise<ActionResult<DailyLog>> {
  if (!sourceLogId) return { ok: false, error: '원본 업무가 없습니다.' }
  if (!input.departmentId) return { ok: false, error: '부서를 선택해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 원본 검증: 본인 소유 + personal 만
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: src } = await (supabase.from('daily_logs') as any)
    .select('id, user_id, content, task_kind, target_date, priority').eq('id', sourceLogId).single()
  if (!src) return { ok: false, error: '원본 업무를 찾을 수 없습니다.' }
  if (src.user_id !== user.id) return { ok: false, error: '본인 업무만 등록할 수 있습니다.' }
  if (src.task_kind !== 'personal') return { ok: false, error: '개인 일일업무만 부서업무로 등록할 수 있습니다.' }

  // 멱등: 이미 이 원본으로 승격된 부서업무가 있으면 차단
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: dup } = await (supabase.from('daily_logs') as any)
    .select('id').eq('promoted_from_log_id', sourceLogId).eq('task_kind', 'dept_task').limit(1)
  if (dup && dup.length > 0) return { ok: false, error: '이미 부서업무로 등록된 항목입니다.' }

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
        log_date: kstTodayKey(), // KST 오늘(datetime SSOT) — UTC slice 금지(자정 경계 1일 오차)
        content: String(src.content ?? '').trim(),
        entry_type: 'planned' as DailyLogEntryType,
        task_kind: 'dept_task',
        department_id: input.departmentId,
        assignee_user_id: assignee,
        priority: input.priority ?? src.priority ?? 'normal',
        target_date: input.targetDate ?? src.target_date ?? null,
        promoted_from_log_id: sourceLogId,   // 참조(복제 아님)
      })
      .select().single()
    if (error) return { ok: false, error: getErrorMessage(error) }
    revalidatePath('/dept-tasks')
    revalidatePath('/daily')
    return { ok: true, data: data as DailyLog }
  } catch (error: unknown) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

/**
 * 상태/진행률/체크리스트 갱신 — 담당자/작성자/부서장(RLS UPDATE 정책이 강제).
 * 진행률은 computeProgress(C 하이브리드)로 자동 산출: done→100, 체크리스트 있으면 done비율, 없으면 수동값.
 */
export async function updateDeptTaskProgress(
  id: string,
  patch: { status?: DailyLogEntryType; progress?: number; checklist?: DeptTaskChecklistItem[] },
): Promise<ActionResult<DailyLog>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  if (patch.status && !isDeptTaskStatus(patch.status)) return { ok: false, error: '잘못된 상태값입니다.' }
  if (typeof patch.progress === 'number' && normalizeProgress(patch.progress) === null) {
    return { ok: false, error: '진행률은 0~100입니다.' }
  }
  if (patch.status === undefined && patch.progress === undefined && patch.checklist === undefined) {
    return { ok: false, error: '변경 내용이 없습니다.' }
  }

  // 현재 상태/체크리스트를 읽어 진행률을 SSOT 규칙으로 재산출 (체크리스트·상태와 진행률 일관성 보장)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cur } = await (supabase.from('daily_logs') as any)
    .select('entry_type,checklist,progress').eq('id', id).eq('task_kind', 'dept_task').single()
  if (!cur) return { ok: false, error: '권한이 없거나 업무를 찾을 수 없습니다.' }

  const status = (patch.status ?? cur.entry_type) as DailyLogEntryType
  const checklist = patch.checklist ? sanitizeChecklist(patch.checklist) : (cur.checklist as DeptTaskChecklistItem[])
  const manual = typeof patch.progress === 'number' ? patch.progress : (cur.progress as number)

  const updates: Record<string, unknown> = {
    entry_type: status,
    is_resolved: status === 'done',
    progress: computeProgress(checklist, status, manual),
  }
  if (patch.checklist) updates.checklist = checklist

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

const PRIORITIES: DailyLogPriority[] = ['urgent', 'high', 'normal', 'low']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface DeptTaskEditPatch {
  content?: string
  priority?: DailyLogPriority
  targetDate?: string | null
  departmentId?: string
  checklist?: DeptTaskChecklistItem[]
}

/**
 * 부서업무 코어 필드 수정 — 제목·우선순위·마감일·부서·체크리스트.
 * 권한(D-3 권장안): 작성자 또는 부서장(editable)/admin만 코어 필드 수정 가능.
 *   담당자-only는 상태·진행률·체크리스트(updateDeptTaskProgress)만 — 코어 수정 불가.
 * 부서 변경은 부서장만 + 변경 시 담당자 초기화(076 부서소속 트리거 위반 방지).
 */
export async function updateDeptTask(id: string, patch: DeptTaskEditPatch): Promise<ActionResult<DailyLog>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 대상 업무 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: task } = await (supabase.from('daily_logs') as any)
    .select('id,user_id,department_id,task_kind').eq('id', id).eq('task_kind', 'dept_task').single()
  if (!task) return { ok: false, error: '부서업무를 찾을 수 없습니다.' }

  // 코어 수정 권한: 작성자 또는 부서장/admin
  const isAuthor = task.user_id === user.id
  if (!isAuthor) {
    const guard = await ensureEditable(user.id, task.department_id as string)
    if (!guard.ok) return { ok: false, error: '제목·마감일 등 수정은 작성자 또는 부서장만 가능합니다.' }
  }

  const updates: Record<string, unknown> = {}

  if (patch.content !== undefined) {
    if (!patch.content.trim()) return { ok: false, error: '업무 내용을 입력해 주세요.' }
    updates.content = patch.content.trim()
  }
  if (patch.priority !== undefined) {
    if (!PRIORITIES.includes(patch.priority)) return { ok: false, error: '잘못된 우선순위입니다.' }
    updates.priority = patch.priority
  }
  if (patch.targetDate !== undefined) {
    if (patch.targetDate !== null && !ISO_DATE.test(patch.targetDate)) return { ok: false, error: '마감일 형식이 올바르지 않습니다.' }
    updates.target_date = patch.targetDate
  }
  if (patch.checklist !== undefined) updates.checklist = sanitizeChecklist(patch.checklist)

  // 부서 변경: 원 부서·대상 부서 양쪽 부서장(또는 admin)만 + 담당자 초기화 (decision 2)
  // 작성자(부서원)가 자기 권한 밖 부서로 옮기는 것을 막기 위해 원 부서 권한도 검증.
  if (patch.departmentId !== undefined && patch.departmentId !== task.department_id) {
    const fromGuard = await ensureEditable(user.id, task.department_id as string)
    const toGuard = await ensureEditable(user.id, patch.departmentId)
    if (!fromGuard.ok || !toGuard.ok) {
      return { ok: false, error: '부서 변경은 원 부서·대상 부서 모두의 부서장(또는 admin)만 가능합니다.' }
    }
    updates.department_id = patch.departmentId
    updates.assignee_user_id = null
  }

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

// ── 홈 노출용: 개인/부서 챙김 큐 ──
const OPEN_STATUSES: DailyLogEntryType[] = ['planned', 'doing', 'blocker']

export type DeptHomeViewMode = 'mine' | 'dept'
export interface DeptHomeResult {
  items: DailyLog[]
  counts: DeptTaskCounts
  canViewDept: boolean
  mode: DeptHomeViewMode
  nameMap: Record<string, string>
  deptNameMap: Record<string, string>
}

/**
 * 홈 부서업무 챙김 큐. RLS가 가시범위 1차 강제 + 모드별 개인화 필터.
 * - mine: 담당자=나 OR (내 소속부서 미지정)
 * - dept: 내가 볼 수 있는 부서 전체(부서장=관할 서브트리, 부서원=소속부서)
 * 정렬=compareDeptTaskUrgency(기한경과>블로커>임박>우선순위>기한). counts는 전체 미완료 기준.
 */
export async function listHomeDeptTasks(opts: { mode?: DeptHomeViewMode; today: string }): Promise<DeptHomeResult> {
  const empty: DeptHomeResult = { items: [], counts: { total: 0, overdue: 0, blocker: 0, dueToday: 0 }, canViewDept: false, mode: 'mine', nameMap: {}, deptNameMap: {} }
  // 입력 검증 (서버액션 신뢰경계): mode 화이트리스트, today ISO 형식
  const requestedMode = opts.mode && (opts.mode === 'mine' || opts.mode === 'dept') ? opts.mode : undefined
  const today = ISO_DATE.test(opts.today) ? opts.today : kstTodayKey()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return empty

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const scope = await resolveOrgScope(admin, user.id)
  const myDeptIds = scope.nodes
    .filter((n) => n.type === 'person' && n.user_id === user.id && n.parent_id)
    .map((n) => n.parent_id as string)
  const readable = new Set(scope.readableDeptIds)
  const leader = scope.isExecutive || scope.editableDeptIds.length > 0
  const canViewDept = scope.readableDeptIds.length > 0
  const mode: DeptHomeViewMode = requestedMode ?? (leader ? 'dept' : 'mine')

  // RLS 가시 미완료 부서업무 (readable 또는 담당자=나). 기한임박 누락 방지 위해 기한순 정렬 + 상한 상향.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('daily_logs') as any)
    .select('*').eq('task_kind', 'dept_task').in('entry_type', OPEN_STATUSES)
    .order('target_date', { ascending: true, nullsFirst: false }).limit(1000)
  const all = (data ?? []) as DailyLog[]

  const myDeptSet = new Set(myDeptIds)
  const filtered = all.filter((t) => {
    if (mode === 'mine') {
      return t.assignee_user_id === user.id || (t.assignee_user_id === null && t.department_id !== null && myDeptSet.has(t.department_id))
    }
    // dept: 내가 볼 수 있는 부서에 속한 업무만
    return t.department_id !== null && readable.has(t.department_id)
  })

  filtered.sort((a, b) => compareDeptTaskUrgency(a, b, today))
  const counts = summarizeDeptTasks(filtered, today)
  const items = filtered.slice(0, 100)

  // 이름맵: 부서명(조직도 노드) + 담당자명(profiles)
  const deptNameMap: Record<string, string> = Object.fromEntries(
    scope.nodes.filter((n) => n.type === 'department').map((n) => [n.id, n.name]),
  )
  const assigneeIds = Array.from(new Set(items.map((t) => t.assignee_user_id).filter(Boolean) as string[]))
  let nameMap: Record<string, string> = {}
  if (assigneeIds.length > 0) {
    const { data: profs } = await admin.from('profiles').select('id,name').in('id', assigneeIds)
    nameMap = Object.fromEntries(((profs ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
  }

  return { items, counts, canViewDept, mode, nameMap, deptNameMap }
}

/** 사이드바 뱃지용: 내 담당 미완료 부서업무 수 */
export async function countMyOpenDeptTasks(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase.from('daily_logs') as any)
    .select('id', { count: 'exact', head: true })
    .eq('task_kind', 'dept_task').eq('assignee_user_id', user.id).in('entry_type', OPEN_STATUSES)
  return count ?? 0
}

/** AI 제안 후보 일괄 등록 — createDeptTask 재사용(루프). 부분 실패 허용, 결과 집계 반환. */
export async function createDeptTasksBulk(
  inputs: DeptTaskInput[],
): Promise<{ ok: true; created: number; failed: number; errors: string[] } | { ok: false; error: string }> {
  if (!Array.isArray(inputs) || inputs.length === 0) return { ok: false, error: '등록할 항목이 없습니다.' }
  if (inputs.length > 50) return { ok: false, error: '한 번에 최대 50개까지 등록할 수 있습니다.' }

  let created = 0
  const errors: string[] = []
  for (const input of inputs) {
    const res = await createDeptTask(input)
    if (res.ok) created += 1
    else errors.push(`${input.content.slice(0, 20)}: ${res.error}`)
  }
  return { ok: true, created, failed: errors.length, errors }
}
