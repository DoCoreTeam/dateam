// components/ci/LoopMinimap.tsx — 홈 상단 5칸 루프 (설계서 §5.2)
// 리서치 → 제작 → 게시 → 성과 → 다시 리서치.
// 각 숫자를 누르면 해당 스테이지로 바로 이동한다.

import Link from 'next/link'
import type { CiLoopMinimap } from '@/lib/ci/contracts'

const CELLS: { key: keyof CiLoopMinimap; label: string; href: string }[] = [
  { key: 'review', label: '검토 대기', href: '/ci/inbox?tab=review' },
  { key: 'newOutliers', label: '새 떡상', href: '/ci/trends?tab=outliers' },
  { key: 'producing', label: '제작 중', href: '/ci/pipeline' },
  { key: 'ready', label: '게시 준비', href: '/ci/pipeline?stage=ready' },
  { key: 'tracking', label: '추적 중', href: '/ci/performance' },
]

export default function LoopMinimap({ counts }: { counts: CiLoopMinimap }) {
  return (
    <nav className="ci-minimap" aria-label="제품 루프 현황">
      {CELLS.map((c) => (
        <Link key={c.key} href={c.href} className="ci-minimap-cell">
          <span className="ci-minimap-num">{counts[c.key]}</span>
          <span className="ci-minimap-label">{c.label}</span>
        </Link>
      ))}
    </nav>
  )
}
