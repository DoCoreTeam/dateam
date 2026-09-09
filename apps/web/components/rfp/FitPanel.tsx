'use client'

// 적합도 판정 카드 — 판정과 점수와 요건 표와 갭.
//
// 「부적합」만 보여 주면 사용자가 할 일이 없다. **무엇을 채우면 판정이 바뀌는지**가
// 같은 화면에 있어야 한다.

import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import { RFP_PROFILE, FIT_VERDICT_LABEL, REQUIREMENT_RESULT_LABEL, type FitVerdict, type RequirementResult } from '@/lib/rfp/terms'
import type { StatusKey } from '@/lib/tokens/status-colors'

const VERDICT_STATUS: Record<FitVerdict, StatusKey> = {
  full: 'done', partial: 'doing', unfit: 'blocker',
}

const RESULT_STATUS: Record<RequirementResult, StatusKey> = {
  met: 'done', unmet: 'blocker', unknown: 'note',
}

export interface FitCheck {
  text: string
  result: RequirementResult
  profileBasis: string | null
  coverableByPartner: boolean
}

export interface FitPanelProps {
  verdict: FitVerdict | null
  score: number
  conditional: boolean
  checks: FitCheck[]
  gaps: string[]
  recommendedRole: string | null
}

export default function FitPanel({ verdict, score, conditional, checks, gaps, recommendedRole }: FitPanelProps) {
  if (!verdict) return <EmptyState title={RFP_PROFILE.fitTitle} />

  return (
    <section className="card">
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
        <span className="label">{RFP_PROFILE.fitTitle}</span>
        <NbBadge status={VERDICT_STATUS[verdict]}>{FIT_VERDICT_LABEL[verdict]}</NbBadge>
        {/* 못 읽은 요건이 있으면 사람이 봐야 한다 */}
        {conditional && <NbBadge status="doing">{RFP_PROFILE.fitConditional}</NbBadge>}
      </div>

      <p style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{score}</p>
      {recommendedRole && (
        <p><span className="label">{RFP_PROFILE.recommendedRole}</span> {recommendedRole}</p>
      )}

      <span className="label">{RFP_PROFILE.hardChecks}</span>
      <ul>
        {checks.map((c, i) => (
          <li key={`${c.text}-${i}`}>
            <NbBadge status={RESULT_STATUS[c.result]}>{REQUIREMENT_RESULT_LABEL[c.result]}</NbBadge>
            <span> {c.text}</span>
            {c.profileBasis && (
              <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}> {c.profileBasis}</span>
            )}
          </li>
        ))}
      </ul>

      {gaps.length > 0 && (
        <>
          {/* 무엇을 채우면 판정이 바뀌는지 */}
          <span className="label">{RFP_PROFILE.gaps}</span>
          <ul>{gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </>
      )}
    </section>
  )
}
