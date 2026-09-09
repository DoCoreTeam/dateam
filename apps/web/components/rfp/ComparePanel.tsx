'use client'

// 유사 사업 비교 — 다섯 축을 같은 자로 재서 나란히 놓는다.
//
// 「비슷합니다」라고만 하면 사용자가 할 일이 없다.
// 무엇이 어떻게 다른지, 그리고 양쪽 근거가 함께 있어야 판단이 된다.

import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import RfpEvidenceLink from './RfpEvidenceLink'
import { RFP_REPORT, RFP_LIST } from '@/lib/rfp/terms'
import { AXIS_LABEL, type ComparisonRow } from '@/lib/rfp/compare/diff'

export interface ComparePanelProps {
  rows: ComparisonRow[]
  onOpenEvidence?: (blockId: string) => void
}

export default function ComparePanel({ rows, onOpenEvidence }: ComparePanelProps) {
  if (rows.length === 0) {
    return <EmptyState title={RFP_LIST.emptySearchTitle} description={RFP_REPORT.comparisons} />
  }

  return (
    <div>
      {rows.map((r) => (
        <section key={r.caseId} className="card">
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
            <a href={`/rfp/${r.caseId}`} style={{ fontWeight: 600 }}>{r.title}</a>
            <NbBadge status="note">{Math.round(r.similarity * 100)}</NbBadge>
          </div>
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>{r.summary}</p>

          {r.axes.map((a) => (
            <div key={a.axis} style={{ marginTop: 'var(--space-2)' }}>
              <span className="label">{AXIS_LABEL[a.axis]}</span>
              <p>
                <span>{show(a.mine.value)}</span>
                <span style={{ color: 'var(--text-faint)' }}> {show(a.theirs.value)}</span>
                {a.ratio !== null && a.ratio !== 1 && <NbBadge status="doing">{a.ratio}</NbBadge>}
              </p>
              {a.onlyTheirs.length > 0 && (
                <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
                  {a.onlyTheirs.join(', ')}
                </p>
              )}
              {/* 양쪽 근거를 함께 — 없으면 문장을 믿거나 반박할 수 없다 */}
              {a.mine.evidence.slice(0, 1).map((e, i) => (
                <RfpEvidenceLink key={`m-${i}`} evidence={e} onOpen={onOpenEvidence} />
              ))}
              {a.theirs.evidence.slice(0, 1).map((e, i) => (
                <RfpEvidenceLink key={`t-${i}`} evidence={e} onOpen={onOpenEvidence} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

function show(v: unknown): string {
  if (v === null || v === undefined) return RFP_REPORT.noValue
  if (typeof v === 'number') return v.toLocaleString()
  if (Array.isArray(v)) return String(v.length)
  return String(v)
}
