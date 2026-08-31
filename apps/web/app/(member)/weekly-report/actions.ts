'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import sanitizeHtml from 'sanitize-html'
import { recordSystemEvent } from '@/lib/system-log/record'

/**
 * 저장·삭제 결과 — **화면이 읽을 수 있는 값만** 돌려준다.
 *
 * 왜 `redirect()`를 쓰지 않는가 (실측 2026-08-31):
 *   세션이 끊긴 채 저장을 누르면 예전엔 `redirect('/login')`이 돌았다. 서버 액션에서 화면을 이탈하면
 *   Next 가 그 응답을 클라이언트로 되돌려주지 못하고(`failed to forward action response`),
 *   화면이 받는 값은 **`undefined`** 가 된다. 그러면 `result.ok` 에서 TypeError 가 터져
 *   진행 표시를 되돌리는 줄에 도달하지 못하고 버튼이 **영원히 「저장 중…」** 에 멈춘다.
 *   사용자는 이유도 모르고, 쓴 글도 잃는다.
 *
 * 그래서 실패는 **항상 값으로** 돌아온다. `reason` 이 있으면 화면이 다음 행동까지 안내할 수 있다.
 */
export type WeeklyActionResult =
  | { ok: true }
  | { ok: false; error: string; reason?: 'auth' | 'server' }

/** 저장 경로의 실패를 관리자 로그로 넘긴다 — 막지 않고, 실패해도 사용자 작업에 영향 없다 */
async function logFailure(err: unknown, feature: string, actorId?: string | null): Promise<void> {
  await recordSystemEvent({
    source: 'host_api', error: err, feature, route: '/weekly-report',
    actorId: actorId ?? null, blocksUser: true,
  }).catch(() => { /* 로그 실패가 저장 실패를 덮지 않는다 */ })
}

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
): Promise<WeeklyActionResult> {
  try {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // 화면을 이탈하지 않는다(위 WeeklyActionResult 주석 참조). 화면이 재로그인을 안내한다.
  if (!user) return { ok: false, error: '로그인이 풀려서 저장하지 못했습니다. 다시 로그인해 주세요.', reason: 'auth' }

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

  if (error) {
    // 조용히 넘기지 않는다 — 예전엔 실패가 화면에도 로그에도 남지 않았다
    await logFailure(error, 'weekly-report-save', user.id)
    return { ok: false, error: '주간보고를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', reason: 'server' }
  }

  revalidatePath('/weekly-report')
  return { ok: true }
  } catch (err) {
    // 던지면 화면이 「저장 중…」에 갇힌다. 무슨 일이 있어도 값으로 돌려준다.
    await logFailure(err, 'weekly-report-save')
    return { ok: false, error: '주간보고를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', reason: 'server' }
  }
}

// hard DELETE 사용 이유:
// Migration 002 SELECT policy = USING (deleted_at IS NULL). PostgREST의 default
// return=representation 헤더로 인해 UPDATE 후 RETURNING이 SELECT policy를 통과해야 하는데,
// soft-delete로 deleted_at을 설정하면 바로 그 조건을 위반 → RLS 에러.
// DELETE policy는 WITH CHECK 없이 USING만 검사하므로 충돌 없음.
export async function deleteAllWeeklyReports(
  weekStart: string
): Promise<WeeklyActionResult> {
  if (!weekStart) return { ok: false, error: '주차가 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '로그인이 풀려서 처리하지 못했습니다. 다시 로그인해 주세요.', reason: 'auth' }

  // 유실 0(fail-safe): 삭제 직전 현재 확정본 전체를 스냅샷(마이그144). 스냅샷이 실패하면
  // 안전망 없이 지우게 되므로 삭제를 진행하지 않는다("절대 유실" 원칙 — 안전망 우선).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: snapErr } = await (supabase as any).rpc('snapshot_weekly_report', {
    p_week_start: weekStart, p_reason: 'delete_all',
  })
  if (snapErr) {
    console.error('[deleteAllWeeklyReports] 스냅샷 실패 — 삭제 중단', snapErr)
    await logFailure(snapErr, 'weekly-report-delete-all', user.id)
    return { ok: false, error: '삭제 전 백업에 실패해 안전을 위해 삭제를 중단했습니다. 다시 시도해주세요.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weekly_reports') as any)
    .delete()
    .eq('user_id', user.id)
    .eq('week_start', weekStart)

  if (error) {
    console.error('[deleteAllWeeklyReports]', error)
    await logFailure(error, 'weekly-report-delete-all', user.id)
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
): Promise<WeeklyActionResult> {
  if (!weekStart || !category) return { ok: false, error: '주차와 구분이 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '로그인이 풀려서 처리하지 못했습니다. 다시 로그인해 주세요.', reason: 'auth' }

  // 유실 0(fail-safe): 행 삭제 직전에도 그 주차 전체를 스냅샷(마이그144). 실패 시 삭제 중단.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: snapErr } = await (supabase as any).rpc('snapshot_weekly_report', {
    p_week_start: weekStart, p_reason: 'delete_row',
  })
  if (snapErr) {
    console.error('[deleteWeeklyReport] 스냅샷 실패 — 삭제 중단', snapErr)
    await logFailure(snapErr, 'weekly-report-delete-row', user.id)
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
    await logFailure(error, 'weekly-report-delete-row', user.id)
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
): Promise<{ ok: true; weekStart: string } | { ok: false; error: string; reason?: 'auth' | 'server' }> {
  if (!snapshotId) return { ok: false, error: '스냅샷 ID가 필요합니다' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, error: '로그인이 풀려서 처리하지 못했습니다. 다시 로그인해 주세요.', reason: 'auth' }

  // RLS(wrs_select: user_id=auth.uid())로 본인 스냅샷만 조회됨 — 타인 것 접근 불가.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: snap, error: readErr } = await (supabase.from('weekly_report_snapshots') as any)
    .select('week_start, rows_json')
    .eq('id', snapshotId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (readErr) {
    console.error('[restoreWeeklyReportSnapshot] 조회 실패', readErr)
    await logFailure(readErr, 'weekly-report-restore', user.id)
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
    await logFailure(rpcErr, 'weekly-report-restore', user.id)
    return { ok: false, error: '복원 중 오류가 발생했습니다' }
  }

  revalidatePath('/weekly-report')
  return { ok: true, weekStart: snap.week_start as string }
}
