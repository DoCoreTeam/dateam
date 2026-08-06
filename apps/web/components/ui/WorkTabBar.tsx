'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotebookPen, Briefcase, FileText, FolderKanban, History } from 'lucide-react'

// 업무 허브 공유 탭바 — 일일업무/주간보고/부서업무/프로젝트 현황을 단일 "업무" 메뉴의 탭으로 묶는다.
// v0.7.286: 순서 재배열(주간보고↑) + '현황' 탭을 '프로젝트 현황'으로 병합(구 /work/overview는 리다이렉트).
// 기존 라우트를 그대로 사용(최소변경). active는 pathname 기준(match로 병합 경로도 활성 처리).
const TABS: { href: string; label: string; icon: typeof NotebookPen; match?: string[] }[] = [
  { href: '/daily', label: '일일업무', icon: NotebookPen },
  { href: '/weekly-report', label: '주간보고', icon: FileText },
  { href: '/dept-tasks', label: '부서 업무', icon: Briefcase },
  { href: '/work/projects', label: '프로젝트 현황', icon: FolderKanban, match: ['/work/overview'] },
  { href: '/work/activity', label: '이력', icon: History },
]

export default function WorkTabBar() {
  const pathname = usePathname()
  return (
    <nav aria-label="업무 탭" className="work-primary-tabs">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/') ||
          (t.match?.some((m) => pathname === m || pathname.startsWith(m + '/')) ?? false)
        const Icon = t.icon
        return (
          <Link key={t.href} href={t.href} prefetch={false} className={`work-primary-tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon size={14} />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
