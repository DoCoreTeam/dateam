'use client'

import type { ReactNode } from 'react'
import WorkTabBar from './WorkTabBar'
import PageHeader from './PageHeader'

// 업무 영역 화면(일일/부서/주간/현황/이력) 공용 스캐폴드 — 상단 골격을 완전 통일한다.
// 렌더 순서 고정: page-inner → PageHeader → WorkTabBar → (subTabs) → children.
// 동일한 "제목 → 허브 탭 → 서브탭 → 콘텐츠" 순서·여백을 강제(SSOT는 .work-page-shell).
//
// 왜 제목이 먼저인가: 예전엔 탭바가 제목보다 **위**였다. 그러면 지금 보고 있는 화면의 이름을
// 알기 전에 다른 화면 목록부터 읽게 된다. 리서치(/ci) 쪽은 같은 성격의 화면 간 내비게이션을
// 제목 **아래**(PageHeader의 below)에 두고 있어서, 한 제품 안에서 위아래가 서로 반대였다
// (사용자 지적: "다 맞춰야지 통일 시켜 안정감있게").
// 아래 CSS 주석도 이미 그 의도를 적어 두고 있었다 — "계층은 모양이 아니라 위치로 구분한다,
// 헤더 바로 아래냐 본문 위냐"(globals.css). 렌더만 그 의도와 어긋나 있었다.
// fullBleed: 일일 일간뷰처럼 children이 자체 높이/스크롤 체인을 점유해야 할 때 true → 루트에 daily-shell 추가.
interface WorkPageShellProps {
  title: string
  /** 상세 화면의 상위 복귀 — PageHeader로 그대로 넘긴다(화면이 뒤로가기를 자작하지 않게) */
  back?: { href: string; label: string }
  description?: string
  actions?: ReactNode
  subTabs?: ReactNode
  children: ReactNode
  // 일일 fullpane 등 children 스크롤 격리가 필요한 화면에 추가 클래스를 부여(상단 골격은 불변).
  rootClassName?: string
}

export default function WorkPageShell({
  title, back, description, actions, subTabs, children, rootClassName,
}: WorkPageShellProps) {
  return (
    <div className={`page-inner work-page-shell${rootClassName ? ` ${rootClassName}` : ''}`}>
      <PageHeader title={title} back={back} description={description} actions={actions} className="work-page-header" />
      <div className="work-tabbar-wrap">
        <WorkTabBar />
      </div>
      {subTabs && <div className="work-subtabs-row">{subTabs}</div>}
      {children}
    </div>
  )
}
