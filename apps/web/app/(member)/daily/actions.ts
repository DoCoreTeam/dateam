'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveOrgScope } from '@/lib/org-scope'
import { embedText, toVectorLiteral } from '@/lib/gemini-embedding'
import { recordFeedbackSignal, diffDailyLog } from '@/lib/daily/feedback-signals'
import { logActivity } from '@/lib/work/activity-log'
import type {
  DailyLog, DailyLogEntryType, DailyLogPriority,
  DailyLogRelation, DailyLogRelationType,
  DailyLogThread, DailyLogTag, MemoStatus,
} from '@/types/database'

// ── 메모 임베딩 헬퍼 ──────────────────────────────────────────────
// Gemini API 키를 org_content META에서 조회 (없으면 env fallback)
async function getGeminiApiKey(): Promise<string> {
  try {
    const adm = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (adm as any).from('org_content').select('value').eq('key', 'META').single()
    const meta = (data?.value ?? {}) as Record<string, unknown>
    return (meta.gemini_api_key as string) || process.env.GEMINI_API_KEY || ''
  } catch {
    return process.env.GEMINI_API_KEY || ''
  }
}

// 메모 행에 임베딩 생성 후 저장 (실패해도 메모 자체는 유지 — best effort)
async function embedMemoRow(logId: string, userId: string, content: string): Promise<void> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return
  const result = await embedText(content, apiKey, userId)
  if (!result) return
  try {
    const adm = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adm as any).from('daily_logs')
      .update({ embedding: toVectorLiteral(result.embedding) })
      .eq('id', logId)
      .eq('user_id', userId)
  } catch (e) {
    console.error('[embedMemoRow] failed', e)
  }
}

