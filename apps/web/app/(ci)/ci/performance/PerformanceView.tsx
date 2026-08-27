'use client'

// app/(ci)/ci/performance/PerformanceView.tsx — A01 성과
//
// 표를 화면에서 직접 짜지 않는다(§2-6). 내 콘텐츠·시장 대비 둘 다 ListSurface가 그리고,
// 검색·정렬·보기·페이지는 URL이 진실이라 새로고침·공유가 그대로 성립한다.
// 탭 이동은 기존 동작(push) 그대로 두되, 탭을 바꾸면 목록 조건은 리셋한다
// — 내 콘텐츠 정렬 키를 시장 대비 탭이 이어받으면 안 맞는 열로 정렬된 것처럼 보인다.

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import { ConfidenceBadge } from '@/components/ci/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import { InsufficientData } from '@/components/ci/states'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults } from '@/lib/ui/list-query'
import type { MinePerf, MarketPerf, LearningPerf } from '@/lib/ci/queries/performance'

const TABS = [
  { id: 'mine', label: '내 콘텐츠' },
  { id: 'market', label: '시장 대비' },
  { id: 'learning', label: '학습' },
] as const

type MineRow = MinePerf['rows'][number]
type PeerRow = MarketPerf['topPeers'][number]

// tab을 필터 키로 선언해야 목록 파라미터를 다시 쓸 때 ?tab=이 URL에서 사라지지 않는다
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'published', dir: 'desc' },
  view: 'table',
  filterKeys: ['tab'],
}

const MINE_SORTS = [
  { key: 'published', label: '게시일' },
  { key: 'title', label: '제목' },
  { key: 'views', label: '조회수' },
  { key: 'outlier', label: '평소 대비' },
]

const MINE_COLUMNS: ColumnDef<MineRow>[] = [
  {
    key: 'title', header: '제목', primary: true, sortable: 'title',
    cell: (r) => <strong>{r.title ?? '제목 없음'}</strong>,
  },
  { key: 'platform', header: '플랫폼', cell: (r) => CI_PLATFORM_LABEL[r.platform] },
  {
    key: 'published', header: '게시일', sortable: true,
    cell: (r) => r.publishedAtText ?? <span className="ci-basis">미확인</span>,
  },
  {
    key: 'views', header: '조회수', align: 'right', sortable: true,
    cell: (r) => (r.views != null
      ? <span className="ci-num">{r.views.toLocaleString('ko-KR')}</span>
      : <span className="ci-basis">—</span>),
  },
  {
    key: 'outlier', header: '평소 대비', sortable: true,
    cell: (r) => r.outlierText ?? <span className="ci-basis" title="비교 이력이 8개 미만입니다">—</span>,
  },
  {
    key: 'percentile', header: '상위', hideOnCard: true,
    cell: (r) => r.percentileText ?? <span className="ci-basis">—</span>,
  },
  { key: 'confidence', header: '신뢰도', cell: (r) => <ConfidenceBadge confidence={r.confidence} /> },
]

const PEER_COLUMNS: ColumnDef<PeerRow>[] = [
  { key: 'title', header: '콘텐츠', primary: true, cell: (p) => p.title ?? '제목 없음' },
  { key: 'outlier', header: '평소 대비', cell: (p) => p.outlierText ?? '—' },
]

/** 표시 순서를 한 곳에서 정한다 — 표와 카드가 같은 순서를 낸다. */
function mineSortValue(row: MineRow, key: string): number | string {
  if (key === 'views') return row.views ?? -1
  if (key === 'outlier') return row.outlierText ?? ''
  if (key === 'title') return row.title ?? ''
  return row.publishedAtText ?? ''
}

