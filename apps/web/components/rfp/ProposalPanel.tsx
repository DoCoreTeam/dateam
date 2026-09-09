'use client'

// 제안서 목차와 전략 — 목차 항목마다 근거 요구사항이 붙는다.
//
// 근거 없는 목차는 남의 목차다. 안 달면 다음 사업에서 이 목차를 그대로 복사하고
// 그 사업의 배점표와 어긋난 채 제출된다.

import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import { RFP_PROFILE } from '@/lib/rfp/terms'
import type { OutlineItem } from '@/lib/rfp/proposal/outline'
import type { ProposalStrategy } from '@/lib/rfp/proposal/strategy'

export interface ProposalPanelProps {
  outline: OutlineItem[]
  strategy: ProposalStrategy | null
  uncovered: string[]
}

export default function ProposalPanel({ outline, strategy, uncovered }: ProposalPanelProps) {
  if (outline.length === 0) return <EmptyState title={RFP_PROFILE.proposalOutline} />

  return (
    <section>
      <h2 className="label">{RFP_PROFILE.proposalOutline}</h2>
      <ol>
        {outline.map((o) => (
          <li key={o.number} className="card">
            <span style={{ fontWeight: 600 }}>{o.number}. {o.title}</span>
            {o.points !== null && <NbBadge status="note">{o.points}</NbBadge>}
            {o.suggestedPages !== null && <NbBadge status="note">{o.suggestedPages}</NbBadge>}
            {/* 어느 요구사항을 다루는 장인지 */}
            {o.requirementCodes.length > 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
                {o.requirementCodes.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ol>

      {uncovered.length > 0 && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {RFP_PROFILE.uncovered} {uncovered.join(', ')}
        </p>
      )}

      {strategy && (
        <div className="card">
          <span className="label">{RFP_PROFILE.proposalStrategy}</span>
          <p>{strategy.recommendedRole}</p>
          <ul>
            {strategy.emphasize.map((p, i) => <li key={`e-${i}`}>{p.point} — {p.basis}</li>)}
          </ul>
          <ul>
            {strategy.fill.map((p, i) => <li key={`f-${i}`}>{p.point} — {p.basis}</li>)}
          </ul>
          <ul>
            {strategy.watch.map((p, i) => <li key={`w-${i}`}>{p.point} — {p.basis}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