// autolink 사전계산 큐 적재 (best-effort — 실패해도 업무 저장 응답은 비차단).
// note(메모)는 autolink 대상이 아니므로 호출처에서 제외하고 넘긴다.
// RLS상 insert 정책은 service_role 전용 → createAdminClient로 upsert.
async function enqueueAutolinkJobs(jobs: Array<{ logId: string; requesterId: string }>): Promise<void> {
  if (jobs.length === 0) return
  try {
    const adm = createAdminClient()
    const rows = jobs.map((j) => ({
      log_id: j.logId,
      requester_id: j.requesterId,
      status: 'pending' as const,
      attempts: 0,
      last_error: null,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adm as any).from('autolink_jobs').upsert(rows, { onConflict: 'log_id' })
  } catch (e) {
    console.error('[enqueueAutolinkJobs] failed', e)
  }
}

function revalidateDailyCalendarViews() {
  revalidatePath('/daily')
  revalidatePath('/calendar')
}

export interface AiParsedItem {
  title: string
  status: DailyLogEntryType
  scheduledDate: string | null
  scheduledTime: string | null
  // 관계 시스템 필드
  targetDate: string | null
  targetDateCertainty: 'exact' | 'inferred' | 'none'
  tags: string[]
  originGroupId: string | null
  promptVersion: string | null
  priority: DailyLogPriority
  accountId: string | null
  contactId: string | null
  accountName: string | null
  contactName: string | null
  confidence: number
  originalInput: string
}

export interface DayLogSummary {
  date: string
  total: number
  hasBlocker: boolean
  counts: Record<DailyLogEntryType, number>
  preview: {
    id: string
    entry_type: DailyLogEntryType
    content: string
    target_date: string | null
    scheduled_at: string | null
    logged_at: string | null
  }[]
}

export async function getMonthLogSummary(year: number, month: number): Promise<DayLogSummary[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const MONTH_LIMIT = 2000
  const { data } = await (supabase.from('daily_logs') as any)
    .select('id, log_date, entry_type, content, target_date, scheduled_at, logged_at, ai_processed, source_type, origin_group_id')
    .eq('user_id', user.id)
    .gte('log_date', from)
    .lte('log_date', to)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(MONTH_LIMIT)

  if (data?.length === MONTH_LIMIT) {
    console.warn('[daily] getMonthLogSummary limit reached — possible truncation')
  }

  const map = new Map<string, DayLogSummary>()
  for (const row of (data ?? []) as {
    id: string
    log_date: string
    entry_type: DailyLogEntryType
    content: string
    target_date: string | null
    scheduled_at: string | null
    logged_at: string | null
    ai_processed: boolean
    source_type: string | null
    origin_group_id: string | null
  }[]) {
    // 원문 raw 헤드(헤더 전용 행)는 캘린더 카운트/프리뷰에서 제외
    if (row.ai_processed === false && row.source_type === 'manual' && row.origin_group_id != null) continue
    if (!map.has(row.log_date)) {
      map.set(row.log_date, {
        date: row.log_date,
        total: 0,
        hasBlocker: false,
        counts: { done: 0, doing: 0, planned: 0, blocker: 0, note: 0 },
        preview: [],
      })
    }
    const s = map.get(row.log_date)!
    s.total++
    s.counts[row.entry_type]++
    if (row.entry_type === 'blocker') s.hasBlocker = true
    if (s.preview.length < 2) {
      s.preview.push({
        id: row.id,
        entry_type: row.entry_type,
        content: row.content,
        target_date: row.target_date ?? null,
        scheduled_at: row.scheduled_at ?? null,
        logged_at: row.logged_at ?? null,
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export async function getWeekLogs(weekStart: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`

  const WEEK_LIMIT = 1000
  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .gte('log_date', weekStart)
    .lte('log_date', to)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(WEEK_LIMIT)

  if (data?.length === WEEK_LIMIT) {
    console.warn('[daily] getWeekLogs limit reached — possible truncation')
  }

  return (data ?? []) as DailyLog[]
}

export async function getDailyLogs(date: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const DAY_LIMIT = 500
  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('task_kind', 'personal')   // 일일=개인 업무만 (부서업무 역류 제거)
    .eq('log_date', date)
    .order('logged_at', { ascending: true })
    .limit(DAY_LIMIT)

  if (data?.length === DAY_LIMIT) {
    console.warn('[daily] getDailyLogs limit reached — possible truncation')
  }

  return (data ?? []) as DailyLog[]
}

// 캘린더 날짜 클릭용 — log_date OR target_date가 해당 날짜인 로그 모두 반환
export async function getCalendarDayLogs(date: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .or(`log_date.eq.${date},target_date.eq.${date}`)
    .order('logged_at', { ascending: true })
    .limit(500)

  const rows = (data ?? []) as DailyLog[]
  // 동일 id 중복 제거 (log_date=date AND target_date=date인 경우)
  return Array.from(new Map(rows.map(r => [r.id, r])).values())
}

export async function addDailyLog(
  content: string,
  entryType: DailyLogEntryType,
  logDate: string
): Promise<{ ok: true; data: DailyLog } | { ok: false; error: string }> {
  if (!content.trim()) return { ok: false, error: '내용을 입력해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const isNote = entryType === 'note'
  const { data, error } = await (supabase.from('daily_logs') as any)
    .insert({
      user_id: user.id,
      log_date: logDate,
      content: content.trim(),
      entry_type: entryType,
      ...(isNote ? { memo_status: 'new' as MemoStatus } : {}),
    })
    .select()
    .single()

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'create', status: 'failure',
      actorId: user.id, ownerId: user.id, title: content.trim(), error,
    })
    return { ok: false, error: (error as Error).message }
  }

  // 메모면 임베딩 생성 (best effort — 실패해도 메모는 저장됨)
  if (isNote && data?.id) {
    await embedMemoRow(data.id as string, user.id, content.trim())
  }

  // 비note 업무는 autolink 사전계산 큐에 적재 (best-effort, 응답 비차단)
  if (!isNote && data?.id) {
    await enqueueAutolinkJobs([{ logId: data.id as string, requesterId: user.id }])
  }

  await logActivity(supabase, {
    module: 'daily', action: 'create', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: data?.id ?? null,
    title: content.trim(), after: data,
  })

  revalidateDailyCalendarViews()
  return { ok: true, data: data as DailyLog }
}

/**
 * 원문 raw 헤드 1행 즉시 저장 (즉시저장 → 백그라운드 AI분해 흐름의 1단계).
 *
 * AI 분석 전에 사용자가 입력한 원문을 그대로 1건 INSERT한다. 이 행이 OriginGroupCard의
 * 헤더(원문)가 되며, 이후 같은 origin_group_id로 AI 분해 자식(addMultipleDailyLogs)이 붙는다.
 * - ai_processed=false, source_type='manual' → 표시 단계에서 자식 카드와 구분(헤더 전용).
 * - original_input=원문 → 헤더 텍스트 소스(편집/보존 대상).
 * AI가 실패/0건이어도 이 행은 남으므로 원문이 보존된다.
 */
export async function addRawDailyLog(
  text: string,
  logDate: string,
  originGroupId: string,
  isOnboarding = false
): Promise<{ ok: true; data: DailyLog } | { ok: false; error: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: '내용을 입력해 주세요.' }
  // 입력 상한 — updateOriginInput과 동일 가드(즉시저장 경로 일관성). DoS/토큰비용 방어.
  if (trimmed.length > 10000) return { ok: false, error: '입력이 너무 깁니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // origin_group_id는 daily_log_origin_groups(id) FK(022) — 먼저 그룹 행을 만들어야 한다.
  // 클라이언트 생성 UUID를 명시 삽입해 raw 헤드·AI 분해 자식이 같은 그룹을 공유하게 한다.
  const { error: groupError } = await (supabase.from('daily_log_origin_groups') as any)
    .insert({ id: originGroupId, user_id: user.id, original_input: trimmed })
  if (groupError) {
    // 원문 에러(예: PK 중복) 노출 시 그룹 존재 추정 oracle → generic 마스킹 + 서버 로그.
    console.error('[addRawDailyLog] origin group insert failed', groupError)
    await logActivity(supabase, {
      module: 'daily', action: 'create', status: 'failure',
      actorId: user.id, ownerId: user.id, title: trimmed, error: groupError,
      evidence: { raw: true, stage: 'origin_group' },
    })
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }

  const { data, error } = await (supabase.from('daily_logs') as any)
    .insert({
      user_id: user.id,
      log_date: logDate,
      content: trimmed,
      entry_type: 'doing',
      ai_processed: false,
      original_input: trimmed,
      origin_group_id: originGroupId,
      source_type: 'manual' as const,
      is_onboarding: isOnboarding,
    })
    .select()
    .single()

  if (error) {
    // 그룹은 만들어졌는데 로그 INSERT 실패 → orphan 그룹 best-effort 정리(트랜잭션 미지원 보완).
    await (supabase.from('daily_log_origin_groups') as any).delete().eq('id', originGroupId).eq('user_id', user.id)
    console.error('[addRawDailyLog] daily_logs insert failed', error)
    await logActivity(supabase, {
      module: 'daily', action: 'create', status: 'failure',
      actorId: user.id, ownerId: user.id, title: trimmed, error,
      evidence: { raw: true, stage: 'daily_logs' },
    })
    return { ok: false, error: '저장 중 오류가 발생했습니다.' }
  }

  await logActivity(supabase, {
    module: 'daily', action: 'create', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: data?.id ?? null,
    title: trimmed, after: data, evidence: { raw: true },
  })

  revalidateDailyCalendarViews()
  return { ok: true, data: data as DailyLog }
}

export async function updateDailyLog(
  id: string,
  content: string,
  entryType: DailyLogEntryType,
  targetDate?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!content.trim()) return { ok: false, error: '내용을 입력해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 피드백 신호: 변경 전 상태 조회 (best-effort — 실패해도 수정 진행)
  let beforeRow: { ai_processed?: boolean; content?: string | null; entry_type?: DailyLogEntryType; target_date?: string | null; origin_group_id?: string | null; ai_confidence?: number | null; original_input?: string | null } | null = null
  try {
    const { data } = await (supabase.from('daily_logs') as any)
      .select('ai_processed, content, entry_type, target_date, origin_group_id, ai_confidence, original_input')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    beforeRow = data ?? null
  } catch (e) {
    console.error('[updateDailyLog] feedback pre-fetch failed', e)
  }

  const updatePayload: Record<string, unknown> = {
    content: content.trim(),
    entry_type: entryType,
    updated_at: new Date().toISOString(),
  }
  if (targetDate !== undefined) {
    updatePayload.target_date = targetDate || null
    if (targetDate) updatePayload.target_date_set_by = 'user'
  }

  // 메모로 전환되거나 메모 내용이 바뀌면 임베딩 재생성 + 신규 상태 (note만)
  if (entryType === 'note') {
    updatePayload.memo_status = 'new'
  }

  const { error } = await (supabase.from('daily_logs') as any)
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'update', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: id,
      title: content.trim(), before: beforeRow, error,
    })
    return { ok: false, error: (error as Error).message }
  }

  // AI 파생 항목 수정 = correct_* 신호. target_date 는 호출에 포함된 경우만 비교.
  if (beforeRow?.ai_processed) {
    const diffs = diffDailyLog(
      { content: beforeRow.content, entry_type: beforeRow.entry_type, target_date: beforeRow.target_date },
      { content: content.trim(), entry_type: entryType, ...(targetDate !== undefined ? { target_date: targetDate || null } : {}) },
    )
    for (const d of diffs) {
      await recordFeedbackSignal(supabase, {
        userId: user.id,
        logId: id,
        originGroupId: beforeRow.origin_group_id ?? null,
        signalType: d.signal_type,
        field: d.field,
        before: d.before,
        after: d.after,
        originalInput: beforeRow.original_input ?? null,
        aiConfidence: beforeRow.ai_confidence ?? null,
      })
    }
  }

  if (entryType === 'note') {
    await embedMemoRow(id, user.id, content.trim())
  }

  await logActivity(supabase, {
    module: 'daily', action: 'update', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: id,
    title: content.trim(), before: beforeRow, after: updatePayload,
  })

  revalidateDailyCalendarViews()
  return { ok: true }
}

export async function updateDailyLogStatus(
  id: string,
  entryType: DailyLogEntryType,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 피드백 신호: 변경 전 타입 조회 (best-effort)
  let beforeRow: { ai_processed?: boolean; entry_type?: DailyLogEntryType; origin_group_id?: string | null; ai_confidence?: number | null; original_input?: string | null } | null = null
  try {
    const { data } = await (supabase.from('daily_logs') as any)
      .select('ai_processed, entry_type, origin_group_id, ai_confidence, original_input')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    beforeRow = data ?? null
  } catch (e) {
    console.error('[updateDailyLogStatus] feedback pre-fetch failed', e)
  }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({
      entry_type: entryType,
      updated_at: new Date().toISOString(),
      // done으로 변경 시 이월 목록에서 제거 (resolveCarryoverLog와 동일 정책)
      is_resolved: entryType === 'done',
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'status_change', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: id,
      before: beforeRow, error, evidence: { entryType },
    })
    return { ok: false, error: (error as Error).message }
  }

  // AI 파생 항목 타입 변경 = correct_type 신호
  if (beforeRow?.ai_processed && (beforeRow.entry_type ?? null) !== entryType) {
    await recordFeedbackSignal(supabase, {
      userId: user.id,
      logId: id,
      originGroupId: beforeRow.origin_group_id ?? null,
      signalType: 'correct_type',
      field: 'entry_type',
      before: beforeRow.entry_type ?? null,
      after: entryType,
      originalInput: beforeRow.original_input ?? null,
      aiConfidence: beforeRow.ai_confidence ?? null,
    })
  }

  await logActivity(supabase, {
    module: 'daily', action: 'status_change', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: id,
    before: beforeRow, after: { entry_type: entryType }, evidence: { entryType },
  })

  revalidateDailyCalendarViews()
  return { ok: true }
}

export async function deleteDailyLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 피드백 신호: 삭제 전 AI 파생 여부 + 맥락 조회 (best-effort — 실패해도 삭제 진행)
  let aiContext: { ai_processed?: boolean; content?: string | null; original_input?: string | null; origin_group_id?: string | null; ai_confidence?: number | null } | null = null
  try {
    const { data } = await (supabase.from('daily_logs') as any)
      .select('ai_processed, content, original_input, origin_group_id, ai_confidence')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    aiContext = data ?? null
  } catch (e) {
    console.error('[deleteDailyLog] feedback pre-fetch failed', e)
  }

  const { error } = await (supabase.from('daily_logs') as any)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'delete', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: id,
      title: aiContext?.content ?? null, before: aiContext, error,
    })
    return { ok: false, error: (error as Error).message }
  }

  // AI 파생 항목 삭제 = reject 신호 (수동 항목은 신호 안 냄).
  // logId=null: 행이 이미 삭제돼 FK 참조 불가(23503 방지). 맥락은 content(거부된 항목)+원본+그룹으로 보존.
  if (aiContext?.ai_processed) {
    await recordFeedbackSignal(supabase, {
      userId: user.id,
      logId: null,
      originGroupId: aiContext.origin_group_id ?? null,
      signalType: 'reject',
      field: 'content',
      before: aiContext.content ?? null,
      originalInput: aiContext.original_input ?? null,
      aiConfidence: aiContext.ai_confidence ?? null,
    })
  }

  // cascade: 이 업무에 연결된 캘린더 일정(link_kind='daily')도 삭제 (best effort — 실패 무해)
  try {
    await (supabase.from('calendar_events') as any)
      .delete()
      .eq('user_id', user.id)
      .eq('link_kind', 'daily')
      .eq('link_id', id)
  } catch (e) {
    console.error('[deleteDailyLog] calendar cascade failed', e)
  }

  await logActivity(supabase, {
    module: 'daily', action: 'delete', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: id,
    title: aiContext?.content ?? null, before: aiContext,
  })

  revalidateDailyCalendarViews()
  return { ok: true }
}

export async function getTodayPlannedCount(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
  const { count } = await (supabase.from('daily_logs') as any)
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('log_date', today)
    .eq('entry_type', 'planned')

  return count ?? 0
}

// 이월된 미완료 항목 조회 (오늘 기준 최근 7일, planned/doing/blocker 중 is_resolved=false)
export async function getCarryoverLogs(today: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const sevenDaysAgo = new Date(today + 'T00:00:00')
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const from = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`

  const CARRYOVER_LIMIT = 100
  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('is_resolved', false)
    .in('entry_type', ['planned', 'doing', 'blocker'])
    .gte('log_date', from)
    .lt('log_date', today)
    .order('log_date', { ascending: false })
    .order('logged_at', { ascending: true })
    .limit(CARRYOVER_LIMIT)

  if (data?.length === CARRYOVER_LIMIT) {
    console.warn('[daily] getCarryoverLogs limit reached — possible truncation')
  }

  return (data ?? []) as DailyLog[]
}

// 이월 항목 완료 처리 (entry_type→done, is_resolved→true)
export async function resolveCarryoverLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ entry_type: 'done', is_resolved: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true }
}

// 이월 항목 오늘로 이동 (log_date→오늘)
export async function moveCarryoverToToday(id: string, today: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ log_date: today, logged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true }
}

// 이월 항목 무시 (is_resolved→true)
export async function ignoreCarryoverLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ is_resolved: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true }
}

// 이월 항목 일괄 오늘로 이동 (log_date→오늘, 본인 소유만)
export async function moveAllCarryoverToToday(ids: string[], today: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, count: 0 }
  if (ids.length > 100) return { ok: false, error: '한 번에 최대 100건까지 이동할 수 있습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ log_date: today, logged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true, count: ids.length }
}

// 이월 항목 무시 되돌리기 (is_resolved→false, entry_type 유지)
export async function unignoreCarryoverLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ is_resolved: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true }
}

