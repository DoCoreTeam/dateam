'use client'

import Link from 'next/link'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

// 업무 영역 4화면(일일/부서/주간/현황)의 서브탭을 단일 스타일로 통일하는 공용 컴포넌트.
// WorkTabBar(상단 언더라인 섹션 네비) 아래에 일관된 pill 세그먼트로 렌더 → 4페이지 동일 질감.
// href가 있으면 <Link>(URL탭), onSelect만 있으면 <button>(state탭). 스타일/여백은 .work-subtabs SSOT.
export interface WorkSubTabItem {
  key: string
  label: string
  icon?: ComponentType<LucideProps>
  href?: string
  testId?: string
}

interface WorkSubTabsProps {
  items: WorkSubTabItem[]
  activeKey: string
  onSelect?: (key: string) => void
  ariaLabel?: string
}

export default function WorkSubTabs({ items, activeKey, onSelect, ariaLabel = '보기 전환' }: WorkSubTabsProps) {
  return (
    <div className="work-subtabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey
        const Icon = item.icon
        const inner = (
          <>
            {Icon && <Icon size={14} strokeWidth={2.2} />}
            {item.label}
          </>
        )
        const className = `work-subtab ${active ? 'is-active' : ''}`
        if (item.href) {
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              role="tab"
              aria-selected={active}
              className={className}
              data-testid={item.testId}
            >
              {inner}
            </Link>
          )
        }
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect?.(item.key)}
            className={className}
            data-testid={item.testId}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
