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
  SlidersHorizontal,
  NotebookPen,
  Key,
  Tag,
  Bot,
  Building2,
  ShieldCheck,
  History,
} from 'lucide-react'
import type { Profile } from '@/types/database'
import { getBranding } from '@/lib/branding'
import type { NavGroup } from '@/components/ui/MobileShell'

const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: '구성원 관리',
    items: [
      { href: '/admin/members', label: '구성원 관리', icon: <Users size={16} /> },
    ],
  },
  {
    label: '업무 현황',
    items: [
      { href: '/admin/daily-logs', label: '일일업무', icon: <NotebookPen size={16} /> },
      { href: '/admin/reports', label: '주간보고 취합', icon: <FileText size={16} /> },
    ],
  },
  {
    label: 'API · 시스템',
    items: [
      { href: '/admin/api', label: 'API 관리', icon: <Key size={16} /> },
      { href: '/admin/ai-usage', label: 'AI 사용량', icon: <Bot size={16} /> },
      { href: '/admin/ai-prompts', label: 'AI 프롬프트', icon: <Bot size={16} /> },
      { href: '/admin/data-quality', label: '데이터 품질', icon: <ShieldCheck size={16} /> },
      { href: '/admin/settings', label: '시스템 설정', icon: <SlidersHorizontal size={16} /> },
      { href: '/admin/changelog', label: '업데이트 내역', icon: <History size={16} /> },
    ],
  },
  {
    label: '비즈니스',
    items: [
      { href: '/admin/partner-tiers', label: '파트너 등급', icon: <Tag size={16} /> },
    ],
  },
  {
    label: '부서운영',
    items: [
      { href: '/admin/routine', label: '루틴 현황', icon: <CheckSquare size={16} /> },
      { href: '/admin/kpi', label: 'KPI 집계', icon: <BarChart2 size={16} /> },
      { href: '/admin/content', label: '콘텐츠 관리', icon: <Building2 size={16} /> },
    ],
  },
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
        items={[]}
        groups={ADMIN_NAV_GROUPS}
        logoUrl={branding.logoUrl}
        brandName={branding.brandName}
        footer={<AdminUserMenu displayName={displayName} />}
        headerLeft={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="badge badge-indigo" style={{ fontSize: 'var(--fs-xs)' }}>관리자</span>
            <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
