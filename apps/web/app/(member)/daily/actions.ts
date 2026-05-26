'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { DailyLog, DailyLogEntryType } from '@/types/database'

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
