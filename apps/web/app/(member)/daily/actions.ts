'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type {
  DailyLog, DailyLogEntryType, DailyLogPriority,
  DailyLogRelation, DailyLogRelationType,
  DailyLogThread, DailyLogTag,
} from '@/types/database'

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
  preview: { entry_type: DailyLogEntryType; content: string }[]
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
    .select('log_date, entry_type, content')
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
  for (const row of (data ?? []) as { log_date: string; entry_type: DailyLogEntryType; content: string }[]) {
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
      s.preview.push({ entry_type: row.entry_type, content: row.content })
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
    .eq('log_date', date)
    .order('logged_at', { ascending: true })
    .limit(DAY_LIMIT)

  if (data?.length === DAY_LIMIT) {
    console.warn('[daily] getDailyLogs limit reached — possible truncation')
  }

  return (data ?? []) as DailyLog[]
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

  const { data, error } = await (supabase.from('daily_logs') as any)
    .insert({
      user_id: user.id,
      log_date: logDate,
      content: content.trim(),
      entry_type: entryType,
    })
    .select()
    .single()

  if (error) return { ok: false, error: (error as Error).message }

  revalidatePath('/daily')
  return { ok: true, data: data as DailyLog }
}

export async function updateDailyLog(
  id: string,
  content: string,
  entryType: DailyLogEntryType
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!content.trim()) return { ok: false, error: '내용을 입력해 주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .update({ content: content.trim(), entry_type: entryType, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidatePath('/daily')
  return { ok: true }
}

export async function deleteDailyLog(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: '로그인이 필요합니다.' }

  const { error } = await (supabase.from('daily_logs') as any)
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: (error as Error).message }

  revalidatePath('/daily')
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

  revalidatePath('/daily')
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

  revalidatePath('/daily')
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

  revalidatePath('/daily')
  return { ok: true }
}

export async function addMultipleDailyLogs(
  items: AiParsedItem[],
  logDate: string
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
      entry_type: item.status,
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
      source_type: 'ai_split' as const,
    }
  })

  // 취약점 5 방어: 단일 트랜잭션으로 전체 저장
  const { data, error } = await (supabase.from('daily_logs') as any)
    .insert(rows)
    .select()

  if (error) return { ok: false, error: (error as Error).message }

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

  revalidatePath('/daily')
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

  revalidatePath('/daily')
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

  revalidatePath('/daily')
  return { ok: true }
}
