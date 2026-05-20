import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, TrendingUp, FileText } from 'lucide-react'
import type { Profile, KpiEntry, RoutineCheck, WeeklyReport } from '@/types/database'

const ROUTINES = ['Morning Standup', '리포트 확인', '이슈 로그', '업무 마감 체크']

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'name'> | null; error: unknown }

  const displayName = profile?.name ?? '팀원'

  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  // 이번 주 루틴 체크 현황
  const { data: routineChecks } = await supabase
    .from('routine_checks')
    .select('routine_name, check_date, is_completed')
    .eq('user_id', user.id)
    .eq('week_start', weekStartStr)
    .eq('is_completed', true) as unknown as { data: Pick<RoutineCheck, 'routine_name' | 'check_date' | 'is_completed'>[] | null; error: unknown }

  const completedCount = routineChecks?.length ?? 0
  const totalPossible = ROUTINES.length * 7
  const achievementRate = totalPossible > 0 ? Math.round((completedCount / totalPossible) * 100) : 0

  // 오늘 루틴 체크 현황
  const todayStr = toDateString(new Date())
  const todayChecks = routineChecks?.filter((c) => c.check_date === todayStr) ?? []
  const todayRate = Math.round((todayChecks.length / ROUTINES.length) * 100)

  // 내 KPI 최신값
  const { data: kpiEntries } = await supabase
    .from('kpi_entries')
    .select('metric_name, value, unit, period_end')
    .eq('user_id', user.id)
    .order('period_end', { ascending: false })
    .limit(4) as unknown as { data: Pick<KpiEntry, 'metric_name' | 'value' | 'unit' | 'period_end'>[] | null; error: unknown }

  // 최신 주간보고
  const { data: reports } = await supabase
    .from('weekly_reports')
    .select('week_start, category, created_at')
    .eq('user_id', user.id)
    .order('week_start', { ascending: false })
    .limit(3) as unknown as { data: Pick<WeeklyReport, 'week_start' | 'category' | 'created_at'>[] | null; error: unknown }

  return (
    <div style={{ maxWidth: '960px' }}>
      {/* 헤더 */}
      <div style={{ marginBottom: '2rem' }}>
        <h1
          style={{
            fontSize: '1.75rem',
            fontWeight: 700,
            color: '#0f172a',
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          안녕하세요, {displayName}님
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9375rem' }}>
          {new Date().toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          })}
        </p>
      </div>

      {/* 상단 요약 카드 3개 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        {/* 주간 루틴 달성률 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500, margin: 0 }}>
                이번 주 루틴
              </p>
              <p
                style={{
                  fontSize: '2.25rem',
                  fontWeight: 700,
                  color: achievementRate >= 70 ? '#059669' : achievementRate >= 40 ? '#d97706' : '#dc2626',
                  letterSpacing: '-0.04em',
                  margin: '0.25rem 0 0',
                  lineHeight: 1.1,
                }}
              >
                {achievementRate}%
              </p>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.375rem 0 0' }}>
                {completedCount} / {totalPossible} 완료
              </p>
            </div>
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: '0.75rem',
                backgroundColor: '#ecfdf5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={20} color="#059669" />
            </div>
          </div>
        </div>

        {/* 오늘 루틴 달성률 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500, margin: 0 }}>
                오늘 루틴
              </p>
              <p
                style={{
                  fontSize: '2.25rem',
                  fontWeight: 700,
                  color: '#6366f1',
                  letterSpacing: '-0.04em',
                  margin: '0.25rem 0 0',
                  lineHeight: 1.1,
                }}
              >
                {todayRate}%
              </p>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.375rem 0 0' }}>
                {todayChecks.length} / {ROUTINES.length} 항목
              </p>
            </div>
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: '0.75rem',
                backgroundColor: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CheckCircle2 size={20} color="#6366f1" />
            </div>
          </div>
        </div>

        {/* 주간보고 바로가기 */}
        <Link
          href="/weekly-report"
          style={{ textDecoration: 'none' }}
        >
          <div
            className="card"
            style={{
              padding: '1.5rem',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              border: 'none',
              cursor: 'pointer',
              transition: 'transform 120ms cubic-bezier(0.16,1,0.3,1), box-shadow 120ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '0.8125rem', color: 'rgb(255 255 255 / 0.75)', fontWeight: 500, margin: 0 }}>
                  주간보고 작성
                </p>
                <p
                  style={{
                    fontSize: '1.125rem',
                    fontWeight: 600,
                    color: 'white',
                    margin: '0.5rem 0 0',
                    letterSpacing: '-0.01em',
                  }}
                >
                  이번 주 기록하기
                </p>
                <p style={{ fontSize: '0.75rem', color: 'rgb(255 255 255 / 0.6)', margin: '0.375rem 0 0' }}>
                  최근 {reports?.length ?? 0}건 작성됨
                </p>
              </div>
              <ArrowRight size={20} color="rgb(255 255 255 / 0.7)" />
            </div>
          </div>
        </Link>
      </div>

      {/* 하단 섹션 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* KPI 최신값 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TrendingUp size={16} color="#6366f1" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                내 KPI
              </h2>
            </div>
            <Link href="/kpi" style={{ fontSize: '0.8125rem', color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
              전체 보기
            </Link>
          </div>

          {kpiEntries && kpiEntries.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {kpiEntries.map((kpi, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: '#f8fafc',
                    borderRadius: '0.625rem',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', color: '#475569' }}>{kpi.metric_name}</span>
                  <span style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                    {kpi.value.toLocaleString()}
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.25rem' }}>
                      {kpi.unit}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
              <TrendingUp size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
              <p style={{ margin: 0 }}>아직 KPI 데이터가 없습니다</p>
              <Link href="/kpi" style={{ color: '#6366f1', fontSize: '0.8125rem', textDecoration: 'none', marginTop: '0.5rem', display: 'inline-block' }}>
                + KPI 입력하기
              </Link>
            </div>
          )}
        </div>

        {/* 최근 주간보고 */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={16} color="#6366f1" />
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>
                최근 주간보고
              </h2>
            </div>
            <Link href="/weekly-report" style={{ fontSize: '0.8125rem', color: '#6366f1', textDecoration: 'none', fontWeight: 500 }}>
              작성하기
            </Link>
          </div>

          {reports && reports.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {reports.map((report, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: '#f8fafc',
                    borderRadius: '0.625rem',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '0.8125rem', color: '#475569' }}>
                      {new Date(report.week_start).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 주
                    </span>
                    <span className="badge badge-indigo" style={{ marginLeft: '0.5rem' }}>
                      {report.category}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {new Date(report.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
              <FileText size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
              <p style={{ margin: 0 }}>작성된 주간보고가 없습니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
