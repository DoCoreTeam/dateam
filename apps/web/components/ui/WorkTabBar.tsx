'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotebookPen, Briefcase, FileText, BarChart3 } from 'lucide-react'
import type { CSSProperties } from 'react'

// 업무 허브 공유 탭바 — 일일업무/부서업무/주간보고/현황을 단일 "업무" 메뉴의 탭으로 묶는다.
// 기존 라우트를 그대로 사용(최소변경). active는 pathname 기준.
const TABS = [
  { href: '/daily', label: '일일업무', icon: NotebookPen },
  { href: '/dept-tasks', label: '부서 업무', icon: Briefcase },
  { href: '/weekly-report', label: '주간보고', icon: FileText },
  { href: '/work/overview', label: '현황', icon: BarChart3 },
]

function tabStyle(isActive: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: '0.375rem',
    padding: 'var(--space-2) var(--space-4)',
    fontSize: 'var(--fs-base)', fontWeight: isActive ? 600 : 500,
    color: isActive ? 'var(--brand)' : 'var(--text-muted)',
    borderBottom: isActive ? 'var(--border-w-2) solid var(--brand)' : 'var(--border-w-2) solid transparent',
    textDecoration: 'none', whiteSpace: 'nowrap',
  }
}

export default function WorkTabBar() {
  const pathname = usePathname()
  return (
    <nav aria-label="업무 탭" style={{ display: 'flex', borderBottom: 'var(--border-w-2) solid var(--border-color)', marginBottom: 'var(--space-5)', overflowX: 'auto' }}>
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/')
        const Icon = t.icon
        return (
          <Link key={t.href} href={t.href} prefetch={false} style={{ ...tabStyle(active), minHeight: 44 }} aria-current={active ? 'page' : undefined}>
            <Icon size={14} />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
