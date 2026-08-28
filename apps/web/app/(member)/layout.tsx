import { redirect } from 'next/navigation'
import { redirectApiUser } from '@/lib/auth/api-user-gate'
import { Suspense } from 'react'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import OnboardingProvider from '@/components/onboarding/OnboardingProvider'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
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
import { Home, Briefcase, Inbox, CalendarDays, NotebookPen, DollarSign, Tag, Network, Sparkles, Handshake, Radar } from 'lucide-react'
import type { Profile } from '@/types/database'
import SWRProvider from './SWRProvider'
import { navLabel, SERVICE_NAV, SERVICE_GROUP_LABEL, ADMIN_ONLY_GROUPS, canSeeNav } from '@/lib/nav/menu'

// 이름은 lib/nav/menu 에서 온다 — 사이드바와 전체 메뉴가 갈리지 않게(§2-3-3 N-4)
const NAV_ITEMS = [
  { href: '/home', label: navLabel('/home'), icon: <Home size={16} /> },
  { href: '/work', label: navLabel('/work'), icon: <Briefcase size={16} />, match: ['/daily', '/dept-tasks', '/weekly-report', '/work'] },
  { href: '/calendar', label: navLabel('/calendar'), icon: <CalendarDays size={16} /> },
  { href: '/meeting-notes', label: navLabel('/meeting-notes'), icon: <NotebookPen size={16} /> },
  { href: '/org', label: navLabel('/org'), icon: <Network size={16} /> },
  // 관리자 전용 여부는 여기 안 적는다 — `NAV_AUDIENCE`(lib/nav/menu) 한 곳이 정하고
  // 사이드바·전체 메뉴가 **같은 표**를 읽는다. 화면마다 플래그를 들면 또 갈린다.
  { href: '/ai-chat', label: navLabel('/ai-chat'), icon: <Sparkles size={16} /> },
]

/** 하위 서비스로 들어가는 아이콘 — 이름은 표가, 그림은 화면이 정한다 */
const SERVICE_ICON: Record<string, React.ReactNode> = {
  '/crm': <Handshake size={16} />,
  '/ci': <Radar size={16} />,
}

const NAV_GROUPS: NavGroup[] = [
  {
    /**
     * 서비스 (§2-3-3 N-1) — 사이드바가 통째로 그 서비스 것으로 바뀌는 곳을 **한 자리에** 모은다.
     *
     * 예전엔 「영업」 그룹에 CRM 하나만 있었고 **콘텐츠 인텔리전스는 아예 없었다** —
     * 전체 메뉴로만 들어갈 수 있어서, 있는 줄 모르면 못 찾았다.
     *
     * ⚠️ 지금은 admin 에게만 보인다(`ADMIN_ONLY_GROUPS`). 실제 접근 판정은 각 서비스의
     *    멤버십이 한다(CRM=CrmMember · CI=워크스페이스). 비관리자 멤버가 생기면
     *    그때 그 표만 고치면 된다 — 지금 미리 조회하면 화면마다 왕복이 한 번 는다
     *    (v0.7.492 에서 줄인 그 왕복이다).
     */
    key: 'service',
    label: SERVICE_GROUP_LABEL,
    items: SERVICE_NAV.map((s) => ({
      href: s.href, label: s.label, icon: SERVICE_ICON[s.href], match: [s.href],
    })),
  },
  {
    key: 'pricing',
    label: '가격정책',
    items: [
      { href: '/pricing/gpu', label: navLabel('/pricing/gpu'), icon: <DollarSign size={16} /> },
      { href: '/pricing/catalog', label: navLabel('/pricing/catalog'), icon: <Tag size={16} /> },
    ],
  },
]

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const user = await getRequestUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const cookieStore = await cookies()
  const todayStr = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
  const calendarSeenDate = cookieStore.get('calendar_seen_date')?.value
  const shouldCountCalendar = calendarSeenDate !== todayStr

  // 이번 주(ISO 월요일) — 주간보고 미작성 게이트용. Promise.all보다 먼저 계산해야 같이 태울 수 있다.
  const weekAnchor = new Date(`${todayStr}T00:00:00Z`)
  const dow = weekAnchor.getUTCDay()
  weekAnchor.setUTCDate(weekAnchor.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  const thisMonday = weekAnchor.toISOString().slice(0, 10)

  // 이 레이아웃은 **화면을 전환할 때마다** 다시 돈다. 하나라도 Promise.all 밖에 있으면
  // 그만큼 원격 왕복이 직렬로 붙는다(myWeekCount가 그랬다 — v0.7.458 실측에서 발견).
  const [branding, profileResult, routineStatus, calendarCount, deptTaskCount, globalTheme, orgScope, myWeekResult] = await Promise.all([
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
    adminClient
      .from('weekly_reports')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('week_start', thisMonday)
      .is('deleted_at', null),
  ])
  const profile = profileResult.data
  // api_user는 내부 화면에 들어올 수 없다 — 예전엔 미들웨어가 role을 따로 조회해 막았지만,
  // 위 Promise.all이 이미 같은 행에서 role을 읽으므로 여기서 막으면 왕복이 0회다.
  redirectApiUser(profile?.role)
  const weeklyReportPending = (myWeekResult.count ?? 0) === 0

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

  const isAdmin = profile?.role === 'admin'

  const navItemsWithBadge = NAV_ITEMS
    // 항목 권한도 표 하나에서 온다 — `adminOnly` prop 을 화면이 따로 해석하지 않는다
    .filter((item) => canSeeNav(item.href, isAdmin))
    .map((item) => {
      if (item.href === '/routine') return { ...item, badge: routineBadge }
      if (item.href === '/calendar') return { ...item, badge: calendarBadge }
      if (item.href === '/work') return { ...item, badge: workBadge }
      return item
    })

  return (
    <>
      <AppShell
        items={navItemsWithBadge}
        // 권한은 **키**로 판정한다 — 예전엔 `g.label === '가격정책'` 이라 메뉴 이름만 바꿔도
        // 권한이 바뀌었다(§2-3-3 N-3). 항목 권한은 `canSeeNav` 가 같은 표를 읽는다.
        groups={NAV_GROUPS
          .filter((g) => isAdmin || !(g.key && ADMIN_ONLY_GROUPS.has(g.key)))
          .map((g) => ({ ...g, items: g.items.filter((i) => canSeeNav(i.href, isAdmin)) }))
          .filter((g) => g.items.length > 0)}
        branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
        session={{
          name: displayName,
          email: userEmail,
          isAdmin,
          currentTheme,
          defaultTheme: globalTheme,
        }}
        extras={{ headerLeft: (
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
        ) }}
      >
        <SWRProvider>{children}</SWRProvider>
      </AppShell>
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