export async function addMultipleDailyLogs(
  items: AiParsedItem[],
  logDate: string,
  parentLogId?: string,
  isOnboarding = false
): Promise<{ ok: true; data: DailyLog[] } | { ok: false; error: string }> {
  if (items.length === 0) return { ok: false, error: '저장할 항목이 없습니다.' }
  if (items.length > 100) return { ok: false, error: '한 번에 최대 100개까지 저장할 수 있습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // origin_group_id는 모든 항목이 공유 (같은 입력에서 분리)
  const originGroupId = items[0]?.originGroupId ?? null

  const rows = items.map((item) => {
    const scheduledAt = item.scheduledDate
      ? item.scheduledTime
        ? `${item.scheduledDate}T${item.scheduledTime}:00+09:00`
        : `${item.scheduledDate}T00:00:00+09:00`
      : null

    const targetDate = item.targetDate ?? null
    // targetDateCertainty가 none이거나 status=note면 target_date_set_by 없음
    const targetDateSetBy = targetDate && item.targetDateCertainty !== 'none' ? 'ai' as const : null

    return {
      user_id: user.id,
      log_date: logDate,
      content: item.title,
      // 일일업무는 '블로커' 미사용(부서업무 전용) → AI가 blocker로 분류해도 doing으로 흡수
      entry_type: item.status === 'blocker' ? 'doing' : item.status,
      priority: item.priority,
      scheduled_at: scheduledAt,
      ai_processed: true,
      ai_confidence: item.confidence,
      original_input: item.originalInput,
      linked_account_id: item.accountId ?? null,
      linked_contact_id: item.contactId ?? null,
      // 관계 시스템 필드
      target_date: targetDate,
      target_date_set_by: targetDateSetBy,
      origin_group_id: originGroupId,
      source_type: parentLogId ? 'thread_derived' as const : 'ai_split' as const,
      parent_log_id: parentLogId ?? null,
      // 온보딩 실습 등록 격리(집계/AI/롤업 제외 — 마이그113/114 + T-2 필터 의존)
      is_onboarding: isOnboarding,
      // 메모는 신규 상태로 (042) — 임베딩은 저장 후 별도 처리
      ...(item.status === 'note' ? { memo_status: 'new' as MemoStatus } : {}),
    }
  })

  // 취약점 5 방어: 단일 트랜잭션으로 전체 저장
  const { data, error } = await (supabase.from('daily_logs') as any)
    .insert(rows)
    .select()

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'create', status: 'failure',
      actorId: user.id, ownerId: user.id, error,
      evidence: { bulk: true, count: items.length },
    })
    return { ok: false, error: (error as Error).message }
  }

  const savedLogs = data as DailyLog[]

  // 태그 저장 (fire-and-forget — 태그 실패가 업무 저장을 막지 않음)
  const tagRows = items.flatMap((item, idx) => {
    const logId = savedLogs[idx]?.id
    if (!logId) return []
    return (item.tags ?? []).map(tag => ({
      log_id: logId,
      tag_name: tag,
      tag_type: 'ai' as const,
    }))
  })

  if (tagRows.length > 0) {
    await (supabase.from('daily_log_tags') as any)
      .upsert(tagRows, { onConflict: 'log_id,tag_name', ignoreDuplicates: true })
  }

  // 메모(note) 항목 임베딩 생성 (best effort, 순차)
  const noteLogs = savedLogs.filter((l) => l.entry_type === 'note')
  for (const note of noteLogs) {
    await embedMemoRow(note.id, user.id, note.content)
  }

  // 비note 업무 일괄 autolink 큐 적재 (best-effort, 응답 비차단)
  await enqueueAutolinkJobs(
    savedLogs
      .filter((l) => l.entry_type !== 'note' && l.id)
      .map((l) => ({ logId: l.id, requesterId: user.id }))
  )

  await logActivity(supabase, {
    module: 'daily', action: 'create', status: 'success',
    actorId: user.id, ownerId: user.id,
    title: savedLogs[0]?.content ?? null, after: { ids: savedLogs.map((l) => l.id) },
    evidence: { bulk: true, count: savedLogs.length },
  })

  revalidateDailyCalendarViews()
  return { ok: true, data: savedLogs }
}

