import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import MobileShell from '@/components/ui/MobileShell'
import type { NavGroup } from '@/components/ui/MobileShell'
import SidebarProfile from '@/components/ui/SidebarProfile'
import QuickNav from '@/components/ui/QuickNav'
import NavigationLoader from '@/components/ui/NavigationLoader'
import { getBranding } from '@/lib/branding'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
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
  DollarSign,
  Tag,
  PlusCircle,
  Network,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import SWRProvider from './SWRProvider'

const NAV_ITEMS = [
  { href: '/intake', label: '통합 입력', icon: <PlusCircle size={16} />, highlight: true },
  { href: '/home', label: '홈', icon: <Home size={16} /> },
  { href: '/work', label: '업무', icon: <Briefcase size={16} />, match: ['/daily', '/dept-tasks', '/weekly-report'] },
  { href: '/calendar', label: '캘린더', icon: <CalendarDays size={16} /> },
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

  const [branding, profileResult, routineStatus, calendarCount, deptTaskCount] = await Promise.all([
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, must_change_password')
      .eq('id', user.id)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password'> | null; error: unknown }>,
    getRoutineWeeklyStatus(),
    shouldCountCalendar ? getTodayPlannedCount() : Promise.resolve(0),
    countMyOpenDeptTasks(),
  ])
  const profile = profileResult.data
  const routineBadge = routineStatus?.pendingCount ?? 0
  const calendarBadge = calendarCount
  const workBadge = deptTaskCount

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''

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
        footer={<SidebarProfile name={displayName} email={userEmail} isAdmin={profile?.role === 'admin'} />}
        adminHref={profile?.role === 'admin' ? '/admin/users' : undefined}
        headerLeft={
          <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            안녕하세요,{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{displayName}</strong>
            님
          </span>
        }
        headerRight={<QuickNav />}
      >
        <SWRProvider>{children}</SWRProvider>
      </MobileShell>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
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
