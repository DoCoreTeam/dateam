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

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { dockSafeAreaPx } from '@/lib/ui/dock-metrics'

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

/**
 * 스택이 실제로 몇 px인지 본문에 알려 준다 — 상수로는 못 맞춘다.
 *
 * 왜: `--dock-safe-area`는 5.5rem(88px) 고정이었는데, 실측 스택은 176px이고
 * '수집 중 36건 남음' 칩이 뜨면 250px까지 자란다. 여백이 절반뿐이라 **끝까지 스크롤해도**
 * 목록 마지막 행의 아이콘 버튼이 Dock 아래에 남았고, 누르면 그 자리의 어시스턴트·+ 버튼이
 * 대신 받았다(실측 /ci/inbox v0.7.547: 3행 열기·삭제, 4행 삭제). "안 눌린다"가 아니라
 * **다른 게 눌린다** — 삭제를 눌렀는데 어시스턴트가 열리는 쪽이 더 나쁘다.
 *
 * 좌표 규칙은 그대로다(Dock만 좌표를 안다). 여기서 내보내는 것은 좌표가 아니라 **자기 높이**다.
 */
function usePublishDockHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const publish = () => {
      // 계산은 lib/ui/dock-metrics.ts가 갖는다 — 여기 인라인으로 두면 검증 수단이
      // 실브라우저뿐이고, 정작 확인해야 하는 '칩 떠서 250px' 상태는 수집이 안 돌면 재현되지 않는다.
      const px = dockSafeAreaPx(window.innerHeight, el.getBoundingClientRect().top)
      root.style.setProperty('--dock-height', `${px}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty('--dock-height')
    }
  }, [ref])
}

export default function Dock({ items }: { items: readonly DockItem[] }) {
  const ref = useRef<HTMLDivElement>(null)
  usePublishDockHeight(ref)

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
    <div className="app-dock" ref={ref}>
      {sorted.map(({ item, index }) => (
        <div key={`${item.slot}-${index}`} className="app-dock-slot">
          {item.node}
        </div>
      ))}
    </div>
  )
}
