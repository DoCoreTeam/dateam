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

// ── 1) 테이블 화이트리스트 — 복구 허용 대상만. 관계/부속 테이블은 절대 추가하지 않는다. ──
const RESTORABLE_TABLES = new Set(['daily_logs', 'weekly_reports', 'projects'])

// ── 2) 컬럼 화이트리스트 — 테이블별 "사용자 콘텐츠" 필드만. 상태/관계/권한 컬럼은 제외. ──
const RESTORABLE_COLUMNS: Record<string, readonly string[]> = {
  // 제외: user_id·assignee_user_id·department_id·task_kind·ai_*·deleted_at(별도 처리)·is_resolved 등
  daily_logs: ['content', 'entry_type', 'priority', 'checklist', 'target_date', 'log_date'],
  // 제외: confirmed_at·seq·user_id·deleted_at(별도 처리)
  weekly_reports: ['performance', 'plan', 'issues', 'category'],
  // 제외: user_id·deleted_at(별도 처리)·embedding
  projects: ['name', 'year', 'quarter', 'half', 'month', 'start_date', 'end_date', 'budget', 'currency', 'status'],
}

const REVALIDATE_PATHS: Record<string, readonly string[]> = {
  daily_logs: ['/daily', '/home'],
  weekly_reports: ['/weekly-report'],
  projects: ['/work'],
}

// 현재행 조회용 SELECT 컬럼(SELECT * 금지 — 화이트리스트 필드 + 게이트 판단에 필요한 최소 컬럼만).
// 테이블별 실제 존재 컬럼만 나열(존재하지 않는 컬럼 조회 시 42703 에러 방지).
const CURRENT_ROW_SELECT: Record<string, string> = {
  daily_logs: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.daily_logs].join(', '),
  weekly_reports: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.weekly_reports].join(', '),
  projects: ['id', 'user_id', 'deleted_at', ...RESTORABLE_COLUMNS.projects].join(', '),
}

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

  const columns = RESTORABLE_COLUMNS[audit.table_name]
  const before = audit.before_json

  // ── 컬럼 화이트리스트 적용 — 화이트리스트에 없는 키는 절대 UPDATE payload에 넣지 않는다. ──
  const patch: Record<string, unknown> = {}
  for (const col of columns) {
    if (col in before) patch[col] = before[col]
  }
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
 * 확정/잠금 워크플로 게이트 — best-effort. 판정 불가/조회 실패 시 차단하지 않는다(fail-open).
 * 이 게이트는 보안 경계가 아니라 운영 워크플로 보호(취합 이후 조작 방지)이므로,
 * 화이트리스트·소유스코프 같은 하드 방어와 달리 실패를 관대하게 처리한다.
 */
function checkWorkflowLock(tableName: string, current: Record<string, unknown> | null): string | null {
  if (!current) return null
  // 주의: 현 스키마상 weekly_reports 자체에는 확정 컬럼이 없다(확정은 dept_weekly_reports.status/
  // confirmed_at 쪽에 있음 — 부서 취합 단위라 개별 행과 1:1로 안 묶임). 아래는 향후 weekly_reports에
  // confirmed_at(또는 동등한 잠금 컬럼)이 추가될 경우를 대비한 선반영 게이트 — 현재는 값이 없어
  // 항상 통과(no-op)한다. 부서 취합 잠금까지 막으려면 dept_weekly_reports 조인 조회가 필요하며,
  // 이는 이 파일 범위를 넘는 별도 작업(사용자 소속 부서 해석)이 필요해 여기서는 보류한다.
  if (tableName === 'weekly_reports' && current.confirmed_at != null) {
    return '확정된 항목은 되살릴 수 없습니다'
  }
  return null
}
