import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DailyLogEntryType } from '@/types/database'
import { EXCLUDE_RAW_HEAD_OR } from '@/lib/daily/raw-head'

interface DayLogSummary {
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
    .select('id, log_date, entry_type, content, target_date, target_end_date, scheduled_at, logged_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .eq('is_onboarding', false)   // 온보딩 실습 행 제외(캘린더 오염 방지)
    .or(EXCLUDE_RAW_HEAD_OR)      // 원문 raw 헤드(헤더 전용) 제외 — 캘린더 카운트 오염 방지
    // log_date/target_date가 이 달이거나, 기간 밴드[target_date, target_end_date]가 이 달과 겹치는 행
    .or(`and(log_date.gte.${from},log_date.lte.${to}),and(target_date.gte.${from},target_date.lte.${to}),and(target_date.lte.${to},target_end_date.gte.${from})`)
    .order('log_date', { ascending: true })
    .order('logged_at', { ascending: true })
    .limit(MONTH_LIMIT)

  if (error) {
    console.error('[api/calendar/month]', error)
    return NextResponse.json({ error: '데이터 조회 실패' }, { status: 500 })
  }
  if (data?.length === MONTH_LIMIT) console.warn('[api/calendar/month] limit reached')

  type RowType = {
    id: string
    log_date: string
    entry_type: DailyLogEntryType
    content: string
    target_date: string | null
    target_end_date: string | null
    scheduled_at: string | null
    logged_at: string | null
  }

  // 'YYYY-MM-DD' start~end(포함) 일자 배열. UTC 기준 순수 문자열 산술(월 클램프로 최대 31일).
  const eachDay = (startStr: string, endStr: string): string[] => {
    const out: string[] = []
    const d = new Date(startStr + 'T00:00:00Z')
    const end = new Date(endStr + 'T00:00:00Z')
    let guard = 0
    while (d <= end && guard < 40) {
      // UTC 앵커 자정 날짜의 date-key(YYYY-MM-DD)를 UTC 파트로 직접 조립.
      // (벽시계·"오늘" 산출이 아니라 순수 일자키 전개 — toISOString().slice 우회 패턴 회피)
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')
      out.push(`${d.getUTCFullYear()}-${m}-${day}`)
      d.setUTCDate(d.getUTCDate() + 1)
      guard++
    }
    return out
  }

  const map = new Map<string, DayLogSummary>()

  const addToDay = (date: string, row: RowType) => {
    if (!map.has(date)) {
      map.set(date, {
        date,
        total: 0,
        hasBlocker: false,
        counts: { done: 0, doing: 0, planned: 0, blocker: 0, note: 0 },
        preview: [],
      })
    }
    const s = map.get(date)!
    s.total++
    s.counts[row.entry_type]++
    if (row.entry_type === 'blocker') s.hasBlocker = true
    if (s.preview.length < 2) s.preview.push({
      id: row.id,
      entry_type: row.entry_type,
      content: row.content,
      target_date: row.target_date ?? null,
      scheduled_at: row.scheduled_at ?? null,
      logged_at: row.logged_at ?? null,
    })
  }

  for (const row of (data ?? []) as RowType[]) {
    if (row.log_date >= from && row.log_date <= to) {
      addToDay(row.log_date, row)
    }
    // 기간 밴드: [target_date, target_end_date]의 모든 날에 표시(다음주 전체 등). 단일이면 target_date 하루만.
    if (row.target_date) {
      const rangeEnd = row.target_end_date && row.target_end_date >= row.target_date ? row.target_end_date : row.target_date
      const clampStart = row.target_date < from ? from : row.target_date
      const clampEnd = rangeEnd > to ? to : rangeEnd
      if (clampStart <= clampEnd) {
        for (const day of eachDay(clampStart, clampEnd)) {
          if (day === row.log_date) continue // log_date로 이미 추가됨(중복 방지)
          addToDay(day, row)
        }
      }
    }
  }

  const result = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
