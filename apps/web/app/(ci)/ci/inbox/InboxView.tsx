'use client'

// app/(ci)/ci/inbox/InboxView.tsx — R01 수집함 뷰
// 목록과 검토 큐를 탭으로 통합한다(설계서 §5.4 R01 비고).
//
// 목록 표준(§2-6): 표는 ListSurface가 그린다(화면이 <table>을 짜지 않는다).
// 탭·채널묶기 같은 보기 조건은 URL이 진실이다 — 링크를 공유하면 같은 화면이 열린다.

import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
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
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'

type Tab = 'all' | 'review' | 'failed'

interface InboxViewProps {
  workspaceId: string
  tab: Tab
  items: CiContentListItem[]
  counts: { review: number; failed: number }
  topics: { id: string; name: string }[]
}

const PLATFORMS = ['유튜브', '틱톡', '인스타', '페북', 'X', '스레드']

// 수집함은 서버가 최신순 한 묶음을 내려준다 — 화면이 정렬·페이지를 다시 정하지 않는다.
// tab·group을 필터 화이트리스트에 두어야 보기 전환이 탭을 지우지 않는다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'recent', dir: 'desc' },
  view: 'table',
  filterKeys: ['tab', 'group'],
}

/** 탭마다 "없다"의 뜻이 다르다 — 다음 행동도 다르다 */
const EMPTY: Record<Tab, { title: string; description: string; action?: { label: string; href: string } }> = {
  all: {
    title: '아직 담은 링크가 없습니다',
    description: `${PLATFORMS.join(', ')} 링크를 붙여넣어 보세요. 붙여넣는 즉시 수집이 시작됩니다.`,
  },
  review: {
    title: '검토할 항목이 없습니다',
    description: '분류가 애매한 항목만 여기로 옵니다. 지금은 전부 자동으로 확정되었습니다.',
    action: { label: '전체 보기', href: '/ci/inbox' },
  },
  failed: {
    title: '실패한 수집이 없습니다',
    description: '수집에 실패한 링크는 원인과 함께 여기 모입니다.',
    action: { label: '전체 보기', href: '/ci/inbox' },
  },
}

export default function InboxView({ workspaceId, tab, items, counts, topics }: InboxViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)

  const grouped = query.filters.group === '1'

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

  // 컬럼은 한 벌만 선언한다 — 표와 카드를 같은 정의로 그린다(§2-6).
  const columns: ColumnDef<CiContentListItem>[] = [
    {
      key: 'thumb', header: '썸네일', width: '104px', noLabel: true,
      // 썸네일 — 목록에서 무엇인지 알아보는 가장 빠른 단서다
      cell: (item) => (item.thumbnailUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className="ci-row-thumb" src={item.thumbnailUrl} alt="" loading="lazy" width={96} height={54} />
        : <span className="ci-row-thumb ci-thumb-empty" aria-hidden />),
    },
    {
      // 제목 + 채널·플랫폼·날짜를 한 셀에 모은다.
      // 컬럼을 9개로 벌리면 데스크탑에서도 셀이 짓눌려 버튼이 줄바꿈된다.
      key: 'content', header: '콘텐츠', primary: true, width: '100%',
      cell: (item) => (
        <>
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
        </>
      ),
    },
    {
      key: 'status', header: '상태',
      cell: (item) => (
        <span className="ci-nowrap">
          <IngestStatusBadge status={item.ingestStatus} />
          <CompletenessBadge completeness={item.completeness} missingFields={item.missingFields} />
        </span>
      ),
    },
    {
      key: 'topic', header: '주제',
      cell: (item) => (tab === 'review' ? (
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center', flexWrap: 'wrap' }}>
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
        </span>
      ) : (item.topic?.name ?? '미분류')),
    },
    {
      key: 'outlier', header: '평소 대비',
      cell: (item) => (
        <span className="ci-nowrap">
          <MetricBadge text={item.outlierText} />
          {!item.outlierText && (
            <span className="ci-basis" title="같은 채널·포맷 비교 이력이 8개 미만입니다">—</span>
          )}
        </span>
      ),
    },
    {
      key: 'actions', header: '작업',
      cell: (item) => (
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
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
        </span>
      ),
    },
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
          onClick={() => set({ filters: { group: grouped ? '' : '1' } })}
          title="채널별로 묶어 어느 채널의 게시물인지 한눈에 봅니다"
        >
          {grouped ? '표로 보기' : '채널별로 묶기'}
        </button>
      </div>

      {grouped && items.length > 0 ? (
        <ChannelGroupedList
          items={items}
          onOpen={setOpenId}
          onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
        />
      ) : (
        <ListSurface
          rows={items}
          columns={columns}
          query={query}
          rowKey={(item) => item.id}
          empty={EMPTY[tab]}
        />
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
