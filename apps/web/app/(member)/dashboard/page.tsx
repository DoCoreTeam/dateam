import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import Link from 'next/link'
import { ArrowRight, CheckCircle2, TrendingUp, FileText } from 'lucide-react'
import type { Profile, KpiEntry, RoutineCheck, WeeklyReport, OrgContent, Json } from '@/types/database'
import WeeklyReportBannerButton from '@/components/ui/WeeklyReportBannerButton'
import FridaySpotlightOverlay from '@/components/ui/FridaySpotlightOverlay'

const ROUTINES = ['Morning Standup', '리포트 확인', '이슈 로그', '업무 마감 체크']

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  type OrgRow = Pick<OrgContent, 'key' | 'value'>
  const orgQuery = adminClient
    .from('org_content')
    .select('key, value')
    .in('key', ['META', 'missions', 'okr']) as unknown as Promise<{ data: OrgRow[] | null; error: unknown }>

  const [profileResult, routineResult, kpiResult, reportsResult, orgResult] = await Promise.all([
    adminClient.from('profiles').select('name').eq('id', user.id).single(),
    supabase
      .from('routine_checks')
      .select('routine_name, check_date, is_completed')
      .eq('user_id', user.id)
      .eq('week_start', weekStartStr)
      .eq('is_completed', true),
    supabase
      .from('kpi_entries')
      .select('metric_name, value, unit, period_end')
      .eq('user_id', user.id)
      .order('period_end', { ascending: false })
      .limit(4),
    supabase
      .from('weekly_reports')
      .select('week_start, category, created_at')
      .eq('user_id', user.id)
      .order('week_start', { ascending: false })
      .limit(3),
    orgQuery,
  ])

  const profile = profileResult.data as Pick<Profile, 'name'> | null
  const routineChecks = routineResult.data as Pick<RoutineCheck, 'routine_name' | 'check_date' | 'is_completed'>[] | null
  const kpiEntries = kpiResult.data as Pick<KpiEntry, 'metric_name' | 'value' | 'unit' | 'period_end'>[] | null
  const reports = reportsResult.data as Pick<WeeklyReport, 'week_start' | 'category' | 'created_at'>[] | null

  const orgRows = (orgResult as { data: OrgRow[] | null }).data ?? []
  const orgMap = Object.fromEntries(orgRows.map((r) => [r.key, r.value]))
  const meta = orgMap['META'] as {
    org: string; title: string; subtitle: string; version: string; date: string;
    stats: Array<{ num: string; lbl: string }>
  } | null | undefined
  const missions = orgMap['missions'] as Array<{ num: string; title: string; desc: string }> | null | undefined
  const okrList = orgMap['okr'] as Array<{ objective: string; lead: string; key_results: string[] }> | null | undefined

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'

  const completedCount = routineChecks?.length ?? 0
  const totalPossible = ROUTINES.length * 7
  const achievementRate = totalPossible > 0 ? Math.round((completedCount / totalPossible) * 100) : 0

  const isFriday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date()) === 'Fri'
  const hasThisWeekReport = (reports ?? []).some((r) => r.week_start === weekStartStr)
  const showGlow = isFriday && !hasThisWeekReport

  const todayStr = toDateString(new Date())
  const todayChecks = routineChecks?.filter((c) => c.check_date === todayStr) ?? []
  const todayRate = Math.round((todayChecks.length / ROUTINES.length) * 100)

  const routineColor = achievementRate >= 70 ? '#059669' : achievementRate >= 40 ? '#d97706' : '#dc2626'

  return (
    <div>
      <FridaySpotlightOverlay showGlow={showGlow} />
      {/* 헤더 */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          안녕하세요, {displayName}님
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9375rem' }}>
          {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
        </p>
      </div>

      {/* 2-column 메인 레이아웃 */}
      <div className="responsive-grid-2">

        {/* ── 좌 컬럼: 조직 정보 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>

          {/* 본부 현황 배너 */}
          {meta && (
            <div style={{
              borderRadius: '1.25rem',
              background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #7c3aed 100%)',
              padding: '2rem',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1.25rem',
              flexWrap: 'wrap',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div aria-hidden="true" style={{
                position: 'absolute', inset: 0,
                backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.08) 0%, transparent 50%)',
                pointerEvents: 'none',
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 500, color: 'rgba(255,255,255,0.6)', margin: '0 0 0.375rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {meta.org}
                </p>
                <h2 style={{ fontSize: 'clamp(1.25rem, 2vw, 1.75rem)', fontWeight: 700, color: '#ffffff', margin: '0 0 0.375rem', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                  {meta.title}
                </h2>
                <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.65)', margin: '0 0 1.25rem' }}>
                  {meta.subtitle}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-block', fontSize: '0.6875rem', fontWeight: 600,
                    color: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)', borderRadius: '999px',
                    padding: '0.2rem 0.625rem', letterSpacing: '0.04em',
                  }}>
                    {meta.version} · {meta.date}
                  </span>
                  <WeeklyReportBannerButton showGlow={showGlow} />
                </div>
              </div>

              {meta.stats && meta.stats.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem', flexShrink: 0 }}>
                  {meta.stats.slice(0, 4).map((stat, i) => (
                    <div key={stat.lbl ?? i} style={{
                      backgroundColor: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255,255,255,0.18)', borderRadius: '0.875rem',
                      padding: '0.875rem 1rem', textAlign: 'center', minWidth: '5.5rem',
                    }}>
                      <p style={{ fontSize: '1.375rem', fontWeight: 700, color: '#ffffff', margin: 0, letterSpacing: '-0.03em', lineHeight: 1.1 }}>{stat.num}</p>
                      <p style={{ fontSize: '0.6875rem', color: 'rgba(255,255,255,0.65)', margin: '0.25rem 0 0', fontWeight: 500 }}>{stat.lbl}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OKR 섹션 */}
          {okrList && okrList.length > 0 && (
            <section aria-labelledby="okr-heading">
              <h2 id="okr-heading" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.875rem', letterSpacing: '-0.02em' }}>
                이번 분기 OKR
              </h2>
              <div className="responsive-grid-cols-2">
                {okrList.slice(0, 4).map((okr, i) => (
                  <div key={okr.objective ?? i} className="card" style={{ padding: '1.25rem' }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', margin: '0 0 0.625rem', lineHeight: 1.4 }}>
                      {okr.objective}
                    </p>
                    {okr.key_results && okr.key_results.length > 0 && (
                      <ul style={{ listStyle: 'none', margin: '0 0 0.75rem', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                        {okr.key_results.map((kr, j) => (
                          <li key={j} style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'flex-start', gap: '0.375rem', lineHeight: 1.45 }}>
                            <span aria-hidden="true" style={{ color: '#6366f1', flexShrink: 0, marginTop: '0.1em' }}>·</span>
                            {kr}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p style={{ fontSize: '0.6875rem', color: '#94a3b8', margin: 0, fontWeight: 500 }}>Lead · {okr.lead}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* ── 우 컬럼: 개인 현황 ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* 루틴 현황 카드 */}
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.125rem' }}>
              <CheckCircle2 size={15} color="#059669" />
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>내 루틴 현황</h3>
            </div>

            {/* 이번 주 루틴 */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>이번 주</span>
                <span style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', color: routineColor }}>
                  {achievementRate}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={achievementRate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`이번 주 루틴 달성률 ${achievementRate}%`}
                style={{ height: '4px', backgroundColor: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', width: `${achievementRate}%`, borderRadius: '999px', backgroundColor: routineColor }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.3rem 0 0' }}>
                {completedCount} / {totalPossible} 완료
              </p>
            </div>

            <div style={{ height: '1px', backgroundColor: '#f1f5f9', margin: '0 0 1rem' }} />

            {/* 오늘 루틴 */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.8125rem', color: '#64748b', fontWeight: 500 }}>오늘</span>
                <span style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', color: '#6366f1' }}>
                  {todayRate}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={todayRate}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`오늘 루틴 달성률 ${todayRate}%`}
                style={{ height: '4px', backgroundColor: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', width: `${todayRate}%`, borderRadius: '999px', backgroundColor: '#6366f1' }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.3rem 0 0' }}>
                {todayChecks.length} / {ROUTINES.length} 항목
              </p>
            </div>

            <Link href="/routine" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: '0.625rem', fontSize: '0.8125rem', fontWeight: 500,
              color: '#475569', textDecoration: 'none',
            }}>
              루틴 체크하기 <ArrowRight size={12} />
            </Link>
          </div>

          {/* 주간보고 카드 */}
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={15} color="#6366f1" />
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>주간보고</h3>
              </div>
              <Link href="/weekly-report" style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
                작성하기 →
              </Link>
            </div>

            {reports && reports.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {reports.map((report, i) => (
                  <li key={`${report.week_start}-${report.category}-${i}`} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #f1f5f9',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8125rem', color: '#475569' }}>
                        {new Date(report.week_start).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })} 주
                      </span>
                      <span className="badge badge-indigo">{report.category}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {new Date(report.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.25rem 1rem', color: '#94a3b8', fontSize: '0.8125rem' }}>
                <p style={{ margin: '0 0 0.5rem' }}>작성된 주간보고가 없습니다</p>
                <Link href="/weekly-report" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
                  이번 주 기록하기 →
                </Link>
              </div>
            )}
          </div>

          {/* KPI 카드 */}
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <TrendingUp size={15} color="#6366f1" />
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>내 KPI</h3>
              </div>
              <Link href="/kpi" style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
                전체 보기 →
              </Link>
            </div>

            {kpiEntries && kpiEntries.length > 0 ? (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {kpiEntries.map((kpi, i) => (
                  <li key={`${kpi.period_end}-${kpi.metric_name}-${i}`} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.5rem 0.75rem',
                    backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #f1f5f9',
                  }}>
                    <span style={{ fontSize: '0.8125rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                      {kpi.metric_name}
                    </span>
                    <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', flexShrink: 0 }}>
                      {kpi.value != null ? kpi.value.toLocaleString() : '—'}
                      {kpi.unit && <span style={{ fontSize: '0.6875rem', color: '#94a3b8', marginLeft: '0.2rem' }}>{kpi.unit}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div style={{ textAlign: 'center', padding: '1.25rem 1rem', color: '#94a3b8', fontSize: '0.8125rem' }}>
                <p style={{ margin: '0 0 0.5rem' }}>아직 KPI 데이터가 없습니다</p>
                <Link href="/kpi" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
                  + KPI 입력하기 →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 본부 미션 — 풀 width */}
      {missions && missions.length > 0 && (
        <section aria-labelledby="missions-heading" style={{ marginTop: '1.5rem' }}>
          <h2 id="missions-heading" style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.875rem', letterSpacing: '-0.02em' }}>
            본부 미션
          </h2>
          <div className="card" style={{ padding: '1.25rem 1.5rem' }}>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
              {missions.slice(0, 5).map((mission, i) => (
                <li key={mission.num ?? i} style={{
                  display: 'flex', alignItems: 'baseline', gap: '0.75rem',
                  padding: '0.625rem 0',
                  borderBottom: i < Math.min(missions.length, 5) - 1 ? '1px solid #f1f5f9' : 'none',
                }}>
                  <span style={{
                    fontSize: '0.6875rem', fontWeight: 700, color: '#6366f1',
                    backgroundColor: '#eef2ff', borderRadius: '0.375rem',
                    padding: '0.125rem 0.4rem', flexShrink: 0, letterSpacing: '0.02em',
                  }}>
                    {mission.num}
                  </span>
                  <span style={{ fontSize: '0.875rem', color: '#334155', fontWeight: 500, lineHeight: 1.4 }}>
                    {mission.title}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}
    </div>
  )
}
