'use client'

// components/ci/StageNav.tsx — 그룹 내부 스테이지 흐름 (설계서 §6.5)
// 번호와 화살표로 순서를 암시한다: 1 수집함 → 2 모니터링 → 3 트렌드.
// 메뉴를 1depth로 나열하지 않고 "흐름"으로 보이게 하는 장치다.
// 그리는 일은 SegmentedTabs(variant=stage)가 한다 — 여기는 단계 데이터만 안다.

import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'

export interface Stage {
  num: number
  label: string
  href: string
  /** 이 경로들 중 하나로 시작하면 현재 스테이지로 본다 */
  match?: string[]
}

export const RESEARCH_STAGES: Stage[] = [
  { num: 1, label: '수집함', href: '/ci/inbox' },
  { num: 2, label: '모니터링', href: '/ci/monitoring', match: ['/ci/monitoring', '/ci/channels'] },
  { num: 3, label: '트렌드', href: '/ci/trends' },
]

export default function StageNav({ stages }: { stages: Stage[] }) {
  const tabs: SegmentedTab[] = stages.map((s) => ({
    id: s.href,
    label: s.label,
    href: s.href,
    match: s.match,
    icon: <span className="seg-tab-num">{s.num}</span>,
  }))

  return <SegmentedTabs tabs={tabs} variant="stage" ariaLabel="작업 단계" />
}
