// components/ci/StatusBadge.tsx — 상태 배지 (설계서 §6.5)
// 4계열만 존재한다: 수집 상태 · 신뢰도 · 비교 가능성 · 수집 완전도.
// 화면마다 색맵을 복붙하지 않는다.

import type { CiComparability, CiConfidence, CiIngestStatus } from '@/lib/ci/types'
import { CI_INGEST_STATUS_LABEL } from '@/lib/ci/types'
import { formatComparability, formatConfidence, formatCompleteness } from '@/lib/ci/format/metrics'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  ok: 'ci-status ci-status-ok',
  warn: 'ci-status ci-status-warn',
  danger: 'ci-status ci-status-danger',
  info: 'ci-status ci-status-info',
  neutral: 'ci-status ci-status-neutral',
}

function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return <span className={TONE_CLASS[tone]} title={title}>{children}</span>
}

const INGEST_TONE: Record<CiIngestStatus, Tone> = {
  queued: 'neutral', running: 'info', done: 'ok', partial: 'warn', failed: 'danger',
}

export function IngestStatusBadge({ status }: { status: CiIngestStatus }) {
  return <Badge tone={INGEST_TONE[status]}>{CI_INGEST_STATUS_LABEL[status]}</Badge>
}

const CONFIDENCE_TONE: Record<CiConfidence, Tone> = {
  high: 'ok', medium: 'warn', insufficient: 'neutral',
}

export function ConfidenceBadge({ confidence }: { confidence: CiConfidence }) {
  return <Badge tone={CONFIDENCE_TONE[confidence]}>{formatConfidence(confidence)}</Badge>
}

export function ComparabilityBadge({ cls }: { cls: CiComparability | null }) {
  const tone: Tone = cls === 'A' ? 'info' : cls === 'B' ? 'warn' : 'neutral'
  return (
    <Badge tone={tone} title="플랫폼마다 지표 정의가 달라 비교 범위를 표시합니다">
      {formatComparability(cls)}
    </Badge>
  )
}

/**
 * 완전도는 임계 미만일 때만 배지를 단다.
 * 정상 데이터에 '완료' 배지를 붙여 화면을 시끄럽게 만들지 않는다.
 */
export function CompletenessBadge({
  completeness, missingFields, onOpenMissing,
}: {
  completeness: number | null
  missingFields?: string[]
  onOpenMissing?: () => void
}) {
  const text = formatCompleteness(completeness)
  if (!text) return null
  const title = missingFields?.length ? `미확보: ${missingFields.join(', ')}` : undefined
  if (!onOpenMissing) return <Badge tone="warn" title={title}>{text}</Badge>
  return (
    <button type="button" className={TONE_CLASS.warn} title={title} onClick={onOpenMissing}>
      {text}
    </button>
  )
}
