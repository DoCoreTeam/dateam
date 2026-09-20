// app/(rfp)/layout.tsx — RFP 분석기 표면 진입
//
// 셸은 AppShell 하나뿐이다. 새 셸을 만들지 않는다(shell-contract 가드).
// 접근은 임직원(admin·member)이다 — CRM 과 같다. 관리자 설정만 메뉴에서 갈린다.

import { FileSearch, FilePlus2, Radar, Building2, MessagesSquare, Settings } from 'lucide-react'
import { redirect } from 'next/navigation'
import { redirectApiUser, requireAdminMfa } from '@/lib/auth/api-user-gate'
import { getRequestUser } from '@/lib/supabase/server'
import { getRequestProfile } from '@/lib/auth/request-profile'
import { getBranding } from '@/lib/branding'
import { getActiveTheme, resolveTheme } from '@/lib/theme'
import AppShell from '@/components/ui/shell/AppShell'
import type { NavGroup } from '@/components/ui/shell/AppShell'
import { rfpNavFor, rfpNavMatchPaths } from '@/lib/rfp/nav/groups'
import AssistantDock from '@/components/rfp/AssistantDock'
import HelpButton from '@/components/rfp/HelpButton'

/** 이름은 표(lib/rfp/nav/groups)가, 그림은 화면이 정한다 */
const NAV_ICON: Record<string, React.ReactNode> = {
  '/rfp': <FileSearch size={16} />,
  '/rfp/new': <FilePlus2 size={16} />,
  '/rfp/assistant': <MessagesSquare size={16} />,
  '/rfp/radar': <Radar size={16} />,
  '/rfp/profile': <Building2 size={16} />,
  '/rfp/admin': <Settings size={16} />,
}

export default async function RfpLayout({ children }: { children: React.ReactNode }) {
  const profile = await getRequestProfile()
  await redirectApiUser(profile?.role)
  await requireAdminMfa(profile?.role)

  const user = await getRequestUser()
  if (!user) redirect('/login')
  // 임직원만 — api_user 는 위에서, 비로그인은 여기서 걸린다
  if (profile?.role !== 'admin' && profile?.role !== 'member') redirect('/')

  const isAdmin = profile?.role === 'admin'
  const groups: NavGroup[] = rfpNavFor(isAdmin).map((g) => ({
    label: g.label,
    items: g.items.map((it) => ({
      href: it.href,
      label: it.label,
      icon: NAV_ICON[it.href] ?? <FileSearch size={16} />,
      // 「케이스」는 섹션 루트라 exact 로 둔다 — 안 그러면 /rfp/* 어디서나 켜져 있다
      exact: it.href === '/rfp',
      match: rfpNavMatchPaths(it).slice(1),
    })),
  }))

  const [branding, globalTheme] = await Promise.all([getBranding(), getActiveTheme()])

  return (
    <AppShell
      groups={groups}
      branding={{ logoUrl: branding.logoUrl, brandName: branding.brandName }}
      session={{
        name: profile?.name ?? user.email ?? '',
        email: user.email ?? '',
        isAdmin,
        currentTheme: resolveTheme(profile?.theme_preference, globalTheme),
        defaultTheme: globalTheme,
      }}
      extras={{
        dock: [
          // 어시스턴트는 메뉴 항목이자 **어느 화면에서나 열리는 자리**다.
          // 좌표는 스스로 정하지 않는다 — Dock 의 assistant 슬롯이 준다(+ 버튼과 겹치지 않게).
          { slot: 'assistant', node: <AssistantDock /> },
          // 물음표. 지금 주소에 맞는 사용법을 연다.
          { slot: 'utility', node: <HelpButton /> },
        ],
      }}
    >
      {children}
    </AppShell>
  )
}
