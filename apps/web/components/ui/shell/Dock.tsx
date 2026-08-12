'use client'

// components/ui/shell/Dock.tsx — 우측 하단 고정 레이어 (02-SYSTEM §4)
//
// 왜 좌표를 컴포넌트가 못 정하게 하는가:
//   QuickAddFab(bottom:1.5rem/right:1.5rem, z:90)과 CI 어시스턴트 FAB
//   (bottom:var(--space-4)/right:var(--space-4), z:var(--z-sticky)=90)이 좌표·z가 모두 같아
//   실제로 겹쳐 잘렸다. ScrollJumpButtons는 그걸 피하려고 `bottom: 92` 매직넘버를 썼다.
//   각자 좌표를 정하는 한 FAB이 하나 늘 때마다 같은 사고가 난다.
//   → 좌표는 Dock만 안다. 화면은 "어느 슬롯인지"만 등록한다.
//
// 슬롯은 코너에서 가까운 순서로 쌓인다: primary(맨 아래) → assistant → utility(맨 위).

import type { ReactNode } from 'react'

export type DockSlot = 'primary' | 'assistant' | 'utility'

export interface DockItem {
  slot: DockSlot
  /** 같은 슬롯 안에서의 정렬(작을수록 코너에 가깝다). 기본 0 */
  order?: number
  /**
   * 렌더할 노드.
   * 설계 초안은 `render: () => ReactNode`였지만, 서버 컴포넌트(layout)가 Dock 항목을
   * 넘기는 구조라 **함수는 직렬화되지 않는다**(Next.js RSC 경계). 노드로 받는다.
   */
  node: ReactNode
}

const SLOT_RANK: Record<DockSlot, number> = { primary: 0, assistant: 1, utility: 2 }

export default function Dock({ items }: { items: readonly DockItem[] }) {
  if (items.length === 0) return null

  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const slot = SLOT_RANK[a.item.slot] - SLOT_RANK[b.item.slot]
      if (slot !== 0) return slot
      const order = (a.item.order ?? 0) - (b.item.order ?? 0)
      return order !== 0 ? order : a.index - b.index
    })

  return (
    <div className="app-dock">
      {sorted.map(({ item, index }) => (
        <div key={`${item.slot}-${index}`} className="app-dock-slot">
          {item.node}
        </div>
      ))}
    </div>
  )
}
