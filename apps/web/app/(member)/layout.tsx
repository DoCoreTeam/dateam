import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/ui/Sidebar'
import SidebarProfile from '@/components/ui/SidebarProfile'
import NavigationLoader from '@/components/ui/NavigationLoader'
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
  {
    href: '/dashboard',
    label: '대시보드',
    icon: <LayoutDashboard size={16} />,
  },
  {
    href: '/routine',
    label: '루틴 체크',
    icon: <CheckSquare size={16} />,
  },
  {
    href: '/kpi',
    label: 'KPI',
    icon: <BarChart2 size={16} />,
  },
  {
    href: '/weekly-report',
    label: '주간보고',
    icon: <FileText size={16} />,
  },
  {
    href: '/operations',
    label: '본부 운영',
    icon: <Building2 size={16} />,
  },
]

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('name, role, must_change_password')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'name' | 'role' | 'must_change_password'> | null; error: unknown }

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'
  const userEmail = user.email ?? ''

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        items={NAV_ITEMS}
        footer={<SidebarProfile name={displayName} email={userEmail} />}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 상단바 */}
        <header
          style={{
            height: '56px',
            backgroundColor: 'white',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1.5rem',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
            안녕하세요,{' '}
            <strong style={{ color: '#0f172a', fontWeight: 600 }}>{displayName}</strong>
            님
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {profile?.role === 'admin' && (
              <Link
                href="/admin/users"
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#dc2626',
                  textDecoration: 'none',
                  padding: '0.375rem 0.75rem',
                  border: '1px solid #fecaca',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fef2f2',
                  transition: 'background 120ms',
                }}
              >
                관리자 패널 →
              </Link>
            )}
            <LogoutButton />
          </div>
        </header>

        {/* 메인 콘텐츠 */}
        <main style={{ flex: 1, padding: '2rem', overflowY: 'auto', backgroundColor: 'var(--color-bg)' }}>
          {children}
        </main>
      </div>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
      <NavigationLoader orgName="AX사업본부" />
    </div>
  )
}
