'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

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

  const { data } = await (supabase.from('daily_logs') as any)
    .select('log_date, entry_type, content')
    .eq('user_id', user.id)
    .gte('log_date', from)
    .lte('log_date', to)
    .order('logged_at', { ascending: true })

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

  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .gte('log_date', weekStart)
    .lte('log_date', to)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })

  return (data ?? []) as DailyLog[]
}

export async function getDailyLogs(date: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('log_date', date)
    .order('logged_at', { ascending: true })

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

// 이월된 미완료 항목 조회 (오늘 기준 최근 7일, planned/doing/blocker 중 is_resolved=false)
export async function getCarryoverLogs(today: string): Promise<DailyLog[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const sevenDaysAgo = new Date(today + 'T00:00:00')
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const from = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')}`

  const { data } = await (supabase.from('daily_logs') as any)
    .select('*')
    .eq('user_id', user.id)
    .eq('is_resolved', false)
    .in('entry_type', ['planned', 'doing', 'blocker'])
    .gte('log_date', from)
    .lt('log_date', today)
    .order('log_date', { ascending: false })
    .order('logged_at', { ascending: true })

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
