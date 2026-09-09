'use client'

// 리포트 값 한 줄 — 값과 그 무게를 함께 그린다.
//
// ## 값 하나에 카드 하나를 주지 않는다
//
// 예전에는 값마다 카드였다. 예산 절 하나가 세로로 일곱 장이 되고, 화면을 훑어도
// 「예산이 얼마지」가 안 보인다(실측 2026-09-09). 절이 카드고 값은 그 안의 한 줄이다 —
// 그래야 눈이 절 단위로 움직인다.
//
// ## 확인 안 된 값은 흐리게
//
// 값만 또렷하게 그리면 화면이 그것을 **사실처럼** 보이게 한다.
// 근거가 확인 안 됐거나 신뢰도가 낮으면 눈에 보이게 강등해야
// 사용자가 「이건 확인해야겠다」를 안다.

import NbBadge from '@/components/ui/nb/NbBadge'
import NbButton from '@/components/ui/nb/NbButton'
import RfpEvidenceLink from './RfpEvidenceLink'
import {
  RFP_REPORT, RFP_COMMON, VERIFICATION_LABEL, GROUNDING_LABEL, type Verification,
} from '@/lib/rfp/terms'
import { fieldLabel, fieldUnit } from '@/lib/rfp/report/field-labels'
import { formatValue } from '@/lib/rfp/report/format-value'
import type { ValueNode } from '@/lib/rfp/report/schema'
import type { StatusKey } from '@/lib/tokens/status-colors'
import styles from '@/app/(rfp)/rfp.module.css'

/** 이 아래면 낮은 신뢰도로 본다 */
export const LOW_CONFIDENCE = 0.6

const VERIFICATION_STATUS: Record<Verification, StatusKey> = {
  single: 'note', agreed: 'done', majority: 'doing', conflict: 'blocker', user_fixed: 'done',
}

export interface ReportCardProps {
  /** 리포트 칸의 키. 이름표는 SSOT 가 붙인다 — 화면이 키를 그대로 찍으면 영문이 노출된다 */
  fieldKey: string
  node: ValueNode<unknown>
  /** 보고용이면 근거와 벤더를 안 그린다 */
  mode: 'work' | 'report'
  onOpenEvidence?: (blockId: string) => void
  onCrossVerify?: () => void
}

export default function ReportCard({
  fieldKey, node, mode, onOpenEvidence, onCrossVerify,
}: ReportCardProps) {
  const low = node.confidence !== null && node.confidence < LOW_CONFIDENCE
  const unconfirmed = node.grounding === 'unconfirmed'
  const dim = low || unconfirmed

  return (
    <div className={styles.valueRow}>
      <span className={styles.valueName}>{fieldLabel(fieldKey)}</span>

      <div className={styles.valueBody}>
        <span className={dim ? `${styles.valueText} ${styles.valueDim}` : styles.valueText}>
          {formatValue(node.value)}
          {/* 단위 없는 숫자는 「1.5」로만 남아 무슨 뜻인지 모른다 */}
          {fieldUnit(fieldKey) && typeof node.value === 'number' && (
            <span className={styles.valueName}> {fieldUnit(fieldKey)}</span>
          )}
        </span>

        {mode === 'work' && (
          <>
            <div className={styles.valueMeta}>
              {unconfirmed && <NbBadge status="blocker">{GROUNDING_LABEL.unconfirmed}</NbBadge>}
              {node.verification !== 'single' && (
                <NbBadge status={VERIFICATION_STATUS[node.verification]}>
                  {VERIFICATION_LABEL[node.verification]}
                </NbBadge>
              )}
              {onCrossVerify && (
                <NbButton variant="ghost" onClick={onCrossVerify}>{RFP_REPORT.crossVerify}</NbButton>
              )}
            </div>

            {/* 근거는 접어 둔다 — 펼치지 않으면 값 하나가 화면 반쪽을 먹는다 */}
            {node.evidence.length > 0 && (
              <details className={styles.evidence}>
                <summary>
                  {RFP_REPORT.evidence} {node.evidence.length}
                  {node.vendor ? ` · ${node.vendor}` : ''}
                </summary>
                <div className={styles.evidenceBody}>
                  {node.evidence.map((e, i) => (
                    <RfpEvidenceLink key={`${e.blockId}-${i}`} evidence={e} onOpen={onOpenEvidence} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export { formatValue }
