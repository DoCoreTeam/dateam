'use client'

// 정정공고 차수 비교 — 사슬과 diff 를 함께 보여 준다.
//
// 앞 차수를 지우지 않기 때문에 「1차 → 2차 → 3차」가 그대로 남는다.
// 그 이력이 곧 정정공고 기능의 값어치다.

import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import VersionDiff from './VersionDiff'
import { RFP_RADAR } from '@/lib/rfp/terms'
import type { FieldDiff } from '@/lib/rfp/revision/diff'

export interface RevisionChainItem {
  caseId: string
  round: number
  isLatest: boolean
}

export interface RevisionDiffPanelProps {
  chain: RevisionChainItem[]
  changes: FieldDiff[]
  critical: FieldDiff[]
  summary: string | null
  onOpenEvidence?: (blockId: string) => void
}

export default function RevisionDiffPanel({
  chain, changes, critical, summary, onOpenEvidence,
}: RevisionDiffPanelProps) {
  if (chain.length === 0) return <EmptyState title={RFP_RADAR.revisionNone} />

  return (
    <section>
      <h2 className="label">{RFP_RADAR.revisionTitle}</h2>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {chain.map((c) => (
          <a key={c.caseId} href={`/rfp/${c.caseId}`}>
            <NbBadge status={c.isLatest ? 'done' : 'note'}>{c.round}</NbBadge>
          </a>
        ))}
      </div>

      {summary && <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{summary}</p>}

      {/* 이 필드가 바뀌면 제안 전략이 흔들린다 — 위로 올린다 */}
      {critical.length > 0 && <VersionDiff changes={critical} onOpenEvidence={onOpenEvidence} />}
      <VersionDiff changes={changes} onOpenEvidence={onOpenEvidence} />
    </section>
  )
}
