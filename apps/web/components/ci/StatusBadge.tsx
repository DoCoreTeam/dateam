// components/ci/StatusBadge.tsx — 상태 배지 (설계서 §6.5)
// 4계열만 존재한다: 수집 상태 · 신뢰도 · 비교 가능성 · 수집 완전도.
// 화면마다 색맵을 복붙하지 않는다.

import type { CiComparability, CiConfidence, CiIngestStatus } from '@/lib/ci/types'
import { CI_INGEST_STATUS_LABEL } from '@/lib/ci/types'
import { formatComparability, formatConfidence, formatMissingFields } from '@/lib/ci/format/metrics'

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
 * 무엇이 안 들어왔는지 알린다. **수집이 끝난 뒤에만** 단다.
 *
 * 예전에는 완전도(0~1)가 임계 미만이면 '일부만 수집됨'을 달았는데, DB 기본값이 0이라
 * **아직 수집을 시작조차 안 한 행**(queued)이 전부 그 배지를 달고 나왔다 —
 * 화면은 "일부만 받았다"고 말하는데 실제로는 "하나도 안 받았다"였다(실측 v0.7.565).
 * 게다가 ingest_status='partial'의 라벨도 같은 '일부만 수집됨'이라 칩이 두 개 겹쳤다.
 *
 * 그래서 축을 나눴다 — **상태는 상태 배지가**, 이 배지는 **빠진 항목 이름만** 말한다.
 */
export function MissingFieldsBadge({
  status, missingFields, onOpenMissing,
}: {
  status: CiIngestStatus
  missingFields?: string[] | null
  onOpenMissing?: () => void
}) {
  // 아직 안 받은 것과 받아 봤더니 없던 것은 다른 사실이다. 전자는 말할 것이 없다.
  if (status !== 'done' && status !== 'partial') return null
  const text = formatMissingFields(missingFields)
  if (!text) return null
  const title = '이 항목은 플랫폼이 주지 않아 확보하지 못했습니다'
  if (!onOpenMissing) return <Badge tone="warn" title={title}>{text}</Badge>
  return (
    <button type="button" className={TONE_CLASS.warn} title={title} onClick={onOpenMissing}>
      {text}
    </button>
  )
}
