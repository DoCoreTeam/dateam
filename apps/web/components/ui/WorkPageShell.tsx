'use client'

import type { ReactNode } from 'react'
import WorkTabBar from './WorkTabBar'
import PageHeader from './PageHeader'

// 업무 영역 4화면(일일/부서/주간/현황) 공용 스캐폴드 — 상단 골격을 완전 통일한다.
// 렌더 순서 고정: page-inner → WorkTabBar → PageHeader → (subTabs) → children.
// 4페이지가 동일한 "탭바 → 제목 → 서브탭 → 콘텐츠" 순서·여백을 갖도록 강제(SSOT는 .work-page-shell).
// fullBleed: 일일 일간뷰처럼 children이 자체 높이/스크롤 체인을 점유해야 할 때 true → 루트에 daily-shell 추가.
interface WorkPageShellProps {
  title: string
  description?: string
  actions?: ReactNode
  subTabs?: ReactNode
  children: ReactNode
  // 일일 fullpane 등 children 스크롤 격리가 필요한 화면에 추가 클래스를 부여(상단 골격은 불변).
  rootClassName?: string
}

export default function WorkPageShell({
  title, description, actions, subTabs, children, rootClassName,
}: WorkPageShellProps) {
  return (
    <div className={`page-inner work-page-shell${rootClassName ? ` ${rootClassName}` : ''}`}>
      <div className="work-tabbar-wrap">
        <WorkTabBar />
      </div>
      <PageHeader title={title} description={description} actions={actions} className="work-page-header" />
      {subTabs && <div className="work-subtabs-row">{subTabs}</div>}
      {children}
    </div>
  )
}