// ─── 스레드 CRUD ────────────────────────────────────────────

export async function getThreads(logId: string): Promise<DailyLogThread[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_log_threads') as any)
    .select('*')
    .eq('log_id', logId)
    .order('created_at', { ascending: true })
    .limit(200)

  return (data ?? []) as DailyLogThread[]
}

export async function addThread(
  logId: string,
  content: string
): Promise<{ ok: true; data: DailyLogThread } | { ok: false; error: string }> {
  if (!content.trim()) return { ok: false, error: '내용을 입력해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { data, error } = await (supabase.from('daily_log_threads') as any)
    .insert({ log_id: logId, author_type: 'user', content: content.trim() })
    .select()
    .single()

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true, data: data as DailyLogThread }
}

// ─── 태그 CRUD ──────────────────────────────────────────────

export async function getTags(logId: string): Promise<DailyLogTag[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_log_tags') as any)
    .select('*')
    .eq('log_id', logId)
    .order('created_at', { ascending: true })

  return (data ?? []) as DailyLogTag[]
}

export async function addTag(
  logId: string,
  tagName: string,
  tagType: 'ai' | 'user' = 'user'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_log_tags') as any)
    .upsert({ log_id: logId, tag_name: tagName.trim(), tag_type: tagType }, { onConflict: 'log_id,tag_name', ignoreDuplicates: true })

  if (error) return { ok: false, error: (error as Error).message }
  return { ok: true }
}

