import { redirect } from 'next/navigation'
import { redirectApiUser } from '@/lib/auth/api-user-gate'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
import PasswordChangeModal from '@/components/ui/PasswordChangeModal'
import NameSetupModal from '@/components/ui/NameSetupModal'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import {
  Users,
  FileText,
  CheckSquare,
  BarChart2,
  SlidersHorizontal,
  NotebookPen,
  Key,
  Tag,
  Bot,
  Building2,
  ShieldCheck,
  MessageSquare, ScrollText } from 'lucide-react'
import type { Profile } from '@/types/database'
import { getBranding } from '@/lib/branding'

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
      { href: '/admin/ai-chat', label: 'AI 채팅', icon: <MessageSquare size={16} /> },
      { href: '/admin/data-quality', label: '데이터 품질', icon: <ShieldCheck size={16} /> },
      { href: '/admin/system-log', label: '시스템 로그', icon: <ScrollText size={16} /> },
      { href: '/admin/settings', label: '시스템 설정', icon: <SlidersHorizontal size={16} /> },
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
  const user = await getRequestUser()

  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  // 테마·이메일은 계정 메뉴(AppShell 기본 제공)가 요구하는 값이다.
  // 예전 admin 셸은 이 둘을 안 읽어서 관리자에게만 테마·비밀번호·패치노트가 없었다.
  const [branding, profileResult, globalTheme] = await Promise.all([
    getBranding(),
    adminClient
      .from('profiles')
      .select('name, role, must_change_password, theme_preference')
      .eq('id', user.id)
      .is('deleted_at', null)
      .single() as unknown as Promise<{ data: Pick<Profile, 'name' | 'role' | 'must_change_password' | 'theme_preference'> | null; error: unknown }>,
    getActiveTheme(),
  ])
  const profile = profileResult.data

  // api_user는 자기 자리로 되돌린다(아래 admin 게이트보다 먼저 — 목적지가 다르다)
  redirectApiUser(profile?.role)
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const displayName = profile.name ?? user.email ?? '관리자'
  const currentTheme = resolveTheme(profile.theme_preference, globalTheme)

  return (
    <>
      <AppShell
        groups={ADMIN_NAV_GROUPS}
        branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
        session={{
          name: displayName,
          email: user.email ?? '',
          isAdmin: true,
          currentTheme,
          defaultTheme: globalTheme,
        }}
        extras={{
          headerLeft: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="badge badge-indigo" style={{ fontSize: 'var(--fs-xs)' }}>관리자</span>
              <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </span>
            </div>
          ),
        }}
      >
        {children}
      </AppShell>
      {profile?.must_change_password && <PasswordChangeModal />}
      {!profile?.must_change_password && !profile?.name && <NameSetupModal />}
    </>
  )
}
