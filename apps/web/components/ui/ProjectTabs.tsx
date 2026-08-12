'use client'

// components/ui/ProjectTabs.tsx — CRM 그룹 탭(리드→거래처→담당자→영업기회)
// 그리는 일은 SegmentedTabs가 한다. 여기는 "어떤 탭이 있는가"만 안다.

import SegmentedTabs, { type SegmentedTab } from './SegmentedTabs'

const TABS: SegmentedTab[] = [
  { id: 'lead-intake', label: '리드 인테이크', href: '/lead-intake' },
  { id: 'accounts', label: '거래처', href: '/accounts' },
  { id: 'contacts', label: '담당자', href: '/contacts' },
  { id: 'deals', label: '영업기회', href: '/deals' },
]

export default function ProjectTabs() {
  return <SegmentedTabs tabs={TABS} variant="primary" ariaLabel="영업 탭" />
}
