import { redirect } from 'next/navigation'
import { redirectApiUser, requireAdminMfa } from '@/lib/auth/api-user-gate'
import { isResigned } from '@/lib/members/employment'
import { Suspense } from 'react'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import OnboardingProvider from '@/components/onboarding/OnboardingProvider'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup, NavItem } from '@/components/ui/shell/AppShell'
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
import { cookies, headers } from 'next/headers'
import { Home, Briefcase, Inbox, CalendarDays, NotebookPen, DollarSign, Tag, Network, Sparkles, Handshake, Radar, FileSearch, CandlestickChart } from 'lucide-react'
import type { Profile } from '@/types/database'
import SWRProvider from './SWRProvider'
import { SIDEBAR_TOP_LINKS, SIDEBAR_GROUP_LINKS, type MenuLink } from '@/lib/nav/menu'
import { openSurfaces, deniedSurfaceName } from '@/lib/access/guard'
import AccessDenied from '@/components/ui/AccessDenied'
import { badgeTitle } from '@/lib/terms'
import { MyOpenDeptTaskProvider } from '@/lib/work/dept-task-badge'

/**
 * 사이드바 그림표 — **이름과 주소는 여기 없다.**
 *
 * 목록은 `lib/nav/menu.ts` 의 `SIDEBAR_TOP_LINKS`·`SIDEBAR_GROUP_LINKS` 가 주고,
 * 그 둘은 등재부(`lib/access/surfaces.ts`)에서 나온다. 화면이 정하는 것은 **그림뿐**이다.
 *
 * 예전엔 이 파일이 href 목록을 손으로 들고 있었다. 그래서 화면을 새로 만들면
 * 사이드바·전체 메뉴 두 목록을 사람이 기억해서 고쳐야 했고, 잊으면 그 화면은
 * **있는 줄도 모르는 화면**이 됐다(콘텐츠 인텔리전스가 그랬다).
 *
 * 빠뜨린 그림은 오류처럼 보이지 않는다 — 그 줄만 조용히 비어 그려진다
 * (실측 v0.7.716: AI 스튜디오만 그림이 없었다). 그래서 `lib/nav/menu.test.ts` 가
 * 여기 있는 키와 목록을 대조해 **빠진 그림을 실패로 만든다.**
 */
const SIDEBAR_ICON: Record<string, React.ReactNode> = {
  '/home': <Home size={16} />,
  '/work': <Briefcase size={16} />,
  '/calendar': <CalendarDays size={16} />,
  '/meeting-notes': <NotebookPen size={16} />,
  '/org': <Network size={16} />,
  '/crm': <Handshake size={16} />,
  '/ci': <Radar size={16} />,
  '/ai': <Sparkles size={16} />,
  '/rfp': <FileSearch size={16} />,
  '/trading': <CandlestickChart size={16} />,
  '/pricing/gpu': <DollarSign size={16} />,
  '/pricing/catalog': <Tag size={16} />,
}

const withIcon = (link: MenuLink): NavItem => ({
  href: link.href,
  label: link.label,
  icon: SIDEBAR_ICON[link.href],
  ...(link.match ? { match: link.match } : {}),
})

const NAV_ITEMS: NavItem[] = SIDEBAR_TOP_LINKS.map(withIcon)

