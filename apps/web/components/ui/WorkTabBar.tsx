'use client'

// components/ui/WorkTabBar.tsx — 업무 허브 섹션 탭(일일/주간/부서/프로젝트/이력)
// 그리는 일은 SegmentedTabs가 한다. 여기는 탭 구성만 안다.
// v0.7.286: 순서 재배열(주간보고↑) + '현황'을 '프로젝트 현황'으로 병합(구 /work/overview는 match로 흡수).

import { NotebookPen, Briefcase, FileText, FolderKanban, History } from 'lucide-react'
import SegmentedTabs, { type SegmentedTab } from './SegmentedTabs'
import { useMyOpenDeptTaskCount } from '@/lib/work/dept-task-badge'
import { badgeTitle } from '@/lib/terms'

const TABS: SegmentedTab[] = [
  { id: 'daily', label: '일일업무', href: '/daily', icon: <NotebookPen size={14} /> },
  { id: 'weekly', label: '주간보고', href: '/weekly-report', icon: <FileText size={14} /> },
  { id: 'dept', label: '부서 업무', href: '/dept-tasks', icon: <Briefcase size={14} /> },
  { id: 'projects', label: '프로젝트 현황', href: '/work/projects', icon: <FolderKanban size={14} />, match: ['/work/overview'] },
  { id: 'activity', label: '이력', href: '/work/activity', icon: <History size={14} /> },
]

export default function WorkTabBar() {
  /*
    사이드바 「업무」 배지가 센 것과 **같은 수**를 「부서 업무」 탭에 이어 붙인다.
    예전엔 사이드바에서만 보이고 도착 화면에는 아무 표시가 없어, 무엇이 N건인지
    알 길이 없었다(사용자 지적 2026-09-09). 0이면 배지를 그리지 않는다.
  */
  const myOpenDeptTasks = useMyOpenDeptTaskCount()
  const tabs = TABS.map((t) => (t.id === 'dept' && myOpenDeptTasks > 0
    ? {
      ...t,
      // 배지를 누르고 오면 곧장 그 N건만 보이게 — 뜻과 도착지를 맞춘다
      href: '/dept-tasks?assignee=me&status=open',
      // 활성 판정은 **경로**로 한다 — href 에 쿼리가 붙으면 pathname 비교가 어긋나 탭 불이 꺼진다
      match: ['/dept-tasks'],
      badge: myOpenDeptTasks,
      badgeTitle: badgeTitle('myOpenDeptTask', myOpenDeptTasks),
    }
    : t))
  return <SegmentedTabs tabs={tabs} variant="primary" ariaLabel="업무 탭" />
}
