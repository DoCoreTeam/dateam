import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLogEntryType } from '@/types/database'

interface DayLogSummary {
  date: string
  total: number
  hasBlocker: boolean
  counts: Record<DailyLogEntryType, number>
  preview: { entry_type: DailyLogEntryType; content: string; target_date: string | null }[]
}

const MONTH_LIMIT = 2000

export async function GET(req: NextRequest) {
  const yearStr = req.nextUrl.searchParams.get('year')
  const monthStr = req.nextUrl.searchParams.get('month')
  const year = Number(yearStr)
  const month = Number(monthStr)

  if (!year || !month || year < 2020 || year > 2100 || month < 1 || month > 12) {
    return NextResponse.json({ error: 'year·month 파라미터 필요' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`

  const { data, error } = await (supabase.from('daily_logs') as any)
    .select('log_date, entry_type, content, target_date')
    .eq('user_id', user.id)
    .gte('log_date', from)
    .lte('log_date', to)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(MONTH_LIMIT)

  if (error) {
    console.error('[api/calendar/month]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === MONTH_LIMIT) console.warn('[api/calendar/month] limit reached')

  const map = new Map<string, DayLogSummary>()
  for (const row of (data ?? []) as { log_date: string; entry_type: DailyLogEntryType; content: string; target_date: string | null }[]) {
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
    if (s.preview.length < 2) s.preview.push({ entry_type: row.entry_type, content: row.content, target_date: row.target_date ?? null })
  }

  const result = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
