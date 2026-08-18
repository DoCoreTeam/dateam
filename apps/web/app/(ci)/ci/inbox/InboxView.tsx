'use client'

// app/(ci)/ci/inbox/InboxView.tsx — R01 수집함 뷰
// 목록과 검토 큐를 탭으로 통합한다(설계서 §5.4 R01 비고).
//
// 목록 표준(§2-6): 표는 ListSurface가 그린다(화면이 <table>을 짜지 않는다).
// 탭·채널묶기 같은 보기 조건은 URL이 진실이다 — 링크를 공유하면 같은 화면이 열린다.

import { RotateCcw, ExternalLink, Trash2, Check } from 'lucide-react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import type { ApiResponse, CiContentListItem } from '@/lib/ci/contracts'
import { CI_PLATFORM_LABEL, CI_PLATFORMS } from '@/lib/ci/types'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import LinkIntakeBox from '@/components/ci/LinkIntakeBox'
import TopicHealthPanel from '@/components/ci/TopicHealthPanel'
import DetailSheet from '@/components/ci/DetailSheet'
import ChannelGroupedList, { type ChannelGroup } from '@/components/ci/ChannelGroupedList'
import MetricBadge from '@/components/ci/MetricBadge'
import { MissingFieldsBadge, IngestStatusBadge } from '@/components/ci/StatusBadge'
import ListSurface from '@/components/ui/list/ListSurface'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListPager from '@/components/ui/list/ListPager'
import SearchHit from '@/components/ci/SearchHit'
import EmptyState from '@/components/ui/EmptyState'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'

/** 셀렉트에서 '새로 만들기'를 뜻하는 값. 실제 id와 겹치지 않는다(uuid가 아니다). */
const NEW_TOPIC = '__new__'

type Tab = 'all' | 'review' | 'failed'

interface InboxViewProps {
  workspaceId: string
  tab: Tab
  items: CiContentListItem[]
  counts: { review: number; failed: number }
  topics: { id: string; name: string }[]
  /** 검색·필터가 먹었는지 사용자가 확인하는 유일한 신호 */
  total?: number
  page?: number
  size?: number
  /** 채널별 보기일 때 서버가 만든 채널 목록. 평평한 보기면 null */
  groups?: ChannelGroup[] | null
  /** 전체 채널 수 — 그룹 모드의 페이지 수는 이것으로 정해진다 */
  groupTotal?: number
}

const PLATFORMS = ['유튜브', '틱톡', '인스타', '페북', 'X', '스레드']

/**
 * 정렬 — 서버가 실제로 지원하는 것만 둔다(§2-6 (4): 클라 재정렬 금지).
 * 안 먹는 선택지를 두면 사용자는 제품이 고장났다고 읽는다.
 */
const SORT_OPTIONS = [
  { key: 'recent', label: '최신순' },
  { key: 'outlier', label: '평소 대비 배수' },
  { key: 'velocity', label: '조회수 급상승' },
]

const PLATFORM_OPTIONS = CI_PLATFORMS.map((p) => ({ value: p, label: CI_PLATFORM_LABEL[p] }))

const FORMAT_OPTIONS = [
  { value: 'short', label: '숏폼' },
  { value: 'long', label: '롱폼' },
  { value: 'image', label: '이미지' },
  { value: 'text', label: '글' },
  { value: 'live', label: '라이브' },
]

// 수집함은 서버가 최신순 한 묶음을 내려준다 — 화면이 정렬·페이지를 다시 정하지 않는다.
// tab·group을 필터 화이트리스트에 두어야 보기 전환이 탭을 지우지 않는다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'recent', dir: 'desc' },
  view: 'table',
  filterKeys: ['tab', 'group'],
}

/**
 * 목록 상태를 URL에 반영한다 — 링크를 공유하면 받는 사람도 같은 결과를 본다(§2-6 (1)).
 *
 * 검색·정렬·필터가 바뀌면 **페이지를 1로 되돌린다.** 안 그러면 3페이지에서 검색했을 때
 * 결과가 2건인데 3페이지를 보여 "검색했더니 아무것도 없다"가 된다.
 */
const PAGE_RESET_KEYS = new Set(['q', 'sort', 'topic', 'platform', 'format', 'size'])

/**
 * 채널을 펼 때 자식 조회에 함께 넘길 조건.
 * 페이지·보기·묶기는 부모의 것이므로 넘기지 않는다 — 자식은 자기 페이지를 따로 센다.
 */
