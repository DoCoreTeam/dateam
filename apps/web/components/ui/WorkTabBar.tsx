'use client'

// components/ui/WorkTabBar.tsx — 업무 허브 섹션 탭(일일/주간/부서/프로젝트/이력)
// 그리는 일은 SegmentedTabs가 한다. 여기는 탭 구성만 안다.
// v0.7.286: 순서 재배열(주간보고↑) + '현황'을 '프로젝트 현황'으로 병합(구 /work/overview는 match로 흡수).

import { NotebookPen, Briefcase, FileText, FolderKanban, History } from 'lucide-react'
import SegmentedTabs, { type SegmentedTab } from './SegmentedTabs'

const TABS: SegmentedTab[] = [
  { id: 'daily', label: '일일업무', href: '/daily', icon: <NotebookPen size={14} /> },
  { id: 'weekly', label: '주간보고', href: '/weekly-report', icon: <FileText size={14} /> },
  { id: 'dept', label: '부서 업무', href: '/dept-tasks', icon: <Briefcase size={14} /> },
  { id: 'projects', label: '프로젝트 현황', href: '/work/projects', icon: <FolderKanban size={14} />, match: ['/work/overview'] },
  { id: 'activity', label: '이력', href: '/work/activity', icon: <History size={14} /> },
]

export default function WorkTabBar() {
  return <SegmentedTabs tabs={TABS} variant="primary" ariaLabel="업무 탭" />
}