// ─── 관계 CRUD ──────────────────────────────────────────────

export async function getRelations(logId: string): Promise<DailyLogRelation[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_log_relations') as any)
    .select('*')
    .or(`from_log_id.eq.${logId},to_log_id.eq.${logId}`)
    .order('created_at', { ascending: true })
    .limit(100)

  return (data ?? []) as DailyLogRelation[]
}

export async function addRelation(
  fromLogId: string,
  toLogId: string,
  relationType: DailyLogRelationType,
  createdBy: 'ai' | 'user' = 'user'
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fromLogId === toLogId) return { ok: false, error: '자기 자신과의 관계는 추가할 수 없습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_log_relations') as any)
    .upsert(
      { from_log_id: fromLogId, to_log_id: toLogId, relation_type: relationType, created_by: createdBy },
      { onConflict: 'from_log_id,to_log_id,relation_type', ignoreDuplicates: true }
    )

  if (error) return { ok: false, error: (error as Error).message }
  return { ok: true }
}

/**
 * 중복 의심 항목을 "병합 요청"으로 연결한다 (P1).
 *
 * 비파괴: 원본/항목을 삭제·수정하지 않는다. daily_log_relations 에 관계 1건만
 * 추가한다(relation_type='related' — 022 스키마 enum에 'duplicate'가 없으므로
 * 가장 가까운 'related' 사용, created_by='user'). 중복 INSERT 는 addRelation 의
 * upsert(ignoreDuplicates)가 가드한다. RLS는 from_log 의 user_id 기준.
 */
