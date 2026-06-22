import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { groupLogsByEntity, engagementDistribution } from '@/lib/work/group-logs'
import { weeklyTrend, statusRollup } from '@/lib/work/dashboard-core'
import type { DailyLogEntryType } from '@/types/database'
import { EXCLUDE_RAW_HEAD_OR } from '@/lib/daily/raw-head'

// GET /api/work/dashboard — 워크로드 대시보드: 관여분포(고객 Top5)·활동추세(주별 8주)·상태 롤업. 건수/비중 기반.
export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const { data } = await db.from('daily_logs')
    .select('id, content, entry_type, log_date, linked_account_id')
    .eq('user_id', auth.user.id).eq('task_kind', 'personal')
    .eq('is_onboarding', false)  // onboarding: 워크로드 대시보드 집계 — 실습 행 제외
    .or(EXCLUDE_RAW_HEAD_OR)     // 원문 raw 헤드(헤더 전용) 제외 — total·롤업 오염 방지
    .order('log_date', { ascending: false }).limit(2000)
  const rows = (data ?? []) as Array<{ id: string; content: string; entry_type: DailyLogEntryType; log_date: string; linked_account_id: string | null }>

  // 관여 분포(고객)
  const { groups } = groupLogsByEntity(rows.map((r) => ({ id: r.id, content: r.content, entry_type: r.entry_type, entityId: r.linked_account_id ?? null })))
  const distRaw = engagementDistribution(groups, 5)
  const ids = distRaw.filter((d) => d.id !== '__etc__').map((d) => d.id)
  const nameMap = new Map<string, string>()
  if (ids.length > 0) {
    const { data: accs } = await db.from('accounts').select('id, name').in('id', ids)
    for (const a of (accs ?? []) as Array<{ id: string; name: string }>) nameMap.set(a.id, a.name)
  }
  const distribution = distRaw.map((d) => ({ id: d.id, name: d.id === '__etc__' ? '기타' : (nameMap.get(d.id) ?? '(삭제됨)'), count: d.count }))

  // 활동 추세(주별) + 상태 롤업
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })  // KST 기준 오늘(주차 경계 정합)
  const trend = weeklyTrend(rows.map((r) => r.log_date).filter(Boolean), today, 8)
  const rollup = statusRollup(rows.map((r) => r.entry_type))

  return NextResponse.json({ total: rows.length, distribution, trend, rollup })
}
