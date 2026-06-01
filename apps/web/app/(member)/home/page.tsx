import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCalendarDayLogs, getMonthLogSummary } from '../daily/actions'
import { getWeekStart, toDateString } from '@/lib/utils'
import type { OrgContent, WeeklyReport } from '@/types/database'
import HomeMiniCalendar from './HomeMiniCalendar'
import HomeQuickEntry from './HomeQuickEntry'
import Link from 'next/link'
import { FileText, Target, BarChart2, CheckSquare, Building2 } from 'lucide-react'
import FridaySpotlightOverlay from '@/components/ui/FridaySpotlightOverlay'
import UnreviewedMemoWidget from '@/components/ui/memo/UnreviewedMemoWidget'

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

  type OrgRow = Pick<OrgContent, 'key' | 'value'>
  const orgQuery = adminClient
    .from('org_content')
    .select('key, value')
    .in('key', ['missions', 'okr']) as unknown as Promise<{ data: OrgRow[] | null; error: unknown }>

  const [profileResult, todayLogs, monthSummary, reportsResult, orgResult] = await Promise.all([
    adminClient.from('profiles').select('name').eq('id', user.id).single(),
    getCalendarDayLogs(todayStr),
    getMonthLogSummary(year, month),
    supabase
      .from('weekly_reports')
      .select('week_start, category, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(3),
    orgQuery,
  ])

  const profile = profileResult.data as { name: string } | null
  const reports = reportsResult.data as Pick<WeeklyReport, 'week_start' | 'category' | 'created_at'>[] | null

  const orgRows = (orgResult as { data: OrgRow[] | null }).data ?? []
  const orgMap = Object.fromEntries(orgRows.map((r) => [r.key, r.value]))
  const missions = orgMap['missions'] as Array<{ num: string; title: string; desc: string }> | null | undefined
  const okrList = orgMap['okr'] as Array<{ objective: string; lead: string; key_results: string[] }> | null | undefined

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const isFriday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Fri'
  const hasThisWeekReport = (reports ?? []).some((r) => r.week_start === weekStartStr)
  const showGlow = isFriday && !hasThisWeekReport

  const hasMissionOkr = (missions && missions.length > 0) || (okrList && okrList.length > 0)

  return (
    <div>
      <FridaySpotlightOverlay showGlow={showGlow} />

      {/*
        레이아웃 전략:
        - 데스크탑/태블릿(≥768px): CSS Grid 2열 (캘린더 좌, 나머지 우)
        - 모바일(<768px): Flex column + order (헤더→오늘업무→미션OKR→주간보고→캘린더)
        HomeQuickEntry는 단일 마운트 — 이중 마운트 없음
      */}
      <div className="home-layout">

        {/* 헤더 */}
        <div className="home-section-header">
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
            안녕하세요, {displayName}님
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#64748b', fontSize: '0.9375rem' }}>
              {now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </span>
            {[
              { href: '/kpi', label: 'KPI', icon: <BarChart2 size={12} />, color: '#6366f1', bg: '#eef2ff' },
              { href: '/routine', label: '루틴', icon: <CheckSquare size={12} />, color: '#0891b2', bg: '#ecfeff' },
              { href: '/operations', label: '본부 운영', icon: <Building2 size={12} />, color: '#059669', bg: '#ecfdf5' },
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

        {/* 오늘 업무 — 모바일 2번째, 데스크탑 우측 상단 */}
        <div className="home-section-quick" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <HomeQuickEntry todayStr={todayStr} initialLogs={todayLogs} />
          <UnreviewedMemoWidget variant="compact" />
        </div>

        {/* 미션 & OKR — 모바일 3번째, 데스크탑 전체폭(헤더 아래) */}
        {hasMissionOkr && (
          <div className="home-section-mission card" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.875rem' }}>
              <Target size={15} color="#6366f1" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>미션 & OKR</h2>
            </div>
            <div className="responsive-grid-cols-2" style={{ gap: '1rem' }}>
              {missions && missions.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.5rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    본부 미션
                  </p>
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {missions.slice(0, 3).map((m, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.6875rem', fontWeight: 700, color: '#6366f1',
                          background: '#eef2ff', borderRadius: '0.3rem', padding: '0.1rem 0.35rem', flexShrink: 0,
                        }}>
                          {m.num}
                        </span>
                        <span style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.4 }}>{m.title}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {okrList && okrList.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#94a3b8', margin: '0 0 0.5rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    이번 분기 목표
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {okrList.slice(0, 3).map((okr, i) => (
                      <div key={i} style={{ display: 'flex', gap: '0.375rem', alignItems: 'flex-start' }}>
                        <span style={{ color: '#6366f1', flexShrink: 0, fontSize: '0.75rem', marginTop: '0.125rem' }}>·</span>
                        <span style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.4 }}>{okr.objective}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 미니 캘린더 — 모바일 5번째, 데스크탑 좌측(row 3~4 span) */}
        <div className="home-section-calendar">
          <HomeMiniCalendar
            year={year}
            month={month}
            todayStr={todayStr}
            monthSummary={monthSummary}
          />
        </div>

        {/* 주간보고 — 모바일 4번째, 데스크탑 우측 하단 */}
        <div className="home-section-weekly card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={15} color="#6366f1" />
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>주간보고</h3>
            </div>
            <Link href="/weekly-report" style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
              {showGlow ? '이번 주 작성하기 →' : '작성하기 →'}
            </Link>
          </div>
          {reports && reports.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {reports.map((r, i) => (
                <li key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.4rem 0.625rem', background: '#f8fafc',
                  borderRadius: '0.5rem', border: '1px solid #f1f5f9',
                }}>
                  <span style={{ fontSize: '0.8125rem', color: '#475569' }}>
                    {new Date(r.week_start).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 주
                  </span>
                  <span className="badge badge-indigo">{r.category}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0, textAlign: 'center' }}>
              아직 주간보고가 없습니다.{' '}
              <Link href="/weekly-report" style={{ color: '#6366f1', fontWeight: 600 }}>작성하기</Link>
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