export async function linkDuplicate(
  sourceId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return addRelation(sourceId, targetId, 'related', 'user')
}

// ─── 같은 묶음(origin_group) 업무 조회 ──────────────────────

export async function getOriginGroupLogs(originGroupId: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('origin_group_id', originGroupId)
    .eq('user_id', user.id)
    .order('logged_at', { ascending: true })
    .limit(50)

  return (data ?? []) as DailyLog[]
}

// ─── target_date 업데이트 ────────────────────────────────────

export async function updateTargetDate(
  logId: string,
  targetDate: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({
      target_date: targetDate,
      target_date_set_by: targetDate ? 'user' : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidateDailyCalendarViews()
  return { ok: true }
}

// ─── 메모 lifecycle: 확인/보관 ───────────────────────────────

export async function setMemoStatus(
  logId: string,
  status: MemoStatus
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({
      memo_status: status,
      memo_reviewed_at: status === 'new' ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', logId)
    .eq('user_id', user.id)
    .eq('entry_type', 'note')

  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'memo', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: logId, error,
      evidence: { status },
    })
    return { ok: false, error: (error as Error).message }
  }

  await logActivity(supabase, {
    module: 'daily', action: 'memo', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: logId,
    after: { memo_status: status }, evidence: { status },
  })

  revalidatePath('/daily')
  revalidatePath('/home')
  return { ok: true }
}

// 여러 메모 일괄 보관 (주간보고 리뷰에서 사용)
export async function bulkArchiveMemos(
  logIds: string[]
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (logIds.length === 0) return { ok: true, count: 0 }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ memo_status: 'actioned', memo_reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', logIds)
    .eq('user_id', user.id)
    .eq('entry_type', 'note')

  if (error) return { ok: false, error: (error as Error).message }
  revalidatePath('/daily')
  revalidatePath('/home')
  return { ok: true, count: logIds.length }
}

// ─── 메모 → 업무 승격(promote) ───────────────────────────────
// note → planned/doing 전환 + 원본 메모를 actioned로 + derived_from 엣지

export async function promoteMemoToTask(
  memoId: string,
  newType: 'planned' | 'doing',
  targetDate: string | null
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  // 1. 원본 메모 조회 (본인 + note 확인)
  const { data: memo } = await (supabase.from('daily_logs') as any)
    .select('id, content, log_date, entry_type')
    .eq('id', memoId)
    .eq('user_id', user.id)
    .eq('entry_type', 'note')
    .single()
  if (!memo) return { ok: false, error: '메모를 찾을 수 없습니다.' }

  // 2. 새 업무 생성 (메모에서 파생)
  const { data: task, error: insErr } = await (supabase.from('daily_logs') as any)
    .insert({
      user_id: user.id,
      log_date: memo.log_date,
      content: memo.content,
      entry_type: newType,
      target_date: targetDate || null,
      target_date_set_by: targetDate ? 'user' : null,
      source_type: 'thread_derived',
      parent_log_id: memoId,
    })
    .select('id')
    .single()
  if (insErr || !task) {
    await logActivity(supabase, {
      module: 'daily', action: 'promote', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: memoId,
      title: memo.content, error: insErr ?? '업무 생성 실패',
    })
    return { ok: false, error: insErr ? (insErr as Error).message : '업무 생성 실패' }
  }

  // 3. derived_from 엣지 (task → memo)
  await (supabase.from('daily_log_relations') as any).upsert(
    { from_log_id: task.id, to_log_id: memoId, relation_type: 'derived_from', created_by: 'user' },
    { onConflict: 'from_log_id,to_log_id,relation_type', ignoreDuplicates: true }
  )

  // 4. 원본 메모를 actioned로 정리
  await (supabase.from('daily_logs') as any)
    .update({ memo_status: 'actioned', memo_reviewed_at: new Date().toISOString() })
    .eq('id', memoId)
    .eq('user_id', user.id)

  await logActivity(supabase, {
    module: 'daily', action: 'promote', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: task.id as string,
    title: memo.content, before: { memoId }, after: { taskId: task.id, newType },
  })

  revalidateDailyCalendarViews()
  revalidatePath('/home')
  return { ok: true, taskId: task.id as string }
}

// ─── AI 분해 묶음(origin_group) 헤더 CRUD ────────────────────
// AI가 1개 입력을 N개 daily_log로 분해한 묶음. 묶음 키 = origin_group_id.
// 별도 parent 레코드 없이 headLogId(대표 로그)로 묶음을 식별한다.

// 묶음 전체(또는 origin_group_id 없으면 단건) 삭제. 본인 소유만(eq user_id).
export async function deleteLogGroup(
  headLogId: string
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { data: head } = await (supabase.from('daily_logs') as any)
    .select('id, origin_group_id')
    .eq('id', headLogId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!head) return { ok: false, error: '업무를 찾을 수 없습니다.' }

  const del = (supabase.from('daily_logs') as any).delete()
  const query = head.origin_group_id
    ? del.eq('origin_group_id', head.origin_group_id).eq('user_id', user.id)
    : del.eq('id', headLogId).eq('user_id', user.id)

  const { data, error } = await query.select('id')
  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'delete', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: headLogId, error,
      evidence: { group: true, originGroupId: head.origin_group_id ?? null },
    })
    return { ok: false, error: (error as Error).message }
  }

  const deletedCount = (data as { id: string }[] | null)?.length ?? 0
  await logActivity(supabase, {
    module: 'daily', action: 'delete', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: headLogId,
    after: { deletedCount }, evidence: { group: true, originGroupId: head.origin_group_id ?? null },
  })

  revalidateDailyCalendarViews()
  return { ok: true, deleted: deletedCount }
}

