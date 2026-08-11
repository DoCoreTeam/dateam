'use client'

// components/ci/StageNav.tsx — 그룹 내부 스테이지 이동 (설계서 §6.5)
// 번호와 화살표로 순서를 암시한다: 1 수집함 → 2 모니터링 → 3 트렌드.
// 메뉴를 1depth로 나열하지 않고 흐름으로 보이게 하는 장치다.

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
  const pathname = usePathname()

  return (
    <nav className="ci-stage-nav" aria-label="작업 단계">
      {stages.map((s, i) => {
        const targets = s.match ?? [s.href]
        const current = targets.some((t) => pathname === t || pathname.startsWith(t + '/'))
        return (
          <span key={s.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <Link
              href={s.href}
              className="ci-stage-item"
              aria-current={current ? 'page' : undefined}
            >
              <span className="ci-stage-num">{s.num}</span>
              {s.label}
            </Link>
            {i < stages.length - 1 && <span className="ci-stage-arrow" aria-hidden="true">→</span>}
          </span>
        )
      })}
    </nav>
  )
}
