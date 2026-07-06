import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OnboardingProvider from '@/components/onboarding/OnboardingProvider'
import MobileShell from '@/components/ui/MobileShell'
import type { NavGroup } from '@/components/ui/MobileShell'
import SidebarProfile from '@/components/ui/SidebarProfile'
import QuickNav from '@/components/ui/QuickNav'
import GlobalSearchBox from '@/components/ui/GlobalSearchBox'
import NavigationLoader from '@/components/ui/NavigationLoader'
import { getBranding } from '@/lib/branding'
import { resolveOrgScope, orgPathFromScope } from '@/lib/org-scope'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
import WeeklyReminderModal from '@/components/ui/WeeklyReminderModal'
import RoutineCheckinGate from '@/components/ui/RoutineCheckinGate'
import { getRoutineWeeklyStatus } from './routine/actions'
import { getTodayPlannedCount } from './daily/actions'
import { countMyOpenDeptTasks } from './dept-tasks/actions'
import { cookies } from 'next/headers'
import {
  Home,
  Briefcase,
  Inbox,
  CalendarDays,
  NotebookPen,
  DollarSign,
  Tag,
  Network,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import SWRProvider from './SWRProvider'

const NAV_ITEMS = [
  { href: '/home', label: '홈', icon: <Home size={16} /> },
  { href: '/work', label: '업무', icon: <Briefcase size={16} />, match: ['/daily', '/dept-tasks', '/weekly-report', '/work'] },
  { href: '/calendar', label: '캘린더', icon: <CalendarDays size={16} /> },
  { href: '/meeting-notes', label: '회의노트', icon: <NotebookPen size={16} /> },
  { href: '/org', label: '조직도', icon: <Network size={16} /> },
]

const NAV_GROUPS: NavGroup[] = [
  {
    label: '프로젝트관리',
    items: [
      { href: '/lead-intake', label: '프로젝트관리', icon: <Inbox size={16} /> },
    ],
  },
  {
    label: '가격정책',
    items: [
      { href: '/pricing/gpu', label: 'GPU 관리', icon: <DollarSign size={16} /> },
      { href: '/pricing/catalog', label: '판매가격표', icon: <Tag size={16} /> },
    ],
  },
]

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const cookieStore = await cookies()
  const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
  const calendarSeenDate = cookieStore.get('calendar_seen_date')?.value
  const shouldCountCalendar = calendarSeenDate !== todayStr

  const [branding, profileResult, routineStatus, calendarCount, deptTaskCount, globalTheme, orgScope] = await Promise.all([
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, must_change_password, theme_preference, onboarding_completed_at, onboarding_skipped_at, onboarding_step')
      .eq('id', user.id)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password' | 'theme_preference' | 'onboarding_completed_at' | 'onboarding_skipped_at' | 'onboarding_step'> | null; error: unknown }>,
    getRoutineWeeklyStatus(),
    shouldCountCalendar ? getTodayPlannedCount() : Promise.resolve(0),
    countMyOpenDeptTasks(),
    getActiveTheme(),
    resolveOrgScope(adminClient, user.id),
  ])
  const profile = profileResult.data

  // 이번 주(ISO 월요일) 주간보고 미작성 여부 → 작성 안내 모달 게이트
  const weekAnchor = new Date(`${todayStr}T00:00:00Z`)
  const dow = weekAnchor.getUTCDay()
  weekAnchor.setUTCDate(weekAnchor.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  const thisMonday = weekAnchor.toISOString().slice(0, 10)
  const { count: myWeekCount } = await adminClient
    .from('weekly_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('week_start', thisMonday)
    .is('deleted_at', null)
  const weeklyReportPending = (myWeekCount ?? 0) === 0

  const orgPath = orgPathFromScope(orgScope, user.id)
  const currentTheme = resolveTheme(profile?.theme_preference, globalTheme)
  const routineBadge = routineStatus?.pendingCount ?? 0
  const calendarBadge = calendarCount
  const workBadge = deptTaskCount

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''

  // 온보딩 자동시작: 비번변경/이름설정 모달이 우선이므로 그 둘이 없을 때만.
  // 완료·스킵 둘 다 없을 때(NULL=미경험)만 시작 → 기존 사용자 일괄 노출은 마이그레이션 백필로 제어(BE).
  const onboardingBlockedByModal =
    Boolean(profile?.must_change_password) || (!profile?.must_change_password && !profile?.name)
  const onboardingDone = Boolean(profile?.onboarding_completed_at) || Boolean(profile?.onboarding_skipped_at)
  const shouldStartOnboarding = !onboardingBlockedByModal && !onboardingDone

  const navItemsWithBadge = NAV_ITEMS.map((item) => {
    if (item.href === '/routine') return { ...item, badge: routineBadge }
    if (item.href === '/calendar') return { ...item, badge: calendarBadge }
    if (item.href === '/work') return { ...item, badge: workBadge }
    return item
  })

  return (
    <>
      <MobileShell
        items={navItemsWithBadge}
        groups={profile?.role === 'admin' ? NAV_GROUPS : NAV_GROUPS.filter(g => g.label === '가격정책')}
        logoUrl={branding.logoUrl}
        brandName={branding.brandName}
        footer={<SidebarProfile name={displayName} email={userEmail} isAdmin={profile?.role === 'admin'} currentTheme={currentTheme} defaultTheme={globalTheme} />}
        adminHref={profile?.role === 'admin' ? '/admin/users' : undefined}
        isAdmin={profile?.role === 'admin'}
        headerLeft={
          orgPath.length > 0 ? (
            <nav aria-label="소속 조직" style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {orgPath.map((name, i) => (
                <span key={`${name}-${i}`}>
                  {i > 0 && <span aria-hidden style={{ margin: '0 var(--space-1)', color: 'var(--text-faint)' }}>›</span>}
                  <span style={{ color: i === orgPath.length - 1 ? 'var(--text)' : 'var(--text-muted)', fontWeight: i === orgPath.length - 1 ? 600 : 400 }}>{name}</span>
                </span>
              ))}
            </nav>
          ) : (
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              안녕하세요,{' '}
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{displayName}</strong>
              님
            </span>
          )
        }
        headerRight={<><GlobalSearchBox /><QuickNav /></>}
      >
        <SWRProvider>{children}</SWRProvider>
      </MobileShell>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
      {!profile?.must_change_password && profile?.name && weeklyReportPending && (
        <WeeklyReminderModal weekStart={thisMonday} />
      )}
      {shouldStartOnboarding && (
        <Suspense fallback={null}>
          <OnboardingProvider shouldAutoStart resumeStepKey={profile?.onboarding_step ?? null} />
        </Suspense>
      )}
      <NavigationLoader brandName={branding.brandName} logoUrl={branding.logoUrl} />
      {routineStatus && routineStatus.weeklyItems.length > 0 && (
        <RoutineCheckinGate
          weekStart={routineStatus.weekStart}
          weeklyItems={routineStatus.weeklyItems}
          initialCompletedNames={routineStatus.completedNames}
        />
      )}
    </>
  )
}
