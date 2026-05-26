import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import MobileShell from '@/components/ui/MobileShell'
import type { NavGroup } from '@/components/ui/MobileShell'
import SidebarProfile from '@/components/ui/SidebarProfile'
import NavigationLoader from '@/components/ui/NavigationLoader'
import { getBranding } from '@/lib/branding'
import LogoutButton from '@/components/ui/LogoutButton'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
import RoutineCheckinGate from '@/components/ui/RoutineCheckinGate'
import Link from 'next/link'
import { getRoutineWeeklyStatus } from './routine/actions'
import { getTodayPlannedCount } from './daily/actions'
import { cookies } from 'next/headers'
import {
  LayoutDashboard,
  CheckSquare,
  BarChart2,
  FileText,
  Building2,
  Briefcase,
  Users,
  TrendingUp,
  Inbox,
  NotebookPen,
  CalendarDays,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import SWRProvider from './SWRProvider'

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', icon: <LayoutDashboard size={16} /> },
  { href: '/daily', label: '일일로그', icon: <NotebookPen size={16} /> },
  { href: '/calendar', label: '캘린더', icon: <CalendarDays size={16} /> },
  { href: '/routine', label: '루틴 체크', icon: <CheckSquare size={16} /> },
  { href: '/kpi', label: 'KPI', icon: <BarChart2 size={16} /> },
  { href: '/weekly-report', label: '주간보고', icon: <FileText size={16} /> },
  { href: '/operations', label: '본부 운영', icon: <Building2 size={16} /> },
]

const NAV_GROUPS: NavGroup[] = [
  {
    label: '프로젝트관리',
    items: [
      { href: '/accounts', label: '거래처', icon: <Briefcase size={16} /> },
      { href: '/contacts', label: '담당자', icon: <Users size={16} /> },
      { href: '/deals', label: '영업기회', icon: <TrendingUp size={16} /> },
      { href: '/lead-intake', label: '리드 인테이크', icon: <Inbox size={16} /> },
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

  const [branding, profileResult, routineStatus, calendarCount] = await Promise.all([
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, must_change_password')
      .eq('id', user.id)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password'> | null; error: unknown }>,
    getRoutineWeeklyStatus(),
    shouldCountCalendar ? getTodayPlannedCount() : Promise.resolve(0),
  ])
  const profile = profileResult.data
  const routineBadge = routineStatus?.pendingCount ?? 0
  const calendarBadge = calendarCount

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''

  const navItemsWithBadge = NAV_ITEMS.map((item) => {
    if (item.href === '/routine') return { ...item, badge: routineBadge }
    if (item.href === '/calendar') return { ...item, badge: calendarBadge }
    return item
  })

  return (
    <>
      <MobileShell
        items={navItemsWithBadge}
        groups={NAV_GROUPS}
        logoUrl={branding.logoUrl}
        brandName={branding.brandName}
        footer={<SidebarProfile name={displayName} email={userEmail} />}
        adminHref={profile?.role === 'admin' ? '/admin/users' : undefined}
        headerLeft={
          <span style={{ fontSize: '0.875rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            안녕하세요,{' '}
            <strong style={{ color: '#0f172a', fontWeight: 600 }}>{displayName}</strong>
            님
          </span>
        }
        headerRight={
          <>
            {profile?.role === 'admin' && (
              <Link
                href="/admin/users"
                className="desktop-only"
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#dc2626',
                  textDecoration: 'none',
                  padding: '0.375rem 0.75rem',
                  border: '1px solid #fecaca',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fef2f2',
                }}
              >
                관리자 패널 →
              </Link>
            )}
            <LogoutButton />
          </>
        }
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
