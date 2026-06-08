import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCalendarDayLogs, getMonthLogSummary } from '../daily/actions'
import { getWeekStart, toDateString } from '@/lib/utils'
import type { WeeklyReport } from '@/types/database'
import HomeMiniCalendar from './HomeMiniCalendar'
import HomeQuickEntry from './HomeQuickEntry'
import Link from 'next/link'
import { FileText, BarChart2, CheckSquare, Building2 } from 'lucide-react'
import FridaySpotlightOverlay from '@/components/ui/FridaySpotlightOverlay'
import UnreviewedMemoWidget from '@/components/ui/memo/UnreviewedMemoWidget'
import { isInDivisionByName } from '@/lib/org-scope'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const now = new Date()
  const todayStr = now.toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  const [profileResult, todayLogs, monthSummary, reportsResult] = await Promise.all([
    adminClient.from('profiles').select('name, role').eq('id', user.id).single(),
    getCalendarDayLogs(todayStr),
    getMonthLogSummary(year, month),
    supabase
      .from('weekly_reports')
      .select('week_start, category, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(3),
  ])

  const profile = profileResult.data as { name: string; role: string } | null
  const reports = reportsResult.data as Pick<WeeklyReport, 'week_start' | 'category' | 'created_at'>[] | null

  // KPI·루틴·본부운영 타일은 AX사업본부 소속(또는 관할/admin)에게만 노출
  const showAxTiles = await isInDivisionByName(adminClient, user.id, 'AX사업본부', profile?.role === 'admin')

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const isFriday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Fri'
  const hasThisWeekReport = (reports ?? []).some((r) => r.week_start === weekStartStr)
  const showGlow = isFriday && !hasThisWeekReport

  return (
    <div>
      <FridaySpotlightOverlay showGlow={showGlow} />

      {/*
        레이아웃 전략 (flex column):
        - 헤더 / 위젯 3종 횡배치(데스크탑 grid 3col) / 캘린더 전체폭
        - 모바일(<768px): 동일 DOM 순서로 세로 스택 — 헤더→오늘업무→메모→주간보고→캘린더
      */}
      <div className="home-layout">

        {/* 헤더 */}
        <div className="home-section-header">
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', margin: 0 }}>
            안녕하세요, {displayName}님
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>
              {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </span>
            {showAxTiles && [
              { href: '/kpi', label: 'KPI', icon: <BarChart2 size={12} />, color: 'var(--brand)', bg: 'var(--brand-soft)' },
              { href: '/routine', label: '루틴', icon: <CheckSquare size={12} />, color: 'var(--info)', bg: 'var(--info-bg)' },
              { href: '/operations', label: '본부 운영', icon: <Building2 size={12} />, color: 'var(--success)', bg: 'var(--success-bg)' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '0.375rem',
                  background: item.bg,
                  color: item.color,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  border: `1px solid ${item.color}33`,
                  lineHeight: 1.4,
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        {/* 위젯 3종 횡배치 — 오늘업무 · 확인안한메모 · 주간보고 (모바일: 세로 스택 순서 유지) */}
        <div className="home-section-widgets">
          {/* 오늘 업무 */}
          <div className="home-widget-col home-widget-quick">
            <HomeQuickEntry todayStr={todayStr} initialLogs={todayLogs} />
          </div>

          {/* 확인 안 한 메모 */}
          <div className="home-widget-col home-widget-memo">
            <UnreviewedMemoWidget variant="compact" />
          </div>

          {/* 주간보고 */}
          <div className="home-widget-col home-widget-weekly card" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={15} color="var(--brand)" />
                <h3 className="tape-title" style={{ margin: 0 }}>주간보고</h3>
              </div>
              <Link href="/weekly-report" style={{ fontSize: '0.75rem', color: 'var(--brand)', textDecoration: 'none', fontWeight: 600 }}>
                {showGlow ? '이번 주 작성하기 →' : '작성하기 →'}
              </Link>
            </div>
            {reports && reports.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {reports.map((r, i) => (
                <li key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.4rem 0.625rem', background: 'var(--color-bg)',
                  borderRadius: 'var(--radius)', border: '1px solid var(--surface-muted)',
                }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {new Date(r.week_start).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 주
                  </span>
                  <span className="badge badge-indigo">{r.category}</span>
                </li>
              ))}
            </ul>
            ) : (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', margin: 0, textAlign: 'center' }}>
                아직 주간보고가 없습니다.{' '}
                <Link href="/weekly-report" style={{ color: 'var(--brand)', fontWeight: 600 }}>작성하기</Link>
              </p>
            )}
          </div>
        </div>

        {/* 미니 캘린더 — 위젯 아래 전체폭 */}
        <div className="home-section-calendar">
          <HomeMiniCalendar
            year={year}
            month={month}
            todayStr={todayStr}
            monthSummary={monthSummary}
          />
        </div>

      </div>
    </div>
  )
}
