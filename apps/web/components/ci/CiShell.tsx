'use client'

// components/ci/CiShell.tsx — 콘텐츠 인텔리전스 셸
//
// 셸을 자작하지 않는다. 기존 MobileShell을 그대로 쓴다 —
// 로고·사이드바 타이포·배지·모바일 드로어가 전부 거기 있고,
// 따로 만들면 같은 앱 안에서 질감이 갈라진다
// (실제 사고: 로고 누락 · 메뉴 폰트 흐림 · 배지 색 불일치).
// 여기서는 CI의 메뉴 구성과 어시스턴트만 얹는다.

import {
  Home, Inbox, Radar, TrendingUp, PenTool, Layers, Send, Radio, BarChart3, Settings, Scissors } from 'lucide-react'
import type { ReactNode } from 'react'
import MobileShell from '@/components/ui/MobileShell'
import type { NavGroup } from '@/components/ui/MobileShell'
import SidebarProfile from '@/components/ui/SidebarProfile'
import QuickNav from '@/components/ui/QuickNav'
import type { ThemeId } from '@/lib/themes'
import type { CiLoopMinimap } from '@/lib/ci/contracts'
import AssistantPanel from './AssistantPanel'
import CiSidebarFooter from './CiSidebarFooter'
import NotificationBell from './NotificationBell'

const NAV_ITEMS = [
  // 섹션 루트라 exact로 둔다 — 안 그러면 /ci/* 어디서나 '홈'이 활성으로 남는다
  { href: '/ci', label: '홈', icon: <Home size={16} />, exact: true },
]

/** 건수는 MobileShell의 badge 슬롯으로 넘긴다. 라벨에 숫자를 붙이지 않는다. */
function badge(count?: number): number | undefined {
  return count && count > 0 ? count : undefined
}

function buildGroups(counts?: CiLoopMinimap): NavGroup[] {
  return [
    {
      label: '리서치',
      items: [
        { href: '/ci/inbox', label: '수집함', icon: <Inbox size={16} />, badge: badge(counts?.review) },
        { href: '/ci/monitoring', label: '모니터링', icon: <Radar size={16} />, match: ['/ci/channels'] },
        { href: '/ci/trends', label: '트렌드', icon: <TrendingUp size={16} />, badge: badge(counts?.newOutliers) },
      ],
    },
    {
      label: '제작',
      items: [
        { href: '/ci/pipeline', label: '파이프라인', icon: <PenTool size={16} />, match: ['/ci/briefs'], badge: badge(counts?.producing) },
        { href: '/ci/studio', label: '편집점', icon: <Scissors size={16} /> },
        { href: '/ci/boards', label: '보드', icon: <Layers size={16} /> },
        { href: '/ci/assets', label: '자료', icon: <Layers size={16} /> },
      ],
    },
    {
      label: '게시',
      items: [
        { href: '/ci/publish', label: '게시', icon: <Send size={16} />, badge: badge(counts?.ready) },
        { href: '/ci/my-channels', label: '내 채널', icon: <Radio size={16} /> },
      ],
    },
    {
      label: '성과',
      items: [
        { href: '/ci/performance', label: '성과', icon: <BarChart3 size={16} /> },
        { href: '/ci/settings', label: '설정', icon: <Settings size={16} /> },
      ],
    },
  ]
}

interface CiShellProfile {
  name: string
  email: string
  isAdmin: boolean
  currentTheme?: ThemeId
  defaultTheme?: ThemeId
}

interface CiShellProps {
  workspaceId: string
  workspaceName: string
  logoUrl?: string | null
  brandName?: string
  counts?: CiLoopMinimap
  profile: CiShellProfile
  children: ReactNode
}

export default function CiShell({
  workspaceId, workspaceName, logoUrl, brandName, counts, profile, children,
}: CiShellProps) {
  return (
    <MobileShell
      items={NAV_ITEMS}
      groups={buildGroups(counts)}
      logoUrl={logoUrl}
      brandName={brandName}
      adminHref={profile.isAdmin ? '/admin/users' : undefined}
      isAdmin={profile.isAdmin}
      // 좌측 하단은 사내 업무와 같은 계정 영역. 그 위에 사내 업무로 돌아가는 길만 얹는다.
      footer={
        <>
          <CiSidebarFooter workspaceName={workspaceName} />
          <SidebarProfile
            name={profile.name}
            email={profile.email}
            isAdmin={profile.isAdmin}
            currentTheme={profile.currentTheme}
            defaultTheme={profile.defaultTheme}
          />
        </>
      }
      // 떡상 알림은 "매일 접속할 이유의 1번"(§8.1)이라 화면이 아니라 셸에 붙는다 —
      // 어느 화면에 있든 새 알림이 보여야 한다.
      headerRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <NotificationBell workspaceId={workspaceId} />
          <QuickNav />
        </div>
      }
    >
      {children}
      <AssistantPanel workspaceId={workspaceId} />
    </MobileShell>
  )
}
