'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import sanitizeHtml from 'sanitize-html'

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'code', 'pre', 'blockquote', 'br', 'span', 'mark', 'hr'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style'],
    mark: ['data-color', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
}

function sanitize(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTS)
}

export async function upsertWeeklyReport(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const weekStart = formData.get('week_start') as string

  if (!weekStart) {
    return { ok: false, error: '주차를 선택해주세요' }
  }

  const rowCount = Math.min(Math.max(0, Number(formData.get('row_count') ?? 0)), 50)
  // 같은 카테고리라도 각 행을 독립 기록 (migration 141: seq로 구분, dedup 제거).
  // 입력 순서를 그대로 보존 → replace_weekly_report RPC가 배열 순서로 seq 부여.
  const rows: { category: string; performance: string; plan: string; issues: string }[] = []

  for (let i = 0; i < rowCount; i++) {
    const category = (formData.get(`row_category_${i}`) as string)?.trim()
    const performance = sanitize((formData.get(`row_performance_${i}`) as string) || '')
    const plan = sanitize((formData.get(`row_plan_${i}`) as string) || '')
    const issues = sanitize((formData.get(`row_issues_${i}`) as string) || '')

    if (!category || (!performance && !plan && !issues)) continue

    rows.push({ category, performance, plan, issues })
  }

  if (rows.length === 0) {
    return { ok: false, error: '최소 하나의 항목을 입력해주세요' }
  }

  // replace_weekly_report RPC: DELETE + INSERT를 단일 트랜잭션으로 실행 (migration 033)
  // 분리된 2-step으로 하면 DELETE 성공 후 INSERT 실패 시 해당 주차 데이터 전소실 위험이 있음
  // p_rows를 배열로 직접 전달 — JSON.stringify 시 Supabase가 이중 직렬화해 스칼라가 됨
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('replace_weekly_report', {
    p_week_start: weekStart,
    p_rows: rows,
  })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/weekly-report')
  return { ok: true }
}

// hard DELETE 사용 이유:
// Migration 002 SELECT policy = USING (deleted_at IS NULL). PostgREST의 default
// return=representation 헤더로 인해 UPDATE 후 RETURNING이 SELECT policy를 통과해야 하는데,
// soft-delete로 deleted_at을 설정하면 바로 그 조건을 위반 → RLS 에러.
// DELETE policy는 WITH CHECK 없이 USING만 검사하므로 충돌 없음.
export async function deleteAllWeeklyReports(
  weekStart: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!weekStart) return { ok: false, error: '주차가 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // 유실 0(fail-safe): 삭제 직전 현재 확정본 전체를 스냅샷(마이그144). 스냅샷이 실패하면
  // 안전망 없이 지우게 되므로 삭제를 진행하지 않는다("절대 유실" 원칙 — 안전망 우선).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: snapErr } = await (supabase as any).rpc('snapshot_weekly_report', {
    p_week_start: weekStart, p_reason: 'delete_all',
  })
  if (snapErr) {
    console.error('[deleteAllWeeklyReports] 스냅샷 실패 — 삭제 중단', snapErr)
    return { ok: false, error: '삭제 전 백업에 실패해 안전을 위해 삭제를 중단했습니다. 다시 시도해주세요.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any)
    .delete()
    .eq('user_id', user.id)
    .eq('week_start', weekStart)

  if (error) {
    console.error('[deleteAllWeeklyReports]', error)
    return { ok: false, error: '삭제 중 오류가 발생했습니다' }
  }

  // 활동 로그(불변 증빙): 전체 삭제 = 'delete' 기록 → 적시성 판정이 "현재 미작성"으로 정확히 반영
  // (replace_weekly_report RPC를 안 거치는 직접 삭제 경로라 여기서 별도 로깅 필요)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: logErr } = await (supabase.from('weekly_report_activity') as any).insert({
    user_id: user.id, week_start: weekStart, action: 'delete', actor_id: user.id,
  })
  if (logErr) console.error('[deleteAllWeeklyReports] activity log 실패', logErr)

  revalidatePath('/weekly-report')
  return { ok: true }
}