// 묶음 원본 입력 텍스트(original_input) 수정 — 표시용 텍스트만 갱신한다.
// 주의: AI 재분해/자식 content는 건드리지 않는다. 묶음 일관성 위해 묶음 전체 행을 갱신.
export async function updateOriginInput(
  headLogId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!text.trim()) return { ok: false, error: '내용을 입력하세요.' }
  if (text.length > 10000) return { ok: false, error: '입력이 너무 깁니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { data: head } = await (supabase.from('daily_logs') as any)
    .select('id, origin_group_id')
    .eq('id', headLogId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!head) return { ok: false, error: '업무를 찾을 수 없습니다.' }

  const upd = (supabase.from('daily_logs') as any)
    .update({ original_input: text.trim(), updated_at: new Date().toISOString() })
  const query = head.origin_group_id
    ? upd.eq('origin_group_id', head.origin_group_id).eq('user_id', user.id)
    : upd.eq('id', headLogId).eq('user_id', user.id)

  const { error } = await query
  if (error) {
    await logActivity(supabase, {
      module: 'daily', action: 'update', status: 'failure',
      actorId: user.id, ownerId: user.id, entityId: headLogId, error,
      title: text.trim(), evidence: { origin: true },
    })
    return { ok: false, error: (error as Error).message }
  }

  await logActivity(supabase, {
    module: 'daily', action: 'update', status: 'success',
    actorId: user.id, ownerId: user.id, entityId: headLogId,
    title: text.trim(), after: { original_input: text.trim() }, evidence: { origin: true },
  })

  revalidateDailyCalendarViews()
  return { ok: true }
}

