'use client'

// 통합 입력 §05 — 추출 결과 신뢰도 자동 게이트(3구간 요약) + 통합 표
//   분석 완료 후 공급원가/시장가 항목을 하나의 표로 보여주고,
//   공급원가는 lib/gpu/confidence-gate(partitionByConfidence)로 3구간(자동/검토/차단) 분류.
//   쓰기는 하지 않는다(표시 전용) — 확정은 부모의 기존 commit 핸들러가 수행.

import {
  partitionByConfidence,
  classifyConfidence,
  bandLabel,
  type ConfidenceBand,
} from '@/lib/gpu/confidence-gate'
import { fmtUSD } from '@/lib/gpu/format-price'

// 표의 한 행(공급원가 또는 시장가)
export interface GateRow {
  kind: 'supply' | 'market'
  model: string
  party: string          // 공급사 또는 경쟁사
  priceUsd: number | null
  confidence: number | null   // 공급원가: overall_confidence / 시장가: null(시장가는 게이트 비대상)
  /** 요금 등급(시장가 전용) — on_demand|spot|reserved. 같은 모델이 등급별로 여러 줄 나오므로 화면에 반드시 구분 표기.
   *  (실사고 v0.7.365: spot 가격이 on_demand와 나란히 떠서 같은 모델 중복으로 보였다) */
  priceTier?: string | null
  /** 스펙(폼팩터·메모리) — 모델명에 붙이지 않는다. 모델·폼팩터·메모리는 각각 별개 축이고 DB도 컬럼이 나뉘어 있다.
   *  (실사고 v0.7.365: "A100 SXM 40GB"처럼 세 축이 한 문자열로 뭉쳐 보여 카탈로그 정합성이 깨져 보였다) */
  spec?: string | null
}

const BAND_BADGE: Record<ConfidenceBand, string> = {
  auto: 'gpu-gate-badge--auto',
  review: 'gpu-gate-badge--review',
  block: 'gpu-gate-badge--block',
}

// USD 표시 SSOT 위임(format-price). 로컬 toFixed(2) 중복 제거 — ceil 3자리 정책 일관.
const fmtUsd = (v: number | null): string => fmtUSD(v)

interface IntakeGateSummaryProps {
  rows: GateRow[]
}

export default function IntakeGateSummary({ rows }: IntakeGateSummaryProps) {
  // 공급원가만 신뢰도 게이트 대상. 신뢰도 없는 행은 0으로 클램프되어 block.
  const supplyRows = rows.filter((r) => r.kind === 'supply')
  const partition = partitionByConfidence(
    supplyRows.map((r) => ({ confidence: r.confidence ?? 0 })),
  )

  return (
    <div className="gpu-gate" data-testid="intake-gate">
      {/* 3구간 요약 카드 */}
      <div className="gpu-gate-cards">
        <div className="gpu-gate-card gpu-gate-card--auto">
          <div className="gpu-gate-card-label">
            자동 확정 <span className="gpu-gate-badge gpu-gate-badge--auto">≥90%</span>
          </div>
          <div className="gpu-gate-card-num">{partition.auto.length}건</div>
        </div>
        <div className="gpu-gate-card gpu-gate-card--review">
          <div className="gpu-gate-card-label">
            검토 <span className="gpu-gate-badge gpu-gate-badge--review">70–90%</span>
          </div>
          <div className="gpu-gate-card-num">{partition.review.length}건</div>
        </div>
        <div className="gpu-gate-card gpu-gate-card--block">
          <div className="gpu-gate-card-label">
            보류 <span className="gpu-gate-badge gpu-gate-badge--block">&lt;70%</span>
          </div>
          <div className="gpu-gate-card-num">{partition.block.length}건</div>
        </div>
      </div>

      {/* 통합 표: 분류 | 모델 | 공급사/경쟁사 | 단가 | 신뢰도 | 처리 */}
      <table className="gpu-gate-tbl" data-testid="intake-gate-table">
        <thead>
          <tr>
            <th>분류</th>
            <th>모델</th>
            <th>스펙</th>
            <th>공급사/경쟁사</th>
            <th>단가</th>
            <th>신뢰도</th>
            <th>처리</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isSupply = r.kind === 'supply'
            const band = isSupply ? classifyConfidence(r.confidence ?? 0) : null
            const modelMissing = !r.model
            return (
              <tr key={i}>
                <td>
                  <span className={`gpu-badge ${isSupply ? 'gpu-badge-amber' : 'gpu-badge-t2'}`}>
                    {isSupply ? '공급원가' : '시장가'}
                  </span>
                </td>
                <td className={modelMissing ? 'gpu-gate-cell-missing' : undefined}>
                  {r.model || '(모델 미상)'}
                  {r.priceTier && r.priceTier !== 'on_demand' ? (
                    <span className={`gpu-badge ${r.priceTier === 'spot' ? 'gpu-badge-gray' : 'gpu-badge-t2'}`} style={{ marginLeft: 'var(--space-2)' }}>
                      {r.priceTier === 'spot' ? 'Spot' : '약정'}
                    </span>
                  ) : null}
                </td>
                <td className="gpu-gate-cell-spec">{r.spec || '—'}</td>
                <td>{r.party || '—'}</td>
                <td className="gpu-gate-cell-price">{fmtUsd(r.priceUsd)}</td>
                <td>
                  {isSupply && r.confidence != null ? (
                    <span className={`gpu-gate-badge ${BAND_BADGE[band!]}`}>{r.confidence}%</span>
                  ) : isSupply ? (
                    <span className="gpu-gate-badge gpu-gate-badge--block">미상</span>
                  ) : (
                    // 시장가는 신뢰도 게이트 비대상 — 중립 표기(자동확정 오독 방지, §5-3)
                    <span className="gpu-badge gpu-badge-gray">게이트 외</span>
                  )}
                </td>
                <td className="gpu-gate-cell-action">
                  {isSupply ? bandLabel(band!) : '시장 반영'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
