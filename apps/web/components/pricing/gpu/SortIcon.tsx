// components/pricing/gpu/SortIcon.tsx
// 공용 정렬 아이콘 — PriceTableTab / PriceCockpitTab / MarketTab 공통 사용
// 기존 cockpit/SortIcon은 cockpit-specific SortKey/SortConfig 타입을 써서 유지.
// 이 파일은 generic으로 동작하도록 string 키 기반으로 정의.

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

export interface GenericSortConfig {
  key: string
  dir: 'asc' | 'desc'
}

interface SortIconProps {
  col: string
  sortConfig: GenericSortConfig | null
}

export function SortIcon({ col, sortConfig }: SortIconProps) {
  if (sortConfig?.key !== col) {
    return (
      <ArrowUpDown
        size={11}
        className="cockpit-sort-idle"
        aria-hidden
      />
    )
  }
  return sortConfig.dir === 'asc' ? (
    <ArrowUp size={11} className="cockpit-sort-active" aria-hidden />
  ) : (
    <ArrowDown size={11} className="cockpit-sort-active" aria-hidden />
  )
}
