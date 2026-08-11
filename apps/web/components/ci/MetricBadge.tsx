'use client'

// components/ci/MetricBadge.tsx — 문장형 지표 전용 배지 (설계서 §6.5)
// 값이 없으면 렌더하지 않는다. 표시 여부 판정은 lib/ci/format/metrics.ts가 이미 했다.
// 탭하면 산출 근거 시트를 연다 — 사용자는 지표 이름을 배우지 않아도 되지만,
// 궁금하면 탭 한 번으로 포함 표본과 제외 사유까지 볼 수 있어야 한다(§4.3).

interface MetricBadgeProps {
  /** 이미 문장으로 완성된 텍스트. null이면 렌더하지 않는다. */
  text: string | null
  strong?: boolean
  /** 산출 근거 시트를 열 수 있으면 전달 */
  onOpenEvidence?: () => void
}

export default function MetricBadge({ text, strong, onOpenEvidence }: MetricBadgeProps) {
  if (!text) return null
  const className = `ci-metric ci-num${strong ? ' ci-metric-strong' : ''}`

  if (!onOpenEvidence) {
    return <span className={className}>{text}</span>
  }
  return (
    <button type="button" className={className} onClick={onOpenEvidence} title="산출 근거 보기">
      {text}
    </button>
  )
}

/** 값이 없을 때 자리를 비워두되 이유를 알려주는 표시. 표(table) 셀에서 쓴다. */
export function MetricPlaceholder({ reason }: { reason: string }) {
  return <span className="ci-num" style={{ color: 'var(--text-faint)' }} title={reason}>—</span>
}

/** 수치에 항상 병기하는 기준 (기간 창·표본 수) — §6.6 정상 상태 규칙 */
export function MetricBasis({ text }: { text: string }) {
  return <span className="ci-basis">{text}</span>
}
