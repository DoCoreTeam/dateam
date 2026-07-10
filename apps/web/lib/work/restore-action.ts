'use server'

// restore-action.ts — 감사이력(audit_log, 146_audit_backbone.sql) 기반 서버 복구("되살리기").
//
// 보안 설계(IDOR 차단 다중방어):
//  1) audit_log SELECT는 RLS로 owner_id=auth.uid() OR actor_id=auth.uid()만 조회 가능
//     → 남의 audit row는 애초에 이 함수에서 안 보인다(1차 방어).
//  2) 테이블 화이트리스트 — 관계/부속 테이블(work_entity_links·calendar_events·daily_log_threads 등)은
//     복구 대상에서 제외한다. 이런 테이블은 소유 스코프가 대상 엔티티에 종속되어 있어(예: 링크의
//     "소유자"가 실제로는 다른 테이블 쪽), 복구를 허용하면 권한 재획득(IDOR) 경로가 될 수 있다.
//  3) 컬럼 화이트리스트 — 각 테이블에서 "사용자 콘텐츠" 필드만 되돌린다. user_id/department_id 같은
//     소유·관계 컬럼, ai_* 같은 시스템 컬럼은 절대 복구 대상에 넣지 않는다(그 필드를 되돌리면
//     사실상 소유권 이전·권한 상승이 된다).
//  4) UPDATE는 owner_id로 재스코프(.eq('user_id', ownerId)) — RLS가 이미 걸러내지만 2중 방어.
//  5) 확정/잠금된 항목은 복구 금지(운영 워크플로 보호 — 사후 조작으로 취합 결과를 흔들지 못하게).
//
// 낙관적 잠금: 대상행이 audit 시점 이후 변경됐어도 실패시키지 않는다(단순화 — 사용자가 명시적으로
// "되살리기"를 누른 의도가 최신 상태보다 우선). 대신 이 UPDATE 자체가 fn_audit 트리거로 새
// audit_log('update') 행을 남기므로, 복구 행위 자체도 이력에 남아 추적 가능하다.

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { RESTORABLE_TABLES } from './activity-log'
import { CURRENT_ROW_SELECT, REVALIDATE_PATHS, pickRestorableColumns, checkWorkflowLock } from './restore-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type RestoreResult = { ok: true } | { ok: false; error: string }

interface AuditLogRow {
  id: number
  table_name: string
  entity_id: string | null
  op: string
  actor_id: string | null
  owner_id: string | null
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  occurred_at: string
}

// 테이블 화이트리스트 = activity-log.ts SSOT(RESTORABLE_TABLES) / 컬럼·SELECT·게이트 = restore-core.ts SSOT.
// (이중선언 금지 — 피드 노출과 복구 허용이 한 소스로 일치해야 드리프트 없음.)

/**
 * 감사이력의 특정 항목(audit_log.id)을 근거로 이전 상태(before_json)를 현재 행에 되돌린다.
 * - 인증 필요(createClient = 사용자 세션). 미인증이면 에러.
 * - RLS로 본인 소유/행위 이력만 조회 가능 — 남의 audit row는 조회 자체가 안 됨.
 * - 화이트리스트 밖 테이블/컬럼은 절대 건드리지 않는다.
 */
