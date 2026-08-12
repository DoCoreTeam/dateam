'use client'

// components/ui/WorkSubTabs.tsx — 업무 화면 서브탭(보기 전환)
// 그리는 일은 SegmentedTabs가 한다. 여기는 호출부의 items/activeKey를 탭 계약으로 옮기는 어댑터다.
// href가 있으면 URL 탭, 없으면 부모가 상태를 쥐는 제어형이다.

import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import SegmentedTabs, { type SegmentedTab } from './SegmentedTabs'

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
  const tabs: SegmentedTab[] = items.map(({ key, label, icon: Icon, href, testId }) => ({
    id: key,
    label,
    href,
    testId,
    icon: Icon ? <Icon size={14} strokeWidth={2.2} /> : undefined,
  }))

  return <SegmentedTabs tabs={tabs} ariaLabel={ariaLabel} activeId={activeKey} onSelect={onSelect} />
}
