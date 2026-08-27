// components/ui/shell/AppShell.tsx — 전 화면 공통 골격 (02-SYSTEM §3)
//
// 왜 이 파일이 생겼나:
//   셸이 `MobileShell(footer, headerRight)` **자유 슬롯**이라 셸마다 꽂는 게 달랐다.
//   그 결과 admin에는 전역검색·테마·비밀번호·패치노트가 통째로 없었고, CI에는 검색이 없었다.
//   "빠뜨릴 수 있는 구조"가 원인이므로, 상위 인터페이스를 **선택이 아니라 기본**으로 만든다.
//
// 계약
//   - 좌측 하단 계정 메뉴(이름·비밀번호·테마·패치노트·로그아웃) = 항상. 끄는 옵션 없음.
//   - 우측 상단 전역검색 + 전체메뉴 = 항상. `extras.headerExtra`는 **추가만** 가능.
//   - 우측 하단 Dock(§4) = 좌표를 Dock이 독점. 화면은 슬롯 등록만.
//   - 새 셸을 만들지 않는다. CI도 이 셸을 쓰고 `workspace`만 주입한다.
//   - `MobileShell`은 이 컴포넌트의 **내부 구현**으로 남는다(395줄 재작성 회피).
//   - 녹음 세션(§회의 작업대) = 항상. 네 표면이 이 셸을 공유하므로 제공자를 여기 **한 번만** 둔다.
//     화면이 들고 있으면 라우트를 옮길 때 언마운트돼 진행 중 구간(최대 10분)이 사라진다.
//
// 가드: lib/ui/shell-contract.test.ts

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import MobileShell from '@/components/ui/MobileShell'
import type { NavGroup, NavItem } from '@/components/ui/MobileShell'

// 화면은 MobileShell을 몰라도 된다 — 셸 타입의 공개 창구는 AppShell 하나다.
export type { NavGroup, NavItem }
import SidebarProfile from '@/components/ui/SidebarProfile'
import GlobalSearchBox from '@/components/ui/GlobalSearchBox'
import QuickNav from '@/components/ui/QuickNav'
import type { DockItem } from './Dock'
import { RecordingProvider } from '@/lib/meeting/recording-context'
import RecordingBar from '@/components/meeting/RecordingBar'
import OfflineBar from '@/components/ui/OfflineBar'
import type { ThemeId } from '@/lib/themes'

/** 계정 메뉴에 필요한 최소 정보 — 옵션이 아니라 필수다(빠뜨리면 admin 사고 재발). */
export interface ShellSession {
  name: string
  email: string
  isAdmin: boolean
  currentTheme?: ThemeId
  defaultTheme?: ThemeId
}

/** CI처럼 "워크스페이스 안에 들어와 있는" 표면일 때만. 나가는 길과 현재 위치를 보여준다. */
export interface WorkspaceContext {
  name: string
  exitHref?: string
  exitLabel?: string
}

export interface AppShellProps {
  items?: NavItem[]
  groups?: NavGroup[]
  session: ShellSession
  branding?: { logoUrl?: string | null; brandName?: string }
  workspace?: WorkspaceContext
  /**
   * 검색이 어디를 찾을지.
   *
   * 워크스페이스 안(CRM 등)에서는 그 안을 찾아야 한다 — 안 그러면 검색이
   * 사용자를 지금 보던 곳 밖으로 데리고 나간다. 안 주면 호스트 업무 검색이다.
   */
  search?: { action: string; placeholder?: string }
  /** 추가는 가능, 기본 제거는 불가 */
  extras?: {
    headerLeft?: ReactNode
    headerExtra?: ReactNode
    dock?: DockItem[]
  }
  children: ReactNode
}

export default function AppShell({
  items = [],
  groups,
  session,
  branding,
  workspace,
  search,
  extras,
  children,
}: AppShellProps) {
  return (
    <MobileShell
      items={items}
      groups={groups}
      logoUrl={branding?.logoUrl}
      brandName={branding?.brandName}
      isAdmin={session.isAdmin}
      adminHref={session.isAdmin ? '/admin/users' : undefined}
      dock={extras?.dock}
      headerLeft={extras?.headerLeft}
      // 자유 슬롯이 아니다 — 검색·전체메뉴는 항상 들어가고, extras는 그 앞에 붙는다.
      headerRight={
        <>
          {extras?.headerExtra}
          <GlobalSearchBox action={search?.action} placeholder={search?.placeholder} />
          <QuickNav />
        </>
      }
      footer={
        <>
          {workspace && (
            <div className="shell-workspace">
              <Link className="shell-workspace-exit" href={workspace.exitHref ?? '/home'}>
                <ArrowLeft size={16} />
                {workspace.exitLabel ?? '사내 업무로'}
              </Link>
              <p className="shell-workspace-name">{workspace.name}</p>
            </div>
          )}
          <SidebarProfile
            name={session.name}
            email={session.email}
            isAdmin={session.isAdmin}
            currentTheme={session.currentTheme}
            defaultTheme={session.defaultTheme}
          />
        </>
      }
    >
      {/* 녹음은 화면보다 오래 산다 — 제공자가 셸에 있어야 라우트를 옮겨도 안 끊긴다.
          바는 `.app-shell` 안에 둔다(`--dock-safe-area` 를 상속받아야 모바일에서 Dock 을 안 가린다). */}
      <RecordingProvider>
        {/* 연결이 끊기면 어느 화면에 있든 여기서 말한다 — 회의는 이동 중에 끊긴다 */}
        <OfflineBar />
        {children}
        <RecordingBar />
      </RecordingProvider>
    </MobileShell>
  )
}
