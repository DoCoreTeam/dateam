import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import MobileShell from '@/components/ui/MobileShell'
import SidebarProfile from '@/components/ui/SidebarProfile'
import NavigationLoader from '@/components/ui/NavigationLoader'
import { getBranding } from '@/lib/branding'
import LogoutButton from '@/components/ui/LogoutButton'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
import Link from 'next/link'
import {
  LayoutDashboard,
  CheckSquare,
  BarChart2,
  FileText,
  Building2,
} from 'lucide-react'
import type { Profile } from '@/types/database'

const NAV_ITEMS = [
  { href: '/dashboard', label: '대시보드', icon: <LayoutDashboard size={16} /> },
  { href: '/routine', label: '루틴 체크', icon: <CheckSquare size={16} /> },
  { href: '/kpi', label: 'KPI', icon: <BarChart2 size={16} /> },
  { href: '/weekly-report', label: '주간보고', icon: <FileText size={16} /> },
  { href: '/operations', label: '본부 운영', icon: <Building2 size={16} /> },
]

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const [branding, profileResult] = await Promise.all([
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, must_change_password')
      .eq('id', user.id)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password'> | null; error: unknown }>,
  ])
  const profile = profileResult.data

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''

  return (
    <>
      <MobileShell
        items={NAV_ITEMS}
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
        {children}
      </MobileShell>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
      <NavigationLoader brandName={branding.brandName} logoUrl={branding.logoUrl} />
    </>
  )
}
