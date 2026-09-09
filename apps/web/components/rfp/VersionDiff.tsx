'use client'

// 판 사이 diff — 바뀐 값과 **양쪽 근거**를 함께 보여 준다.
//
// 값만 보여 주면 어느 쪽이 맞는지 모른다. 우리가 잘못 읽었을 수도 있고
// 정말 바뀌었을 수도 있다 — 원문을 보면 1초에 판단된다.

import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import RfpEvidenceLink from './RfpEvidenceLink'
import { RFP_RADAR, RFP_REPORT } from '@/lib/rfp/terms'
import type { FieldDiff } from '@/lib/rfp/revision/diff'
import type { StatusKey } from '@/lib/tokens/status-colors'

const KIND_STATUS: Record<FieldDiff['kind'], StatusKey> = {
  changed: 'doing', added: 'done', removed: 'blocker', unchanged: 'note',
}

export interface VersionDiffProps {
  changes: FieldDiff[]
  onOpenEvidence?: (blockId: string) => void
}

export default function VersionDiff({ changes, onOpenEvidence }: VersionDiffProps) {
  if (changes.length === 0) {
    return <EmptyState title={RFP_RADAR.revisionNone} />
  }

  return (
    <div>
      {changes.map((d) => (
        <div key={d.fieldPath} className="card">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
            <span className="label">{d.fieldPath}</span>
            <NbBadge status={KIND_STATUS[d.kind]}>{d.kind}</NbBadge>
          </div>

          <p>
            <span style={{ textDecoration: 'line-through', color: 'var(--text-faint)' }}>
              {show(d.before)}
            </span>
            <span> {show(d.after)}</span>
          </p>

          {/* 양쪽 근거를 함께 — 원문을 보면 1초에 판단된다 */}
          <div>
            {d.beforeEvidence.map((e, i) => (
              <RfpEvidenceLink key={`b-${i}`} evidence={e} onOpen={onOpenEvidence} />
            ))}
            {d.afterEvidence.map((e, i) => (
              <RfpEvidenceLink key={`a-${i}`} evidence={e} onOpen={onOpenEvidence} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function show(v: unknown): string {
  if (v === null || v === undefined) return RFP_REPORT.noValue
  if (typeof v === 'number') return v.toLocaleString()
  if (Array.isArray(v)) return String(v.length)
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60)
  return String(v)
}