export default function PerformanceView({
  tab, mine, market, learning,
}: {
  tab: string
  mine: MinePerf | null
  market: MarketPerf | null
  learning: LearningPerf | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/ci/performance' })

  function go(id: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', id)
    // 탭이 바뀌면 목록 조건은 새로 시작한다(다른 탭의 정렬 키가 남으면 오해를 부른다)
    for (const k of ['q', 'sort', 'dir', 'page']) p.delete(k)
    router.push(`/ci/performance?${p}`, { scroll: false })
  }

  const mineRows = useMemo(() => {
    const rows = mine?.rows ?? []
    const q = query.q.trim().toLowerCase()
    const filtered = q
      ? rows.filter((r) => (r.title ?? '').toLowerCase().includes(q))
      : rows
    const dir = query.sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = mineSortValue(a, query.sort.key)
      const bv = mineSortValue(b, query.sort.key)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), 'ko') * dir
    })
  }, [mine, query.q, query.sort.key, query.sort.dir])

  const { from, to } = rangeOf(query)

  return (
    <>
      <SegmentedTabs
        ariaLabel="성과 보기"
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeId={tab}
        onSelect={(id) => go(id as typeof tab)}
      />

      {tab === 'mine' && mine && (
        mine.rows.length === 0 ? (
          <EmptyState
            title="아직 추적 중인 내 게시물이 없습니다"
            description="게시에서 주소를 입력하면 그 시점부터 성과가 쌓입니다. 과거 게시물도 주소만 붙여넣으면 소급 추적됩니다."
            action={{ label: '게시로 이동', href: '/ci/publish' }}
          />
        ) : (
          <>
            <section className="card" style={{
              display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap',
              padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
            }}>
              <div><p className="ci-basis">게시</p><p className="ci-metric-big">{mine.summary.published}</p></div>
              <div>
                <p className="ci-basis">평소 대비 중앙값</p>
                <p className="ci-metric-big">{mine.summary.medianOutlier ?? '—'}</p>
              </div>
              <div>
                <p className="ci-basis">최고</p>
                <p className="ci-metric-big">{mine.summary.best ?? '—'}</p>
              </div>
              <div style={{ alignSelf: 'flex-end' }}><span className="ci-basis">{mine.basisText}</span></div>
            </section>

            <ListToolbar
              query={query}
              onChange={set}
              searchPlaceholder="제목으로 찾기"
              sortOptions={MINE_SORTS}
              total={mineRows.length}
            />

            <ListSurface
              rows={mineRows.slice(from, to + 1)}
              columns={MINE_COLUMNS}
              query={query}
              rowKey={(r) => r.id}
              onChange={set}
              empty={{ title: '조건에 맞는 게시물이 없어요', description: '검색어나 정렬을 바꿔보세요' }}
            />

            <ListPager query={query} total={mineRows.length} onChange={set} />
          </>
        )
      )}

      {tab === 'market' && market && (
        market.insufficient ? (
          <InsufficientData what="시장 비교" action={{ label: '관심 채널 추가', href: '/ci/monitoring' }} />
        ) : (
          <>
            <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>{market.basisText}</p>
            <ListSurface
              rows={market.topPeers}
              columns={PEER_COLUMNS}
              query={query}
              rowKey={(p) => p.id}
              empty={{
                title: '비교할 시장 콘텐츠가 아직 없어요',
                description: '관심 채널을 더 등록하면 같은 주제의 시장 콘텐츠와 나란히 볼 수 있습니다.',
                action: { label: '관심 채널 추가', href: '/ci/monitoring' },
              }}
            />
          </>
        )
      )}

      {tab === 'learning' && learning && (
        <>
          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              확인된 성공 공식
            </h2>
            {learning.patterns.length === 0 ? (
              <EmptyState
                title="공식으로 부를 만한 발견이 아직 없어요"
                description="서로 다른 채널 3곳 이상에서 같은 차이가 반복돼야 공식으로 올립니다. 관심 채널을 늘리면 그만큼 빨리 모입니다."
                action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
              />
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {learning.patterns.map((p) => (
                  <li key={p.id} className="card" style={{ padding: 'var(--space-3)' }}>
                    <strong>{p.statement}</strong>
                    {p.liftText && <p className="ci-basis">{p.liftText}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              내 정정이 만든 변화
            </h2>
            {learning.corrections.length === 0 ? (
              <EmptyState
                title="아직 정정한 내역이 없어요"
                description="분류를 고치면 다음 추천에 바로 반영됩니다."
                action={{ label: '수집함에서 분류 고치기', href: '/ci/inbox' }}
              />
            ) : (
              <>
                <ul>
                  {learning.corrections.map((c) => (
                    <li key={c.kind} className="ci-card-meta">
                      <span>{c.kind}</span><span className="ci-num">{c.count}건</span>
                    </li>
                  ))}
                </ul>
                <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>
                  정정 내역은 다음 AI 분류에 예시로 함께 전달됩니다
                </p>
              </>
            )}

            {/* 반복 정정 → 규칙 승격 제안. 자동으로 규칙을 만들지 않는다 — 오분류가 규칙으로 굳으면 되돌리기 어렵다. */}
            {learning.promotions.length > 0 && (
              <ul style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {learning.promotions.map((p) => (
                  <li key={p.topicId} className="empty-state-desc">{p.suggestion}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              분류 품질
            </h2>
            {learning.slo.total === 0 ? (
              <EmptyState
                title="아직 분류한 콘텐츠가 없어요"
                description="콘텐츠가 들어오면 자동 확정·검토 큐 비율을 여기서 보여드립니다."
                action={{ label: '수집함으로', href: '/ci/inbox' }}
              />
            ) : (
              <p className="ci-card-meta">
                <span>자동 확정 {learning.slo.autoConfirmRate}%</span>
                <span>검토 큐 {learning.slo.reviewQueueRate}%</span>
                <span className="ci-basis">표본 {learning.slo.total}건</span>
              </p>
            )}
          </section>
        </>
      )}
    </>
  )
}
