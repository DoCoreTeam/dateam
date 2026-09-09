'use client'

// 리포트 항목 카드 — 값 하나와 그 무게를 함께 그린다.
//
// 값만 크게 그리면 화면이 그것을 **사실처럼** 보이게 한다.
// 근거가 확인 안 됐거나 신뢰도가 낮으면 눈에 보이게 강등해야
// 사용자가 「이건 확인해야겠다」를 안다.

import NbBadge from '@/components/ui/nb/NbBadge'
import NbButton from '@/components/ui/nb/NbButton'
import RfpEvidenceLink from './RfpEvidenceLink'
import {
  RFP_REPORT, RFP_COMMON, VERIFICATION_LABEL, GROUNDING_LABEL, type Verification,
} from '@/lib/rfp/terms'
import type { ValueNode } from '@/lib/rfp/report/schema'
import type { StatusKey } from '@/lib/tokens/status-colors'

/** 이 아래면 낮은 신뢰도로 본다 */
export const LOW_CONFIDENCE = 0.6

const VERIFICATION_STATUS: Record<Verification, StatusKey> = {
  single: 'note', agreed: 'done', majority: 'doing', conflict: 'blocker', user_fixed: 'done',
}

export interface ReportCardProps {
  title: string
  node: ValueNode<unknown>
  /** 보고용이면 근거와 벤더를 안 그린다 */
  mode: 'work' | 'report'
  onOpenEvidence?: (blockId: string) => void
  onCrossVerify?: () => void
}

export default function ReportCard({ title, node, mode, onOpenEvidence, onCrossVerify }: ReportCardProps) {
  const low = node.confidence !== null && node.confidence < LOW_CONFIDENCE
  const unconfirmed = node.grounding === 'unconfirmed'
  // 값이 흐릿해야 「확인이 필요하다」가 눈에 들어온다
  const dim = low || unconfirmed

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span className="label">{title}</span>
        {mode === 'work' && node.verification !== 'single' && (
          <NbBadge status={VERIFICATION_STATUS[node.verification]}>
            {VERIFICATION_LABEL[node.verification]}
          </NbBadge>
        )}
      </div>

      <p style={{
        fontSize: 'var(--fs-lg)',
        fontWeight: 600,
        color: dim ? 'var(--text-faint)' : 'var(--text)',
      }}>
        {formatValue(node.value)}
      </p>

      {mode === 'work' && (
        <>
          {unconfirmed && (
            <NbBadge status="blocker">{GROUNDING_LABEL.unconfirmed}</NbBadge>
          )}
          {node.vendor && (
            <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>{node.vendor}</p>
          )}
          {node.evidence.map((e, i) => (
            <RfpEvidenceLink key={`${e.blockId}-${i}`} evidence={e} onOpen={onOpenEvidence} />
          ))}
          {onCrossVerify && (
            <NbButton variant="ghost" onClick={onCrossVerify}>{RFP_REPORT.crossVerify}</NbButton>
          )}
        </>
      )}
    </div>
  )
}

/** 값 종류마다 사람이 읽는 모양으로 */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return RFP_REPORT.noValue
  if (typeof v === 'boolean') return v ? RFP_COMMON.yes : RFP_COMMON.no
  if (typeof v === 'number') return v.toLocaleString()
  if (Array.isArray(v)) return v.map((x) => nameOf(x)).filter(Boolean).join(', ')
  if (typeof v === 'object') return nameOf(v)
  return String(v)
}

function nameOf(v: unknown): string {
  if (typeof v === 'string') return v
  const o = v as { name?: unknown; title?: unknown; code?: unknown }
  return String(o?.name ?? o?.title ?? o?.code ?? '')
}