export async function restoreFromAudit(auditId: number): Promise<RestoreResult> {
  const supabase = await createClient()
  const { data: userRes, error: authErr } = await supabase.auth.getUser()
  if (authErr || !userRes?.user) {
    return { ok: false, error: '인증이 필요합니다' }
  }

  const { data: auditRow, error: auditErr } = await (supabase as Db)
    .from('audit_log')
    .select('id, table_name, entity_id, op, actor_id, owner_id, before_json, after_json, occurred_at')
    .eq('id', auditId)
    .single()

  if (auditErr || !auditRow) {
    // RLS로 남의 것이면 여기서 그냥 "없음"으로 조회됨 — 존재 여부 자체를 흘리지 않는 안전한 에러 메시지.
    return { ok: false, error: '되살릴 이력을 찾을 수 없습니다' }
  }

  const audit = auditRow as AuditLogRow

  // ── 테이블 화이트리스트 ──
  if (!RESTORABLE_TABLES.has(audit.table_name)) {
    return { ok: false, error: '이 항목은 되살리기를 지원하지 않습니다' }
  }
  if (!audit.entity_id || !audit.owner_id) {
    return { ok: false, error: '되살릴 대상을 식별할 수 없습니다' }
  }
  if (!audit.before_json) {
    return { ok: false, error: '복구할 이전 상태가 없습니다' }
  }

  // ── 컬럼 화이트리스트 적용 — 화이트리스트에 없는 키는 절대 UPDATE payload에 넣지 않는다. ──
  const patch = pickRestorableColumns(audit.table_name, audit.before_json)
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: '복구할 수 있는 필드가 없습니다' }
  }

  // ── 현재행 조회(워크플로 게이트 + 소프트삭제 여부 판단) ──
  const { data: current, error: currentErr } = await (supabase as Db)
    .from(audit.table_name)
    .select(CURRENT_ROW_SELECT[audit.table_name])
    .eq('id', audit.entity_id)
    .eq('user_id', audit.owner_id)
    .maybeSingle()

  if (currentErr) {
    return { ok: false, error: '현재 상태를 조회하지 못했습니다' }
  }
  if (!current) {
    // 완전삭제(하드 delete)된 행의 되살리기는 미지원 — INSERT 재생성은 별도 정책 결정 필요.
    return { ok: false, error: '되살릴 대상 행이 존재하지 않습니다' }
  }

  // ── 워크플로 게이트 — 확정/잠금된 항목은 복구 금지 ──
  const lockError = checkWorkflowLock(audit.table_name, current)
  if (lockError) {
    return { ok: false, error: lockError }
  }

  const updatePayload: Record<string, unknown> = { ...patch }
  if (current.deleted_at != null) {
    updatePayload.deleted_at = null // 소프트삭제 되살리기 — 같은 id 부활
  }

  // ── 소유 스코프 재확인 UPDATE (RLS 2중방어: 남의 행은 절대 못 건드림) ──
  const { error: updateErr } = await (supabase as Db)
    .from(audit.table_name)
    .update(updatePayload)
    .eq('id', audit.entity_id)
    .eq('user_id', audit.owner_id)

  if (updateErr) {
    return { ok: false, error: '되살리기에 실패했습니다' }
  }

  for (const path of REVALIDATE_PATHS[audit.table_name] ?? []) {
    revalidatePath(path)
  }

  return { ok: true }
}

/**
 * 프로젝트 되돌리기 — project_activity(감사로그)의 before_snapshot을 근거로 이전 상태로 복구.
 * audit_log가 projects를 캡처하지 않으므로 project_activity를 복원 근거로 사용(SSOT 동일 정책:
 * 화이트리스트 컬럼만·소유 스코프 재확인·소프트삭제 부활). RLS로 본인 project_activity만 조회됨.
 */
export async function restoreProject(activityId: string): Promise<RestoreResult> {
  const supabase = await createClient()
  const { data: userRes, error: authErr } = await supabase.auth.getUser()
  if (authErr || !userRes?.user) return { ok: false, error: '인증이 필요합니다' }

  const { data: actRow, error: actErr } = await (supabase as Db)
    .from('project_activity')
    .select('id, project_id, user_id, before_snapshot')
    .eq('id', activityId)
    .single()

  if (actErr || !actRow) return { ok: false, error: '되살릴 이력을 찾을 수 없습니다' }
  const act = actRow as { project_id: string | null; user_id: string | null; before_snapshot: Record<string, unknown> | null }

  if (!act.project_id || !act.user_id) return { ok: false, error: '되살릴 대상을 식별할 수 없습니다' }
  // IDOR 하드가드 — RLS로 본인 activity만 조회되지만, 명시적으로 소유자=인증사용자 재확인(2중방어).
  if (act.user_id !== userRes.user.id) return { ok: false, error: '권한이 없습니다' }
  if (!act.before_snapshot) return { ok: false, error: '복구할 이전 상태가 없습니다' }

  const patch = pickRestorableColumns('projects', act.before_snapshot)
  if (Object.keys(patch).length === 0) return { ok: false, error: '복구할 수 있는 필드가 없습니다' }

  const { data: current, error: currentErr } = await (supabase as Db)
    .from('projects')
    .select(CURRENT_ROW_SELECT.projects)
    .eq('id', act.project_id)
    .eq('user_id', act.user_id)
    .maybeSingle()

  if (currentErr) return { ok: false, error: '현재 상태를 조회하지 못했습니다' }
  if (!current) return { ok: false, error: '되살릴 대상 행이 존재하지 않습니다' }

  const updatePayload: Record<string, unknown> = { ...patch }
  if (current.deleted_at != null) updatePayload.deleted_at = null

  const { error: updateErr } = await (supabase as Db)
    .from('projects')
    .update(updatePayload)
    .eq('id', act.project_id)
    .eq('user_id', act.user_id)

  if (updateErr) return { ok: false, error: '되살리기에 실패했습니다' }

  for (const path of REVALIDATE_PATHS.projects) revalidatePath(path)
  return { ok: true }
}
