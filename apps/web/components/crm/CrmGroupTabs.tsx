'use client'

/**
 * 묶음 안의 화면들을 잇는 탭바.
 *
 * 사이드바에서 「거래처」를 누르면 회사가 열리고, 그 화면 머리에 이 탭바가 있어
 * 인물로 건너간다. **사이드바 항목 13개가 5개가 되는 대신, 건너가는 길이 화면에 생긴다.**
 *
 * 새 부품이 아니다 — `SegmentedTabs` 의 이동형(href) 을 그대로 쓴다(§0 중복 경보).
 * 여기서 하는 일은 «지금 경로가 속한 묶음»을 찾아 그 탭들을 넘겨주는 것뿐이다.
 *
 * 탭이 하나뿐인 묶음(리포트)에서는 **아무것도 그리지 않는다** —
 * 항목이 하나인 묶음은 묶음이 아니다(§2-3-3 N-3).
 */

import { usePathname } from 'next/navigation'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { crmGroupOf } from '@/lib/crm/nav/groups'

export default function CrmGroupTabs() {
  const pathname = usePathname() ?? ''
  const group = crmGroupOf(pathname)
  if (!group || group.tabs.length < 2) return null

  return (
    <SegmentedTabs
      ariaLabel={`${group.label} 화면 전환`}
      tabs={group.tabs.map((t) => ({
        id: t.href,
        label: t.label,
        href: t.href,
        // 상세로 들어가도 그 탭이 켜진 채로 남는다 — 목록으로 돌아올 길이 계속 보인다
        match: [t.href],
      }))}
    />
  )
}