export async function deleteWeeklyReport(
  weekStart: string,
  category: string,
  rowId?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!weekStart || !category) return { ok: false, error: '주차와 구분이 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // 유실 0(fail-safe): 행 삭제 직전에도 그 주차 전체를 스냅샷(마이그144). 실패 시 삭제 중단.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: snapErr } = await (supabase as any).rpc('snapshot_weekly_report', {
    p_week_start: weekStart, p_reason: 'delete_row',
  })
  if (snapErr) {
    console.error('[deleteWeeklyReport] 스냅샷 실패 — 삭제 중단', snapErr)
    return { ok: false, error: '삭제 전 백업에 실패해 안전을 위해 삭제를 중단했습니다. 다시 시도해주세요.' }
  }

  // 다중 동일카테고리(mig141) 대응: rowId가 있으면 그 행만 삭제, 없으면 하위호환(카테고리 전체).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let del = (supabase.from('weekly_reports') as any)
    .delete()
    .eq('user_id', user.id)
    .eq('week_start', weekStart)
  del = rowId ? del.eq('id', rowId) : del.eq('category', category)
  const { error } = await del

  if (error) {
    console.error('[deleteWeeklyReport]', error)
    return { ok: false, error: '삭제 중 오류가 발생했습니다' }
  }

  // 활동 로그: 한 행만 삭제 → 남은 행이 있으면 'edit'(내용 변경), 전부 사라지면 'delete'.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase.from('weekly_reports') as any)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('week_start', weekStart).is('deleted_at', null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: logErr } = await (supabase.from('weekly_report_activity') as any).insert({
    user_id: user.id, week_start: weekStart,
    action: (count ?? 0) === 0 ? 'delete' : 'edit', actor_id: user.id,
  })
  if (logErr) console.error('[deleteWeeklyReport] activity log 실패', logErr)

  revalidatePath('/weekly-report')
  return { ok: true }
}

// 스냅샷 복원(마이그144): 사용자가 이전 버전을 되살린다. 복원도 replace_weekly_report 경유라
// "복원 직전 상태"가 다시 스냅샷됨 → 복원의 되돌리기 보장. 유실 0의 마지막 보루.
export async function restoreWeeklyReportSnapshot(
  snapshotId: string
): Promise<{ ok: true; weekStart: string } | { ok: false; error: string }> {
  if (!snapshotId) return { ok: false, error: '스냅샷 ID가 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '인증이 필요합니다' }

  // RLS(wrs_select: user_id=auth.uid())로 본인 스냅샷만 조회됨 — 타인 것 접근 불가.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: snap, error: readErr } = await (supabase.from('weekly_report_snapshots') as any)
    .select('week_start, rows_json')
    .eq('id', snapshotId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (readErr) {
    console.error('[restoreWeeklyReportSnapshot] 조회 실패', readErr)
    return { ok: false, error: '복원 이력 조회 중 오류가 발생했습니다' }
  }
  if (!snap) return { ok: false, error: '복원할 이력을 찾을 수 없습니다' }

  const rows = Array.isArray(snap.rows_json) ? snap.rows_json : []

  // replace_weekly_report: 복원 직전 상태 스냅샷 + 확정본을 스냅샷 시점으로 교체.
  // (빈 스냅샷 복원 = 그 시점의 "빈 상태"로 되돌림도 안전. 단 RPC는 빈 배열이면 신규행 0개.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await (supabase as any).rpc('replace_weekly_report', {
    p_week_start: snap.week_start,
    p_rows: rows,
  })

  if (rpcErr) {
    console.error('[restoreWeeklyReportSnapshot] 복원 실패', rpcErr)
    return { ok: false, error: '복원 중 오류가 발생했습니다' }
  }

  revalidatePath('/weekly-report')
  return { ok: true, weekStart: snap.week_start as string }
}
