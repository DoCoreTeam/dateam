'use client'

/**
 * 「누구 것을 볼지」 탭 — 오늘 화면과 목록 셋이 **같은 부품**을 쓴다.
 *
 * 같은 선택을 화면마다 다시 그리면 같은 조건이 여기서는 「내 담당」, 저기서는 「나」가 되고
 * 사용자는 둘이 같은 것인지 모른다. 말은 lib/crm/ui/scope-tabs.ts 가, 그림은 여기가 한 곳에서 한다.
 *
 * **탭이 하나뿐이면 아무것도 안 그린다** — 고를 것이 하나인 선택지는 선택지가 아니라 장식이다.
 */

import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { scopeTabLabel } from '@/lib/crm/ui/scope-tabs'

interface Props {
  tabs: readonly string[]
  active: string
  onSelect: (id: string) => void
}

export default function ScopeTabs({ tabs, active, onSelect }: Props) {
  if (tabs.length < 2) return null
  return (
    <SegmentedTabs
      ariaLabel="누구 것을 볼지"
      tabs={tabs.map((id) => ({ id, label: scopeTabLabel(id) }))}
      activeId={active}
      onSelect={onSelect}
    />
  )
}
