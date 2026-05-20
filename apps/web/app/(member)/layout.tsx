import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/ui/Sidebar'
import LogoutButton from '@/components/ui/LogoutButton'
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

  // user_metadata로 must_change_password 체크 (DB 쿼리 불필요, getUser()에 포함됨)
  if (user.user_metadata?.must_change_password) redirect('/change-password')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'name' | 'role'> | null; error: unknown }

  const displayName = profile?.name ?? user.user_metadata?.name ?? user.email ?? '팀원'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        items={NAV_ITEMS}
        footer={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.5rem 0.5rem',
            }}
          >
            <div
              style={{
                width: '1.875rem',
                height: '1.875rem',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'white',
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span
              style={{
                fontSize: '0.8125rem',
                color: '#cbd5e1',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName}
            </span>
          </div>
        }
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
        <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
