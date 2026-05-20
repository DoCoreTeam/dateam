import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Sidebar from '@/components/ui/Sidebar'
import LogoutButton from '@/components/ui/LogoutButton'
import Link from 'next/link'
import {
  Users,
  FileText,
  CheckSquare,
  BarChart2,
  Settings2,
} from 'lucide-react'
import type { Profile } from '@/types/database'

const ADMIN_NAV_ITEMS = [
  {
    href: '/admin/users',
    label: '사용자 관리',
    icon: <Users size={16} />,
  },
  {
    href: '/admin/reports',
    label: '주간보고 취합',
    icon: <FileText size={16} />,
  },
  {
    href: '/admin/routine',
    label: '루틴 현황',
    icon: <CheckSquare size={16} />,
  },
  {
    href: '/admin/kpi',
    label: 'KPI 집계',
    icon: <BarChart2 size={16} />,
  },
  {
    href: '/admin/content',
    label: '콘텐츠 관리',
    icon: <Settings2 size={16} />,
  },
]

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (user.user_metadata?.must_change_password) redirect('/change-password')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'name' | 'role'> | null; error: unknown }

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const displayName = profile.name ?? user.email ?? '관리자'

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        items={ADMIN_NAV_ITEMS}
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
                background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'white',
              }}
            >
              A
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: '#cbd5e1',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayName}
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>관리자</div>
            </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge badge-indigo" style={{ fontSize: '0.75rem' }}>관리자</span>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
              {displayName}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Link
              href="/dashboard"
              style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: '#4f46e5',
                textDecoration: 'none',
                padding: '0.375rem 0.75rem',
                border: '1px solid #c7d2fe',
                borderRadius: '0.5rem',
                backgroundColor: '#eef2ff',
              }}
            >
              ← 멤버 화면
            </Link>
            <LogoutButton />
          </div>
        </header>

        <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
