'use client'

// app/(ci)/ci/inbox/InboxView.tsx — R01 수집함 뷰
// 목록과 검토 큐를 탭으로 통합한다(설계서 §5.4 R01 비고).

import { useState } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { CiContentListItem } from '@/lib/ci/contracts'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import LinkIntakeBox from '@/components/ci/LinkIntakeBox'
import DetailSheet from '@/components/ci/DetailSheet'
import ChannelGroupedList from '@/components/ci/ChannelGroupedList'
import MetricBadge from '@/components/ci/MetricBadge'
import { CompletenessBadge, IngestStatusBadge } from '@/components/ci/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'

type Tab = 'all' | 'review' | 'failed'

interface InboxViewProps {
  workspaceId: string
  tab: Tab
  items: CiContentListItem[]
  counts: { review: number; failed: number }
  topics: { id: string; name: string }[]
}

const PLATFORMS = ['유튜브', '틱톡', '인스타', '페북', 'X', '스레드']

export default function InboxView({ workspaceId, tab, items, counts, topics }: InboxViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(null)
  const [groupByChannel, setGroupByChannel] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)

  /** 주제 확정 — 사용자가 최종 심판이다. 정정은 학습에 쌓인다. */
  async function confirmTopic(contentId: string, topicId: string | null) {
    setSavingTopic(contentId)
    try {
      await fetch(`/api/ci/contents/${contentId}/topic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ topicId }),
      })
      router.refresh()
    } finally { setSavingTopic(null) }
  }

  function goTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'all') params.delete('tab')
    else params.set('tab', next)
    router.push(`/ci/inbox${params.toString() ? `?${params}` : ''}`, { scroll: false })
  }

  async function retry(id: string) {
    setRetrying(id)
    try {
      await fetch(`/api/ci/contents/${id}/retry`, {
        method: 'POST',
        headers: { 'X-CI-Workspace': workspaceId },
      })
      router.refresh()
    } finally {
      setRetrying(null)
    }
  }

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'all', label: '전체' },
    { id: 'review', label: '검토 필요', count: counts.review },
    { id: 'failed', label: '실패', count: counts.failed },
  ]

  return (
    <>
      <PageHeader
        title="수집함"
        description="링크를 넣으면 자동으로 분석해 분류합니다"
        below={<StageNav stages={RESEARCH_STAGES} />}
      />

      <LinkIntakeBox workspaceId={workspaceId} onDone={() => router.refresh()} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-6) 0 var(--space-4)', flexWrap: 'wrap' }}>
        <SegmentedTabs
          ariaLabel="수집함 분류"
          tabs={TABS.map((t) => ({ id: t.id, label: t.count ? `${t.label} ${t.count}` : t.label }))}
          activeId={tab}
          onSelect={(id) => goTab(id as Tab)}
        />

        {/* 콘텐츠는 채널에 귀속된다. 평평한 목록만으로는 어느 채널이 뭘 올렸는지 안 보인다. */}
        <button
          type="button"
          className="btn-ghost"
          style={{ marginLeft: 'auto' }}
          onClick={() => setGroupByChannel((v) => !v)}
          title="채널별로 묶어 어느 채널의 게시물인지 한눈에 봅니다"
        >
          {groupByChannel ? '표로 보기' : '채널별로 묶기'}
        </button>
      </div>

      {items.length === 0 ? (
        tab === 'all' ? (
          <EmptyState
            title="아직 담은 링크가 없습니다"
            description={`${PLATFORMS.join(', ')} 링크를 붙여넣어 보세요. 붙여넣는 즉시 수집이 시작됩니다.`}
            secondary={<p className="ci-basis">{PLATFORMS.join(' · ')}</p>}
          />
        ) : tab === 'review' ? (
          <EmptyState
            title="검토할 항목이 없습니다"
            description="분류가 애매한 항목만 여기로 옵니다. 지금은 전부 자동으로 확정되었습니다."
            action={{ label: '전체 보기', href: '/ci/inbox' }}
          />
        ) : (
          <EmptyState
            title="실패한 수집이 없습니다"
            description="수집에 실패한 링크는 원인과 함께 여기 모입니다."
            action={{ label: '전체 보기', href: '/ci/inbox' }}
          />
        )
      ) : groupByChannel ? (
        <ChannelGroupedList
          items={items}
          onOpen={setOpenId}
          onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
        />
      ) : (
        <table className="table-base table-card ci-inbox-table">
          <thead>
            <tr>
              <th aria-label="썸네일" />
              <th>콘텐츠</th>
              <th>상태</th>
              <th>주제</th>
              <th>평소 대비</th>
              <th aria-label="작업" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {/* 썸네일 — 목록에서 무엇인지 알아보는 가장 빠른 단서다 */}
                <td className="ci-row-thumb-cell">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ci-row-thumb" src={item.thumbnailUrl} alt="" loading="lazy"
                      width={96} height={54} />
                  ) : (
                    <div className="ci-row-thumb ci-thumb-empty" aria-hidden />
                  )}
                </td>

                {/* 제목 + 채널·플랫폼·날짜를 한 셀에 모은다.
                    컬럼을 9개로 벌리면 데스크탑에서도 셀이 짓눌려 버튼이 줄바꿈된다. */}
                <td className="card-header">
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    style={{ all: 'unset', cursor: 'pointer', fontWeight: 600, display: 'block' }}
                  >
                    {item.title ?? item.canonicalUrl}
                  </button>
                  <span className="ci-card-meta" style={{ marginTop: '2px' }}>
                    {item.channelId ? (
                      <Link href={`/ci/channels/${item.channelId}`} style={{ color: 'var(--text-muted)' }}>
                        {item.channelName ?? '채널 미확인'}
                      </Link>
                    ) : (
                      <span>채널 미확인</span>
                    )}
                    <span>{CI_PLATFORM_LABEL[item.platform]}</span>
                    <span className="ci-num">{item.firstSeenAt.slice(0, 10)}</span>
                  </span>
                </td>

                <td data-label="상태" className="ci-nowrap">
                  <IngestStatusBadge status={item.ingestStatus} />
                  <CompletenessBadge
                    completeness={item.completeness}
                    missingFields={item.missingFields}
                  />
                </td>

                <td data-label="주제">
                  {tab === 'review' ? (
                    <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="label" htmlFor={`t-${item.id}`} style={{ position: 'absolute', left: '-9999px' }}>주제</label>
                      <select className="input-field" id={`t-${item.id}`} style={{ width: 'auto' }}
                        defaultValue={item.topic?.id ?? ''}
                        disabled={savingTopic === item.id}
                        onChange={(e) => confirmTopic(item.id, e.target.value || null)}>
                        <option value="">미분류</option>
                        {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      {item.topicConfidence != null && item.topicConfidence > 0 && (
                        <span className="ci-basis ci-num">AI {Math.round(item.topicConfidence * 100)}%</span>
                      )}
                    </div>
                  ) : (item.topic?.name ?? '미분류')}
                </td>

                <td data-label="평소 대비" className="ci-nowrap">
                  <MetricBadge text={item.outlierText} />
                  {!item.outlierText && (
                    <span className="ci-basis" title="같은 채널·포맷 비교 이력이 8개 미만입니다">—</span>
                  )}
                </td>

                <td className="card-actions ci-nowrap">
                  {(item.ingestStatus === 'failed' || item.ingestStatus === 'partial') && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => retry(item.id)}
                      disabled={retrying === item.id}
                    >
                      {retrying === item.id ? '재시도 중…' : '재시도'}
                    </button>
                  )}
                  <Link href={item.canonicalUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                    원본
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DetailSheet
        contentId={openId}
        workspaceId={workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />
    </>
  )
}
