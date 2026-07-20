import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import QueryToast from '@/components/ui/QueryToast'
import { getWeekStart, toDateString } from '@/lib/utils'
import { subWeeks } from 'date-fns'
import WeeklyReportForm from './WeeklyReportForm'
import WeeklyEditHistory, { type WeeklySnapshot } from './WeeklyEditHistory'
import AutoDraftPanel from './AutoDraftPanel'
import TeamReportView from './TeamReportView'
import ReportAccordion from './ReportAccordion'
import OnboardingRestartLink from '@/components/onboarding/OnboardingRestartLink'
import OrgWeeklyView from './OrgWeeklyView'
import DeptTaskWeeklyPanel from './DeptTaskWeeklyPanel'
import WorkPageShell from '@/components/ui/WorkPageShell'
import WorkSubTabs from '@/components/ui/WorkSubTabs'
import WeekPicker from './WeekPicker'
import { resolveSelectedWeek, clampToWindow, tabEffectiveWeek } from '@/lib/weekly-report/week-continuity'
import { FileText, Users, GitBranch } from 'lucide-react'
import type { WeeklyReport } from '@/types/database'
import { resolveOrgScope, deptMemberUserIds, hasOrgScope } from '@/lib/org-scope'
import { computeDeptTimeliness } from '@/lib/weekly-report/timeliness-server'
import type { MemberTimeliness } from '@/lib/weekly-report/timeliness'

interface AuthorBlock { name: string; rank?: string; performance: string; plan: string; issues: string }
interface MergedRow { category: string; authors: AuthorBlock[] }

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
  searchParams: Promise<{ tab?: string; editWeek?: string; saved?: string; reset?: string; orgWeek?: string; week?: string }>
}

