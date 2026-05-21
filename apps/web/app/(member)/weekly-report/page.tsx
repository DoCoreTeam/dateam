import type React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import WeeklyReportForm from './WeeklyReportForm'
import TeamReportView from './TeamReportView'
import ReportAccordion from './ReportAccordion'
import OnboardingRestartLink from './OnboardingRestartLink'
import { FileText, Users } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'

interface TeamRow {
  user_id: string
  category: string
  performance: string
  plan: string
  issues: string
  week_start: string
  profiles: { name: string; role: string } | null
}

interface PageProps {
  searchParams: Promise<{ tab?: string; editWeek?: string; saved?: string; reset?: string }>
}

export default async function WeeklyReportPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { tab, editWeek, saved, reset } = await searchParams
  const activeTab = tab === 'team' ? 'team' : 'mine'
  const justSaved = saved === '1'
  const justReset = reset === '1'

  let orgName = ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: metaRow } = await (createAdminClient() as any).from('org_content').select('value').eq('key', 'META').single()
    const meta = (metaRow?.value as Record<string, unknown>) ?? {}
    orgName = typeof meta.org === 'string' ? meta.org : typeof meta.title === 'string' ? meta.title : ''
  } catch (err) {
    console.warn('[weekly-report] org_content lookup failed; orgName will be empty', err)
  }

  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const d = getWeekStart(subWeeks(new Date(), i))
    return toDateString(d)
  })
  const thisWeek = weekOptions[0]

  // 내 보고 히스토리
  const { data: reports } = await supabase
    .from('weekly_reports')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('week_start', { ascending: false })
    .order('category', { ascending: true }) as unknown as { data: WeeklyReport[] | null; error: unknown }

  // 수정 모드: editWeek가 유효한 주차면 그 주 데이터로 프리필
  const initialWeek = (editWeek && weekOptions.includes(editWeek)) ? editWeek : thisWeek
  const formSourceData = (reports ?? []).filter((r) => r.week_start === initialWeek)
  const prefillRows = formSourceData.map((r) => ({
    category: r.category,
    performance: r.performance,
    plan: r.plan,
    issues: r.issues,
  }))

  // 전주 구분 목록 (AI 정비에서 신규 카테고리 판별용)
  const prevWeek = weekOptions[1] ?? null
  const prevWeekCategories = prevWeek
    ? Array.from(new Set((reports ?? []).filter((r) => r.week_start === prevWeek).map((r) => r.category))).filter(Boolean)
    : []

  // carry-forward: 이번 주 보고가 없고 이번 주 폼이면, 전주 계획 → 성과로 이월
  const isNonEmptyPlan = (plan: string) =>
    !!plan && plan !== '<p></p>' && plan !== '<p><br></p>' && plan.trim() !== ''
  const carryForwardRows =
    prevWeek && initialWeek === thisWeek && prefillRows.length === 0
      ? (reports ?? [])
          .filter((r) => r.week_start === prevWeek && isNonEmptyPlan(r.plan))
          .map((r) => ({
            category: r.category,
            performance: r.plan,
            plan: '',
            issues: '',
          }))
      : []
  const hasCarryForward = carryForwardRows.length > 0

  // 과거 구분 목록 (datalist용)
  const pastCategories = Array.from(new Set((reports ?? []).map((r) => r.category))).filter(Boolean)

  // 주차별 그룹화 (내 보고 히스토리)
  const grouped = (reports ?? []).reduce<Record<string, WeeklyReport[]>>((acc, r) => {
    if (!acc[r.week_start]) acc[r.week_start] = []
    acc[r.week_start].push(r)
    return acc
  }, {})
  const groups = Object.entries(grouped)
    .filter(([weekStart]) => weekStart !== thisWeek)
    .map(([weekStart, reps]) => ({ weekStart, reports: reps }))

  // 팀 전체 보고 (이번 주 초기값) — 002 migration 적용 후 member도 조회 가능
  const { data: teamRaw } = await supabase
    .from('weekly_reports')
    .select('user_id, category, performance, plan, issues, week_start, profiles(name, role)')
    .eq('week_start', thisWeek)
    .is('deleted_at', null)
    .order('category', { ascending: true }) as unknown as { data: TeamRow[] | null; error: unknown }

  const teamReports = (teamRaw ?? [])
    .map((r) => ({
      userId: r.user_id,
      userName: r.profiles?.name ?? '알 수 없음',
      role: r.profiles?.role ?? 'member',
      category: r.category,
      performance: r.performance,
      plan: r.plan,
      issues: r.issues,
      weekStart: r.week_start,
    }))
    .sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1))

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: isActive ? 600 : 500,
    color: isActive ? '#6366f1' : '#64748b',
    borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
    cursor: 'pointer',
    textDecoration: 'none',
  })

  return (
    <div style={{ width: '100%' }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          주간보고
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          주간 성과, 계획, 이슈를 기록합니다
        </p>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <Link href="/weekly-report?tab=mine" style={tabStyle(activeTab === 'mine')}>
          <FileText size={14} />
          내 보고
        </Link>
        <Link href="/weekly-report?tab=team" style={tabStyle(activeTab === 'team')}>
          <Users size={14} />
          팀 전체
        </Link>
      </div>

      {activeTab === 'mine' ? (
        <>
          {justSaved && (
            <div role="status" style={{ padding: '0.75rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#15803d' }}>
              주간보고가 저장되었습니다
            </div>
          )}
          {justReset && (
            <div role="status" style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.625rem', marginBottom: '1rem', fontSize: '0.8125rem', color: '#b91c1c' }}>
              보고서가 초기화되었습니다
            </div>
          )}
          <div className="card" style={{ padding: '1.5rem', marginBottom: '1.75rem', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={16} color="#6366f1" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>보고서 작성</h2>
              </div>
              <OnboardingRestartLink variant="icon" />
            </div>
            <WeeklyReportForm
              key={`${initialWeek}-${justReset ? 'reset' : 'normal'}`}
              weekOptions={weekOptions}
              thisWeek={thisWeek}
              initialWeek={initialWeek}
              pastCategories={pastCategories}
              prefillRows={prefillRows.length > 0 ? prefillRows : carryForwardRows}
              isFirstTimeUser={(reports ?? []).length === 0}
              hasCarryForward={hasCarryForward}
              hasSavedData={prefillRows.length > 0}
              prevWeekCategories={prevWeekCategories}
              orgName={orgName}
            />
          </div>

          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
              과거 주간보고
            </h2>
            <ReportAccordion groups={groups} />
          </div>

          <OnboardingRestartLink variant="text" />
        </>
      ) : (
        <div className="card" style={{ padding: '1.5rem', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Users size={16} color="#6366f1" />
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>팀 전체 주간보고</h2>
          </div>
          <TeamReportView weekOptions={weekOptions} thisWeek={thisWeek} initialReports={teamReports} />
        </div>
      )}
    </div>
  )
}
