'use client'

// components/ci/ContentCard.tsx — 콘텐츠 카드 (설계서 §6.5)
// 썸네일 16:9, 제목 2줄 말줄임, 평소 대비 배수 배지, 플랫폼 아이콘,
// 우측 하단에 "다음 단계" 버튼과 "보드 담기".
//
// "다음 단계" 버튼은 1depth 나열을 흐름으로 바꾸는 핵심 장치다(§5.3).
// 카드마다 상황별 다음 행동 1개를 고정 노출한다.

import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import MetricBadge from './MetricBadge'
import CreativeSummary from './CreativeSummary'
import { ComparabilityBadge, MissingFieldsBadge, IngestStatusBadge } from './StatusBadge'
import type { CiContentListItem } from '@/lib/ci/contracts'

interface ContentCardProps {
  item: CiContentListItem
  onOpen?: (id: string) => void
  onNextStep?: (id: string) => void
  onAddToBoard?: (id: string) => void
  /** 수집함에서는 수집 상태를, 트렌드에서는 지표를 앞세운다 */
  showIngestStatus?: boolean
}

export default function ContentCard({
  item, onOpen, onNextStep, onAddToBoard, showIngestStatus,
}: ContentCardProps) {
  return (
    <article className="ci-content-card">
      <button
        type="button"
        onClick={() => onOpen?.(item.id)}
        style={{ all: 'unset', cursor: onOpen ? 'pointer' : 'default', display: 'block' }}
        aria-label={`${item.title ?? '제목 없음'} 상세 열기`}
      >
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ci-thumb" src={item.thumbnailUrl} alt="" loading="lazy" width={320} height={180} />
        ) : (
          <div className="ci-thumb ci-thumb-empty">썸네일 없음</div>
        )}
      </button>

      <div className="ci-card-body">
        <h3 className="ci-card-title">{item.title ?? '제목 없음'}</h3>

        <div className="ci-card-meta">
          <span>{CI_PLATFORM_LABEL[item.platform]}</span>
          {item.channelName && <span>{item.channelName}</span>}
          {item.publishedAtText && <span>{item.publishedAtText}</span>}
        </div>

        <div className="ci-card-badges">
          {showIngestStatus && <IngestStatusBadge status={item.ingestStatus} />}
          <MetricBadge text={item.outlierText} strong />
          <MetricBadge text={item.percentileText} />
          {!showIngestStatus && <ComparabilityBadge cls={item.comparability} />}
          <MissingFieldsBadge status={item.ingestStatus} missingFields={item.missingFields} />
        </div>

        {/* 배수만 보여주면 "그래서 뭘 따라 하지?"가 남는다. 통한 요소를 카드에서 바로 보여준다. */}
        <CreativeSummary creative={item.creative} variant="compact" />

        <div className="ci-card-actions">
          {onNextStep && (
            <button type="button" className="btn-primary" onClick={() => onNextStep(item.id)}>
              아이디어 만들기
            </button>
          )}
          {onAddToBoard && (
            <button type="button" className="btn-ghost" onClick={() => onAddToBoard(item.id)}>
              보드 담기
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