export default async function WeeklyReportPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { tab, editWeek, reset, orgWeek, week } = await searchParams
  const justReset = reset === '1'

  // 조직 권한 스코프 (조직 현황 탭 노출/데이터)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminForScope = createAdminClient() as any
  const orgScope = await resolveOrgScope(adminForScope, user.id)
  const showOrgTab = hasOrgScope(orgScope)
  const activeTab = tab === 'team' ? 'team' : tab === 'org' && showOrgTab ? 'org' : 'mine'

  const weekOptions = Array.from({ length: 8 }, (_, i) => {
    const d = getWeekStart(subWeeks(new Date(), i))
    return toDateString(d)
  })
  const thisWeek = weekOptions[0]

  // 주차 연속성 SSOT(week-continuity.ts) — 단일 `?week=`(레거시 orgWeek/editWeek 하위호환).
  // org는 무제한 과거(유효 월요일) 허용, mine/team은 8주 윈도우로 클램프(폼/옵션 제약).
  const selectedWeek = resolveSelectedWeek(week ?? orgWeek ?? editWeek, weekOptions)
  const windowWeek = clampToWindow(selectedWeek, weekOptions)
  const withWeek = (base: string) => `${base}&week=${selectedWeek}`

  // 스코프 확정 후 서로 독립인 3개 쿼리(조직명·내보고·팀보고)를 병렬화 — 워터폴 단축(결과 동일).
  const [orgMetaRes, reportsRes, teamRawRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (createAdminClient() as any)
      .from('org_content').select('value').eq('key', 'META').single()
      .then((r: { data: { value?: Record<string, unknown> } | null }) => r)
      .catch((err: unknown) => {
        console.warn('[weekly-report] org_content lookup failed; orgName will be empty', err)
        return { data: null }
      }),
    supabase
      .from('weekly_reports')
      .select('*')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('week_start', { ascending: false })
      .order('category', { ascending: true })
      .order('seq', { ascending: true }) as unknown as Promise<{ data: WeeklyReport[] | null }>,
    supabase
      .from('weekly_reports')
      .select('user_id, category, performance, plan, issues, week_start, profiles(name, role)')
      .eq('week_start', windowWeek)
      .is('deleted_at', null)
      .order('category', { ascending: true }) as unknown as Promise<{ data: TeamRow[] | null }>,
  ])

  const meta = (orgMetaRes?.data?.value as Record<string, unknown>) ?? {}
  const orgName = typeof meta.org === 'string' ? meta.org : typeof meta.title === 'string' ? meta.title : ''
  const reports = reportsRes.data

  // 수정 모드: 선택 주차가 8주 윈도우 내면 그 주 데이터로 프리필(폼은 윈도우 제약).
  const initialWeek = windowWeek
  const formSourceData = (reports ?? []).filter((r) => r.week_start === initialWeek)
  const prefillRows = formSourceData.map((r) => ({
    category: r.category,
    performance: r.performance,
    plan: r.plan,
    issues: r.issues,
  }))

  // 편집 이력(유실0 스냅샷, 마이그144) — 이 주차 저장/삭제 직전 상태. RLS로 본인 것만.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: editSnapshots } = await (supabase.from('weekly_report_snapshots') as any)
    .select('id, week_start, row_count, reason, taken_at')
    .eq('user_id', user.id)
    .eq('week_start', initialWeek)
    .order('taken_at', { ascending: false })
    .limit(30)

  // 전주 구분 목록 (AI 정비에서 신규 카테고리 판별용)
  const prevWeek = weekOptions[1] ?? null
  const prevWeekCategories = prevWeek
    ? Array.from(new Set((reports ?? []).filter((r) => r.week_start === prevWeek).map((r) => r.category))).filter(Boolean)
    : []

  // carry-forward: 전주 계획 → 이번 주 "빈 성과"로 이월.
  // 왜: AI 자동초안 저장이 weekly_reports를 먼저 채워도(prefillRows>0) 이월이 죽지 않도록,
  //     "행 없음(prefill 비었음)"이 아니라 "성과 셀 비었음" 기준으로 채운다. 사용자가 작성한 성과는 절대 미덮어씀.
  const isNonEmptyRich = (s: string) =>
    !!s && s !== '<p></p>' && s !== '<p><br></p>' && s.trim() !== ''
  const prevPlanByCategory = new Map<string, string>()
  if (prevWeek && initialWeek === thisWeek) {
    for (const r of reports ?? []) {
      if (r.week_start === prevWeek && isNonEmptyRich(r.plan) && !prevPlanByCategory.has(r.category)) {
        prevPlanByCategory.set(r.category, r.plan)
      }
    }
  }
  let carriedCount = 0
  // 1) 기존 프리필 행의 빈 성과만 전주 계획으로 채움
  const mergedPrefill = prefillRows.map((row) => {
    const prevPlan = prevPlanByCategory.get(row.category)
    if (prevPlan && !isNonEmptyRich(row.performance)) {
      carriedCount++
      return { ...row, performance: prevPlan }
    }
    return row
  })
  // 2) 전주에만 있던 구분(계획 존재) → 이번 주 이월 행으로 추가
  const existingCats = new Set(prefillRows.map((r) => r.category))
  prevPlanByCategory.forEach((plan, cat) => {
    if (!existingCats.has(cat)) {
      mergedPrefill.push({ category: cat, performance: plan, plan: '', issues: '' })
      carriedCount++
    }
  })
  const hasCarryForward = carriedCount > 0

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
  // 위 Promise.all에서 병렬 조회됨(teamRawRes). 결과 동일.
  const teamRaw = teamRawRes.data

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

  // 조직 현황 탭 데이터 (부서 카드 통계 + 취합본)
  // orgWeek는 월요일 형식이면 무제한 과거/현재까지 허용 (화살표 네비) — 8주 윈도우에 묶이지 않음
  const orgWeekStart = selectedWeek
  let orgDeptStats: Record<string, { memberCount: number; reportedCount: number; agg: 'none' | 'draft' | 'confirmed' }> = {}
  let orgDeptBodies: Record<string, MergedRow[]> = {}
  let orgDeptTimeliness: Record<string, MemberTimeliness[]> = {}
  let isAdmin = false
  if (activeTab === 'org' && showOrgTab) {
    const readable = orgScope.readableDeptIds
    // 이번 주차 보고 제출자 집합
    const { data: weekReps } = await adminForScope
      .from('weekly_reports')
      .select('user_id')
      .eq('week_start', orgWeekStart)
      .is('deleted_at', null) as { data: { user_id: string }[] | null }
    const reporters = new Set((weekReps ?? []).map((r) => r.user_id))
    // 취합 스냅샷
    const { data: snaps } = await adminForScope
      .from('dept_weekly_reports')
      .select('department_id, body, status')
      .eq('week_start', orgWeekStart)
      .in('department_id', readable.length ? readable : ['00000000-0000-0000-0000-000000000000']) as {
        data: { department_id: string; body: MergedRow[]; status: 'draft' | 'confirmed' }[] | null
      }
    const snapMap = new Map((snaps ?? []).map((s) => [s.department_id, s]))
    for (const deptId of readable) {
      const members = deptMemberUserIds(orgScope, deptId)
      const snap = snapMap.get(deptId)
      orgDeptStats[deptId] = {
        memberCount: members.length,
        reportedCount: members.filter((m) => reporters.has(m)).length,
        agg: snap ? snap.status : 'none',
      }
      if (snap) orgDeptBodies[deptId] = snap.body ?? []
    }
    // 멤버별 작성 적시성(작성시각 로그 + 취합시각 → 지연 판정) + admin 증빙 export 게이트
    orgDeptTimeliness = await computeDeptTimeliness(adminForScope, orgScope, readable, orgWeekStart)
    const { data: meRole } = await adminForScope
      .from('profiles').select('role').eq('id', user.id).single() as { data: { role: string } | null }
    isAdmin = meRole?.role === 'admin'
  }

  // 서버 컴포넌트 → 클라이언트(WorkSubTabs) 경계로 함수(아이콘 컴포넌트)를 넘길 수 없으므로
  // 텍스트 라벨만 전달(다른 3개 화면도 아이콘 없음 — 4페이지 서브탭 질감 통일).
  // 탭 href에 현재 선택 주차를 실어 전환에도 주차가 유지되도록(연속성 SSOT).
  const subTabItems = [
    { key: 'mine', label: '내 보고', href: withWeek('/weekly-report?tab=mine') },
    { key: 'team', label: '팀 전체', href: withWeek('/weekly-report?tab=team') },
    ...(showOrgTab ? [{ key: 'org', label: '조직 현황', href: withWeek('/weekly-report?tab=org') }] : []),
  ]

  return (
    <WorkPageShell
      title="주간보고"
      description="주간 성과, 계획, 이슈를 기록합니다"
      subTabs={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <WorkSubTabs items={subTabItems} activeKey={activeTab} ariaLabel="주간보고 탭 전환" />
          <WeekPicker weekOptions={weekOptions} selectedWeek={tabEffectiveWeek(activeTab, selectedWeek, weekOptions)} thisWeek={thisWeek} activeTab={activeTab} />
        </div>
      }
    >
      {activeTab === 'mine' ? (
        <>
          <Suspense fallback={null}>
            <QueryToast param="saved" message="주간보고가 저장되었습니다" variant="success" />
            <QueryToast param="reset" message="보고서가 초기화되었습니다" variant="danger" />
          </Suspense>
          {/* 미처리 메모는 우측 인테이크(MemoIntakeList)로 유기적 통합 — 상단 경고 nudge 제거(v0.7.285) */}

          {/* 기존 작성폼 — 메인 작성 흐름(안 B). 우측에 일일보고 매핑 + 미처리 메모 인테이크 내장. */}
          <div className="card" style={{ padding: 'var(--space-6)', marginBottom: '1.75rem', width: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <FileText size={16} color="var(--brand)" />
                <h2 className="tape-title" style={{ margin: 0 }}>주간보고 작성</h2>
              </div>
              <OnboardingRestartLink variant="icon" seq="weekly" gateKey="weekly_report_onboarding_done" label="작성 가이드" />
            </div>
            <WeeklyReportForm
              key={`${initialWeek}-${justReset ? 'reset' : 'normal'}`}
              weekOptions={weekOptions}
              thisWeek={thisWeek}
              initialWeek={initialWeek}
              pastCategories={pastCategories}
              prefillRows={mergedPrefill}
              isFirstTimeUser={(reports ?? []).length === 0}
              hasCarryForward={hasCarryForward}
              hasSavedData={prefillRows.length > 0}
              prevWeekCategories={prevWeekCategories}
              orgName={orgName}
            />
          </div>

          {/* 편집 이력 · 되돌리기 — 작성분 유실 0의 사용자 복원 UI(마이그144 스냅샷) */}
          <WeeklyEditHistory weekStart={initialWeek} snapshots={(editSnapshots as WeeklySnapshot[]) ?? []} />

          {/* AI 자동초안(push) — 보조(접힘). 기존 작성폼이 메인, 이것은 서포트. */}
          <details style={{ marginBottom: '1.75rem' }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
                color: 'var(--text-muted)',
                padding: 'var(--space-2) 0',
              }}
            >
              AI 자동초안 (보조)
            </summary>
            <div className="card" style={{ padding: 'var(--space-6)', marginTop: 'var(--space-3)', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
                <FileText size={16} color="var(--brand)" />
                <h2 className="tape-title" style={{ margin: 0 }}>AI 자동초안</h2>
              </div>
              <AutoDraftPanel week={initialWeek} weekOptions={weekOptions} />
            </div>
          </details>

          <div>
            <h2 className="tape-title" style={{ margin: 0 }}>
              과거 주간보고
            </h2>
            <ReportAccordion groups={groups} />
          </div>

          <OnboardingRestartLink variant="text" seq="weekly" gateKey="weekly_report_onboarding_done" label="처음이신가요? 작성 가이드 보기" />
        </>
      ) : activeTab === 'team' ? (
        <div className="card" style={{ padding: 'var(--space-6)', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
            <Users size={16} color="var(--brand)" />
            <h2 className="tape-title" style={{ margin: 0 }}>팀 전체 주간보고</h2>
          </div>
          <TeamReportView weekOptions={weekOptions} thisWeek={thisWeek} initialWeek={windowWeek} initialReports={teamReports} />
        </div>
      ) : (
        <>
        <div className="card" style={{ padding: 'var(--space-6)', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
            <GitBranch size={16} color="var(--brand)" />
            <h2 className="tape-title" style={{ margin: 0 }}>조직 현황 — 부서 취합 주간보고</h2>
          </div>
          <OrgWeeklyView
            weekStart={orgWeekStart}
            thisWeek={thisWeek}
            nodes={orgScope.nodes.map((n) => ({ id: n.id, type: n.type, parent_id: n.parent_id, name: n.name }))}
            editableDeptIds={orgScope.editableDeptIds}
            readableDeptIds={orgScope.readableDeptIds}
            isExecutive={orgScope.isExecutive}
            scopeRootIds={orgScope.scopeRootIds}
            deptStats={orgDeptStats}
            deptBodies={orgDeptBodies}
            deptTimeliness={orgDeptTimeliness}
            isAdmin={isAdmin}
          />
        </div>
        <DeptTaskWeeklyPanel deptNameMap={Object.fromEntries(orgScope.nodes.map((n) => [n.id, n.name]))} />
        </>
      )}
    </WorkPageShell>
  )
}
