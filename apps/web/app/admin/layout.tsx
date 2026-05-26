import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import MobileShell from '@/components/ui/MobileShell'
import AdminUserMenu from '@/components/ui/AdminUserMenu'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
import {
  Users,
  FileText,
  CheckSquare,
  BarChart2,
  BarChart3,
  Settings2,
  SlidersHorizontal,
  NotebookPen,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import { getBranding } from '@/lib/branding'

const ADMIN_NAV_ITEMS = [
  { href: '/admin/users', label: '사용자 관리', icon: <Users size={16} /> },
  { href: '/admin/reports', label: '주간보고 취합', icon: <FileText size={16} /> },
  { href: '/admin/daily-logs', label: '일일업무', icon: <NotebookPen size={16} /> },
  { href: '/admin/routine', label: '루틴 현황', icon: <CheckSquare size={16} /> },
  { href: '/admin/kpi', label: 'KPI 집계', icon: <BarChart2 size={16} /> },
  { href: '/admin/ai-usage', label: 'AI 사용량', icon: <BarChart3 size={16} /> },
  { href: '/admin/content', label: '콘텐츠 관리', icon: <Settings2 size={16} /> },
  { href: '/admin/settings', label: '시스템 설정', icon: <SlidersHorizontal size={16} /> },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
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
      .is('deleted_at', null)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password'> | null; error: unknown }>,
  ])
  const profile = profileResult.data

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const displayName = profile.name ?? user.email ?? '관리자'

  return (
    <>
      <MobileShell
        items={ADMIN_NAV_ITEMS}
        logoUrl={branding.logoUrl}
        brandName={branding.brandName}
        footer={<AdminUserMenu displayName={displayName} />}
        headerLeft={
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="badge badge-indigo" style={{ fontSize: '0.75rem' }}>관리자</span>
            <span style={{ fontSize: '0.875rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
          </div>
        }
      >
        {children}
      </MobileShell>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
    </>
  )
}