function expandParams(current: URLSearchParams, tab: Tab): Record<string, string> {
  const out: Record<string, string> = {}
  // URL 키와 API 키가 다른 것이 하나 있다 — 이름이 어긋나면 필터가 조용히 무시된다
  const KEY_MAP: Record<string, string> = { topic: 'topicId' }
  for (const k of ['q', 'sort', 'topic', 'platform', 'format']) {
    const v = current.get(k)
    if (v) out[KEY_MAP[k] ?? k] = v
  }
  if (tab !== 'all') out.tab = tab
  return out
}

function applyListParams(
  current: URLSearchParams, patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams(current.toString())
  let resetPage = false
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '') params.delete(k)
    else params.set(k, v)
    if (PAGE_RESET_KEYS.has(k)) resetPage = true
  }
  if (resetPage) params.delete('page')
  return params.toString()
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

export default function InboxView({
  workspaceId, tab, items, counts, topics, total, page = 1, size = 20,
  groups = null, groupTotal = 0,
}: InboxViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [savingTopic, setSavingTopic] = useState<string | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  // 삭제는 진짜 삭제다 — 확인 대화상자가 유일한 안전장치라 공용 흐름을 그대로 쓴다
  const del_ = useCiDelete(workspaceId, () => router.refresh())

  // 서버가 그룹을 만들어 내려줬으면 그룹 모드다 — 화면이 따로 판정하지 않는다.
  const grouped = groups != null
  /** 그룹 모드에서는 세는 단위가 다르다 — 게시물이 아니라 채널이다. */
  const shownTotal = grouped ? groupTotal : total

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

  /**
   * 보이는 검토 대상을 **AI 판정 그대로** 확정한다.
   *
   * 왜 필요한가: 검토 큐에서 빠져나가는 유일한 길이 주제 셀렉트의 onChange였다.
   * onChange는 값이 **바뀌어야** 발화하므로, AI 판정이 이미 맞는 건은 목록에서 뺄 수가
   * 없었다 — 맞는 것을 일부러 틀리게 바꿨다가 되돌려야 처리되는 상태였다.
   * (사용자 지적 2026-08-18: "뭘 처리하는 방법이 있어야 처리하고 완료시킬 거 아니냐")
   * API는 같은 주제를 다시 보내도 review_state를 resolved로 내리고, 값이 안 바뀌면
   * 정정 기록도 남기지 않는다 — 그래서 '맞다고 인정하는 것'이 학습을 오염시키지 않는다.
   */
  async function confirmAllVisible() {
    const targets = items.filter((i) => i.topic?.id)
    if (targets.length === 0) return
    setConfirmingAll(true)
    try {
      // 한 번에 몰아치지 않는다 — 검토 큐는 수십 건이고 서버는 공유 자원이다
      for (const it of targets) {
        await fetch(`/api/ci/contents/${it.id}/topic`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
          body: JSON.stringify({ topicId: it.topic!.id }),
        })
      }
      router.refresh()
    } finally { setConfirmingAll(false) }
  }

  function goTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'all') params.delete('tab')
    else params.set('tab', next)
    router.push(`/ci/inbox${params.toString() ? `?${params}` : ''}`, { scroll: false })
  }

  /** 셀렉트에서 "새 주제 만들기"를 고르면 이름을 받아 만들고 그대로 지정한다. */
  async function createTopicAndAssign(contentId: string) {
    const name = window.prompt('새 주제 이름')?.trim()
    if (!name) { router.refresh(); return }   // 취소하면 셀렉트를 원래대로 되돌린다
    const res = await fetch('/api/ci/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ name }),
    }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
    if (!res.success) { router.refresh(); return }
    await confirmTopic(contentId, res.data.id)
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
          {/* 검색으로 걸린 자리와 문구. 이유 없는 결과는 빈 결과보다 나쁘다 —
              '우니'로 검색했는데 제목에 없는 게시물이 나오면 제품이 틀린 것으로 읽힌다 */}
          <SearchHit matchedIn={item.matchedIn} snippet={item.matchedSnippet} />
        </>
      ),
    },
    {
      key: 'status', header: '상태',
      cell: (item) => (
        <span className="ci-nowrap">
          <IngestStatusBadge status={item.ingestStatus} />
          <MissingFieldsBadge status={item.ingestStatus} missingFields={item.missingFields} />
        </span>
      ),
    },
    {
      key: 'topic', header: '주제',
      cell: (item) => (tab === 'review' ? (
        // 한 줄로 세운다. 접히면 그 행만 높아지고(79→87px), 셀렉트가 길어지면 표가 가로로 넘친다
        // → 셀렉트 폭에 상한을 둬서 긴 주제명이 표를 밀지 못하게 한다(닫힌 상태는 말줄임).
        <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center', whiteSpace: 'nowrap' }}>
          <label className="label" htmlFor={`t-${item.id}`} style={{ position: 'absolute', left: '-9999px' }}>주제</label>
          <select className="input-field" id={`t-${item.id}`} style={{ width: 'auto', maxWidth: '8rem' }}
            defaultValue={item.topic?.id ?? ''}
            disabled={savingTopic === item.id}
            onChange={(e) => (e.target.value === NEW_TOPIC
              ? createTopicAndAssign(item.id)
              : confirmTopic(item.id, e.target.value || null))}>
            <option value="">미분류</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {/* 주제를 사람이 만들 길이 없어 AI가 만든 것만 쓸 수 있었다.
                새 부품을 만들지 않고 이미 있는 셀렉트를 늘린다. */}
            <option value={NEW_TOPIC}>+ 새 주제 만들기…</option>
          </select>
          {item.topicConfidence != null && item.topicConfidence > 0 && (
            <span className="ci-basis ci-num" title="AI가 주제를 정한 확신도">{Math.round(item.topicConfidence * 100)}%</span>
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
      key: 'actions', header: '작업', noLabel: true, align: 'right',
      cell: (item) => (
        // 행 클릭(상세 열기)과 겹치지 않게 이 칸의 클릭은 여기서 멈춘다.
        // 글자 버튼 두 개는 좁은 폭에서 세로로 접혀 **그 행만 121px**이 됐다(다른 행 79px).
        // nowrap으로 막으면 표가 넓어져 가로 스크롤이 난다(정책상 금지) → 내용을 아이콘으로 줄인다.
        <span onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {/* 검토 큐에서 나가는 길. 주제를 바꿀 필요가 없는 건은 이 버튼이 유일한 출구다. */}
          {tab === 'review' && item.topic?.id && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => confirmTopic(item.id, item.topic!.id)}
              disabled={savingTopic === item.id}
              aria-label={`주제 '${item.topic.name}'이 맞다고 확정`}
              title={savingTopic === item.id ? '확정 중…' : `'${item.topic.name}' 이대로 확정`}
            >
              <Check size={15} />
            </button>
          )}
          {(item.ingestStatus === 'failed' || item.ingestStatus === 'partial') && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => retry(item.id)}
              disabled={retrying === item.id}
              aria-label="수집 다시 시도"
              title={retrying === item.id ? '재시도 중…' : '재시도'}
            >
              <RotateCcw size={15} />
            </button>
          )}
          <Link href={item.canonicalUrl} target="_blank" rel="noreferrer" className="btn-ghost"
            aria-label="원본 페이지 열기" title="원본 열기">
            <ExternalLink size={15} />
          </Link>
          {/* 잘못 들어온 게시물을 없앨 길. 예전엔 재시도밖에 없어 실패한 링크가 영원히 남았다 */}
          <button type="button" className="btn-ghost"
            onClick={() => del_.ask({ kind: 'content', id: item.id, title: '이 게시물을 지울까요?' })}
            aria-label="게시물 지우기" title="지우기">
            <Trash2 size={15} />
          </button>
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

      {/* "모든 게 요리"가 보이는 자리가 여기라, 고칠 수단도 여기 둔다.
          할 일이 없으면 스스로 그리지 않으므로 평소엔 화면을 차지하지 않는다. */}
      <TopicHealthPanel workspaceId={workspaceId} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 'var(--space-6) 0 var(--space-4)', flexWrap: 'wrap' }}>
        <SegmentedTabs
          ariaLabel="수집함 분류"
          tabs={TABS.map((t) => ({ id: t.id, label: t.count ? `${t.label} ${t.count}` : t.label }))}
          activeId={tab}
          onSelect={(id) => goTab(id as Tab)}
        />

        {/* 검토 탭에서만: 지금 무엇을 하면 되는지. 없으면 '검토 필요'는 뜻만 있고 방법이 없다. */}
        {tab === 'review' && items.length > 0 && (
          <button
            type="button"
            className="btn-ghost"
            onClick={confirmAllVisible}
            disabled={confirmingAll || items.every((i) => !i.topic?.id)}
            title="이 화면에 보이는 게시물의 AI 주제를 모두 그대로 확정합니다"
          >
            {confirmingAll ? '확정 중…' : '보이는 것 모두 확정'}
          </button>
        )}

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

      {tab === 'review' && items.length > 0 && (
        <p className="ci-basis" style={{ margin: '0 0 var(--space-3)' }}>
          AI가 주제를 정했지만 근거가 갈린 게시물입니다.
          주제가 맞으면 <strong>✓</strong>(이대로 확정)을, 틀리면 주제를 바꾸면 목록에서 빠집니다.
        </p>
      )}

      <ListToolbar
        query={query}
        total={shownTotal}
        views={['table']}
        searchPlaceholder="제목·설명·영상 대사·화면 자막에서 찾기"
        sortOptions={SORT_OPTIONS}
        filters={[
          { key: 'topic', label: '주제', options: topics.map((t) => ({ value: t.id, label: t.name })) },
          { key: 'platform', label: '플랫폼', options: PLATFORM_OPTIONS },
          { key: 'format', label: '형식', options: FORMAT_OPTIONS },
        ]}
        onChange={(patch) => {
          // 서버가 조회하는 값은 전부 URL로 올린다 —
          // 클라 상태로 들면 새로고침에 날아가고 링크 공유가 깨진다(§2-6 (1)).
          const next: Record<string, string | null> = {}
          if (patch.q !== undefined) next.q = patch.q.trim() || null
          if (patch.sort) next.sort = patch.sort.key === 'recent' ? null : patch.sort.key
          if (patch.size) next.size = String(patch.size)
          if (patch.page) next.page = patch.page > 1 ? String(patch.page) : null
          if (patch.filters) {
            for (const k of ['topic', 'platform', 'format']) {
              if (k in patch.filters) next[k] = patch.filters[k] || null
            }
            // 화면 전용 필터(보기 묶기·탭)는 URL 상태 훅이 관리한다
            if ('group' in patch.filters || 'tab' in patch.filters) { set(patch); return }
          }
          if (Object.keys(next).length === 0) { set(patch); return }
          const qs = applyListParams(searchParams, next)
          router.push(`/ci/inbox${qs ? `?${qs}` : ''}`, { scroll: false })
        }}
      />

      {query.q.trim() && (
        <p className="ci-basis" style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
          제목·설명뿐 아니라 <strong>영상에서 읽은 대사와 화면 자막</strong>까지 함께 찾았습니다.
        </p>
      )}

      {grouped ? (
        groups!.length > 0 ? (
          <ChannelGroupedList
            groups={groups!}
            workspaceId={workspaceId}
            // 목록이 건 조건을 자식에도 그대로 건다 — 검색으로 좁힌 그룹을 펴면
            // 검색에 걸린 게시물만 나와야 한다
            listParams={expandParams(searchParams, tab)}
            onOpen={setOpenId}
            onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
          />
        ) : (
          <EmptyState
            title={query.q.trim() ? '검색과 맞는 채널이 없습니다' : EMPTY[tab].title}
            description={query.q.trim()
              ? '다른 말로 찾아보거나 필터를 지워 보세요.'
              : EMPTY[tab].description}
          />
        )
      ) : (
        <ListSurface
          rows={items}
          columns={columns}
          query={query}
          rowKey={(item) => item.id}
          onRowClick={(item) => setOpenId(item.id)}
          empty={EMPTY[tab]}
        />
      )}

      {/* 1,018건이 있는데 첫 묶음만 보이고 더 볼 방법이 없던 것을 고친다(사용자 지적 2026-08-18).
          §2-6 (2): 페이지 이동은 ListPager 한 벌로 그린다. */}
      {(shownTotal ?? 0) > size && (
        <ListPager
          query={{ ...query, size: size as never, page }}
          total={shownTotal}
          onChange={(patch) => {
            if (patch.page == null) return
            const qs = applyListParams(searchParams, {
              page: patch.page > 1 ? String(patch.page) : null,
            })
            router.push(`/ci/inbox${qs ? `?${qs}` : ''}`, { scroll: true })
          }}
        />
      )}

      <DetailSheet
        contentId={openId}
        workspaceId={workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />

      {del_.pending && (
        <ConfirmDeleteDialog
          title={del_.pending.title}
          impact={del_.impact}
          loading={del_.loading}
          busy={del_.busy}
          errorMessage={del_.errorMessage}
          onConfirm={del_.confirm}
          onClose={del_.close}
        />
      )}
    </>
  )
}
