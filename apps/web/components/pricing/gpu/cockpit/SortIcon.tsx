// components/pricing/gpu/cockpit/SortIcon.tsx
// 정렬 방향 아이콘 — PriceTableTab 패턴 재사용

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import type { SortConfig, SortKey } from './types'

interface SortIconProps {
  col: SortKey
  sortConfig: SortConfig | null
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
