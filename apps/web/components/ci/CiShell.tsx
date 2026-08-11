'use client'

// components/ci/CiShell.tsx — 콘텐츠 인텔리전스 셸
// 설계서 §5.1 동사형 5그룹 IA. (member) 셸의 사내 업무 NAV와 물리적으로 분리된 표면이다.
// data-surface="ci"가 밀도형 토큰을 켠다(globals.css).

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home, Search, PenTool, Send, BarChart3, Settings, ArrowLeft, Plus,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CiLoopMinimap } from '@/lib/ci/contracts'
import AssistantPanel from './AssistantPanel'

interface NavItem {
  href: string
  label: string
  icon: ReactNode
  match?: string[]
  countKey?: keyof CiLoopMinimap
}

interface NavGroup {
  label: string | null
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/ci', label: '홈', icon: <Home size={16} /> }],
  },
  {
    label: '리서치',
    items: [
      { href: '/ci/inbox', label: '수집함', icon: <Search size={16} />, countKey: 'review' },
      { href: '/ci/monitoring', label: '모니터링', icon: <Search size={16} />, match: ['/ci/monitoring', '/ci/channels'] },
      { href: '/ci/trends', label: '트렌드', icon: <Search size={16} />, countKey: 'newOutliers' },
    ],
  },
  {
    label: '제작',
    items: [
      { href: '/ci/pipeline', label: '파이프라인', icon: <PenTool size={16} />, countKey: 'producing' },
      { href: '/ci/boards', label: '보드', icon: <PenTool size={16} /> },
      { href: '/ci/assets', label: '자료', icon: <PenTool size={16} /> },
    ],
  },
  {
    label: '게시',
    items: [
      { href: '/ci/publish', label: '게시', icon: <Send size={16} />, countKey: 'ready' },
      { href: '/ci/my-channels', label: '내 채널', icon: <Send size={16} /> },
    ],
  },
  {
    label: '성과',
    items: [
      { href: '/ci/performance', label: '성과', icon: <BarChart3 size={16} />, countKey: 'tracking' },
    ],
  },
]

const MOBILE_TABS: NavItem[] = [
  { href: '/ci', label: '홈', icon: <Home size={18} /> },
  { href: '/ci/trends', label: '리서치', icon: <Search size={18} /> },
  { href: '/ci/inbox?add=1', label: '추가', icon: <Plus size={18} /> },
  { href: '/ci/pipeline', label: '제작', icon: <PenTool size={18} /> },
  { href: '/ci/performance', label: '성과', icon: <BarChart3 size={18} /> },
]

function isCurrent(pathname: string, item: NavItem): boolean {
  const targets = item.match ?? [item.href.split('?')[0]]
  return targets.some((t) => (t === '/ci' ? pathname === '/ci' : pathname === t || pathname.startsWith(t + '/')))
}

interface CiShellProps {
  workspaceId: string
  workspaceName: string
  counts?: CiLoopMinimap
  children: ReactNode
}

export default function CiShell({ workspaceId, workspaceName, counts, children }: CiShellProps) {
  const pathname = usePathname()

  return (
    <div className="ci-shell" data-surface="ci">
      <aside className="ci-sidebar">
        <div className="ci-sidebar-brand">콘텐츠 인텔리전스</div>

        <nav className="ci-nav" aria-label="주 메뉴">
          {NAV.map((group, gi) => (
            <div className="ci-nav-group" key={group.label ?? `g${gi}`}>
              {group.label && <p className="ci-nav-group-label">{group.label}</p>}
              {group.items.map((item) => {
                const count = item.countKey && counts ? counts[item.countKey] : 0
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="ci-nav-item"
                    aria-current={isCurrent(pathname, item) ? 'page' : undefined}
                  >
                    {item.icon}
                    {item.label}
                    {count > 0 && <span className="ci-nav-count ci-num">{count}</span>}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="ci-sidebar-foot">
          <Link href="/ci/settings" className="ci-nav-item">
            <Settings size={16} />설정
          </Link>
          <Link href="/home" className="ci-nav-item">
            <ArrowLeft size={16} />사내 업무로
          </Link>
          <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>{workspaceName}</p>
        </div>
      </aside>

      <main className="ci-main">
        <div className="page-inner">{children}</div>
      </main>

      <AssistantPanel workspaceId={workspaceId} />

      <nav className="ci-tabbar" aria-label="모바일 메뉴">
        {MOBILE_TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="ci-tabbar-item"
            aria-current={isCurrent(pathname, t) ? 'page' : undefined}
          >
            {t.icon}
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