/**
 * 일일 personal 로그 → 부서업무 승격 여부 역링크 맵.
 * dept_task(promoted_from_log_id IN logIds) 를 조회해 { [logId]: { deptTaskId, deptName } }.
 * 본인 소유 personal 로그만 대상(일일 화면=본인 로그). dept_task 가시성은 RLS가 1차 강제,
 * 부서명은 org-scope(SSOT)로 resolve. 연결 없는 로그는 맵에서 생략.
 */
export async function getPromotedMap(
  logIds: string[],
): Promise<Record<string, { deptTaskId: string; deptName: string }>> {
  if (!Array.isArray(logIds) || logIds.length === 0) return {}
  const ids = Array.from(new Set(logIds.filter((v) => typeof v === 'string' && v))).slice(0, 500)
  if (ids.length === 0) return {}

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}

  // 방어적 소유 검증: 입력 logIds 중 본인 소유 personal 로그만 대상으로 좁힘 (타인 로그 역링크 노출 차단)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: own } = await (supabase.from('daily_logs') as any)
    .select('id')
    .in('id', ids)
    .eq('user_id', user.id)
    .eq('task_kind', 'personal')
    .limit(500)
  const ownIds = ((own ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ownIds.length === 0) return {}

  // RLS 가시 dept_task 중 내 소유 personal 로그를 가리키는 것만
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('daily_logs') as any)
    .select('id, promoted_from_log_id, department_id')
    .eq('task_kind', 'dept_task')
    .in('promoted_from_log_id', ownIds)
    .limit(500)
  const rows = (data ?? []) as Array<{ id: string; promoted_from_log_id: string | null; department_id: string | null }>
  if (rows.length === 0) return {}

  // 부서명 resolve (org-scope SSOT 재사용)
  const admin = createAdminClient()
  const scope = await resolveOrgScope(admin, user.id)
  const deptNameMap: Record<string, string> = Object.fromEntries(
    scope.nodes.filter((n) => n.type === 'department').map((n) => [n.id, n.name]),
  )

  const map: Record<string, { deptTaskId: string; deptName: string }> = {}
  for (const r of rows) {
    if (!r.promoted_from_log_id) continue
    map[r.promoted_from_log_id] = {
      deptTaskId: r.id,
      deptName: (r.department_id && deptNameMap[r.department_id]) || '부서업무',
    }
  }
  return map
}