const NAV_GROUPS: NavGroup[] = SIDEBAR_GROUP_LINKS.map((g) => ({
  key: g.key,
  label: g.label,
  items: g.items.map(withIcon),
}))

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
  const [branding, profileResult, routineStatus, calendarCount, deptTaskCount, globalTheme, orgScope, myWeekResult, employmentResult] = await Promise.all([
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
    /*
      퇴사일이 왔는지 본다.

      **왜 배치가 아니라 여기인가** (사용자 지적 2026-09-18): 퇴사일을 앞날로 잡으면 그날이
      와야 막혀야 한다. 매일 도는 배치를 두면 그 배치가 안 돌 때 그대로 뚫린다. 이 레이아웃은
      화면을 전환할 때마다 도니까, 그날이 오면 **다음 클릭에** 막힌다. 놓칠 구간이 없다.
      같은 Promise.all 에 태우므로 왕복은 늘지 않는다.
    */
    adminClient
      .from('member_employment')
      .select('user_id, resigned_on')
      .eq('user_id', user.id)
      .maybeSingle() as unknown as Promise<{ data: { user_id: string; resigned_on: string | null } | null }>,
  ])
  const profile = profileResult.data
  // api_user는 내부 화면에 들어올 수 없다 — 예전엔 미들웨어가 role을 따로 조회해 막았지만,
  // 위 Promise.all이 이미 같은 행에서 role을 읽으므로 여기서 막으면 왕복이 0회다.
  await redirectApiUser(profile?.role)
  await requireAdminMfa(profile?.role)
  // 퇴사일이 온 사람은 내부 화면에 들어올 수 없다. 로그인 차단(auth ban)이 주 방어선이고,
  // 여기는 앞날로 잡아 둔 퇴사일이 조용히 지나가는 경우를 받는 자리다.
  if (isResigned(employmentResult.data)) redirect('/login?reason=resigned')
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

  /**
   * 메뉴에 무엇을 그릴지 **막는 쪽과 같은 함수**에게 묻는다(`lib/access/guard.ts`).
   *
   * 예전엔 여기가 `canSeeNav`(표 하나)를, 라우트는 `requireAdmin` 을 봤다. 두 판정이
   * 갈린 결과가 「메뉴에는 보이는데 들어가면 막히는 문」 넷이었다(실측 2026-09-21).
   * 묶음 권한(`ADMIN_ONLY_GROUPS`)도 여기서 따로 안 본다 — 묶음이 통째로 닫히는 것은
   * **그 안이 전부 닫힌 결과**여야 한다. 묶음과 항목이 각자 판정하면 묶음을 풀 때
   * 권한이 같이 바뀐다(§2-3-3 N-3 이 막는 바로 그 패턴).
   *
   * 부여 조회는 요청당 한 번이다(`loadViewerAccess` 가 `cache()` 로 싸여 있다).
   */
  /**
   * 숨긴 것은 **막힌 것과 같아야 한다.**
   *
   * 메뉴만 거르면 숨기기는 권한이 아니라 정리 도구가 된다 — 실측 2026-09-21:
   * 부여로 `/pricing/gpu` 를 막았더니 메뉴에서는 사라졌는데 주소를 치면 그대로 열렸다.
   * 화면마다 적게 하면 새 화면을 만든 사람이 기억해야 하고, 기억해야 하는 규칙은
   * 반드시 빠뜨린다 — 그래서 `(member)` 전부를 여기 한 줄이 지킨다.
   *
   * 되돌려 보내지 않고 **그 자리에서 말한다.** 예전에 `/dashboard` 로 보냈다가
   * next.config 가 그것을 `/home` 으로 되돌려, 사용자는 눌렀는데 홈에 와 있었다.
   */
  const deniedName = await deniedSurfaceName((await headers()).get('x-pathname'))

  const open = await openSurfaces([
    ...NAV_ITEMS.map((i) => i.href),
    ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
  ])

  const navItemsWithBadge = NAV_ITEMS
    .filter((item) => open.has(item.href))
    .map((item) => {
      /*
        배지에는 **무엇을 세는지**를 함께 붙인다(§0-2 · `lib/terms/badge.ts`).
        숫자만 있으면 사용자는 눌러 보고서야 뜻을 알고, 도착지가 그 숫자를 안 보여 주면
        영영 모른다 — 사용자 지적 2026-09-09: 「눌렀는데 뭐가 뜬건지 알 수 있는 방법이 없구만」.
      */
      if (item.href === '/routine') {
        return { ...item, badge: routineBadge, badgeTitle: badgeTitle('routinePending', routineBadge) }
      }
      if (item.href === '/calendar') {
        return { ...item, badge: calendarBadge, badgeTitle: badgeTitle('todayEvent', calendarBadge) }
      }
      if (item.href === '/work') {
        return { ...item, badge: workBadge, badgeTitle: badgeTitle('myOpenDeptTask', workBadge) }
      }
      return item
    })

  return (
    <>
      <AppShell
        items={navItemsWithBadge}
        groups={NAV_GROUPS
          .map((g) => ({ ...g, items: g.items.filter((i) => open.has(i.href)) }))
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
        {/*
          사이드바 배지가 센 값을 그대로 업무 탭 줄까지 물려준다 — 다시 세지 않는다.
          이것이 「배지를 눌렀는데 그 1건이 어디 있는지 모른다」를 끊는 자리다.
        */}
        <MyOpenDeptTaskProvider count={workBadge}>
          {/* 셸은 그대로 두고 본문만 바꾼다 — 사이드바가 남아 있어야 «시스템이 고장 난 것»이 아니라 «내 권한이 아직 아닌 것»으로 읽힌다 */}
          {deniedName ? <AccessDenied what={deniedName} /> : <SWRProvider>{children}</SWRProvider>}
        </MyOpenDeptTaskProvider>
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
