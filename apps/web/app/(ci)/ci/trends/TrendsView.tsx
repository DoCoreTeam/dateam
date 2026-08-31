'use client'

// app/(ci)/ci/trends/TrendsView.tsx — R04 트렌드 (시장·떡상·성공 공식·이슈)
// 조건 바는 URL 상태로 보존한다 — 공유 가능한 뷰가 이 제품의 관례다.
//
// 목록 표준(§2-6): 표는 전부 ListSurface가 그린다(화면이 <table>을 짜지 않는다).
// 공식·이슈는 서버가 전량(50·100건)을 내려주므로 검색·페이지는 ListToolbar/ListPager가 맡는다.
// 시장 탭의 집계표는 사용자가 조회하는 목록이 아니라 고정 요약이라 SUMMARY_QUERY로 그린다.

import { useEffect, useState } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApiResponse, CiContentListItem } from '@/lib/ci/contracts'
import type {
  MarketOverview, MarketSlice, PatternRow, SignalRow, TimingOverview, TimingSlice,
} from '@/lib/ci/queries/trends'
// 종류 이름은 서버·화면이 같은 SSOT 를 쓴다 — 화면이 한글을 직접 적으면 말이 갈린다(§0-2).
// **순수 모듈**에서 가져온다: queries/trends 는 서버 전용(createAdminClient)이라
// 클라이언트가 값을 import 하면 빌드가 깨진다(crud-coverage 가드가 잡아낸 자리).
import { signalKindLabel } from '@/lib/ci/analysis/signals'
import { MARKET_MIN_CHANNELS, type MarketContrast } from '@/lib/ci/analysis/market-contrast'
import { SEASON_MIN_WINDOW_DAYS } from '@/lib/ci/format/metrics'
import AccountWhyPanel from '@/components/ci/AccountWhyPanel'
import { CI_PLATFORMS, CI_PLATFORM_LABEL } from '@/lib/ci/types'
import PageHeader from '@/components/ui/PageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ContentCard from '@/components/ci/ContentCard'
import ChannelGroupedList, { groupByChannel as toChannelGroups } from '@/components/ci/ChannelGroupedList'
import DetailSheet from '@/components/ci/DetailSheet'
import DiscoveryEvidenceSheet from '@/components/ci/DiscoveryEvidenceSheet'
import { ConfidenceBadge } from '@/components/ci/StatusBadge'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { InsufficientData } from '@/components/ci/states'
import { MetricBasis } from '@/components/ci/MetricBadge'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { rangeOf, type ListDefaults, type ListQuery } from '@/lib/ui/list-query'

type Tab = 'market' | 'outliers' | 'patterns' | 'signals'

const TABS: { id: Tab; label: string }[] = [
  { id: 'market', label: '시장' },
  { id: 'outliers', label: '떡상' },
  { id: 'patterns', label: '성공 공식' },
  { id: 'signals', label: '이슈' },
]

const SORTS = [
  { id: 'outlier', label: '평소 대비 높은 순' },
  { id: 'recent', label: '최신순' },
  { id: 'velocity', label: '조회 속도순' },
]

const FORMATS = [
  { id: '', label: '전체' },
  { id: 'short', label: '숏폼' },
  { id: 'long', label: '롱폼' },
  { id: 'image', label: '이미지' },
  { id: 'text', label: '텍스트' },
]

const WINDOWS = [7, 28, 90]

const SIGNAL_KINDS = [
  { id: 'news', label: '뉴스' },
  { id: 'search_spike', label: '검색 급상승' },
  { id: 'community', label: '커뮤니티 화제' },
]

// 탭·필터는 URL에 남아야 보기 전환이 조건을 지우지 않는다.
// 'sort'는 떡상 탭의 정렬 파라미터와 같은 자리를 쓴다(서버가 화이트리스트로 정규화).
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'outlier', dir: 'desc' },
  view: 'table',
  size: 20,
  filterKeys: ['tab', 'topicId', 'platform', 'format', 'windowDays', 'content'],
}

/** 시장 탭 집계표 — 사용자가 정렬·페이지를 정하는 목록이 아니라 고정 요약이다 */
const SUMMARY_QUERY: ListQuery = {
  q: '', sort: { key: '', dir: 'desc' }, filters: {},
  view: 'table', size: 100, mode: 'pages', page: 1,
}

const basis = (text: string | null) => text ?? <span className="ci-basis">비교 이력 부족</span>

/** 플랫폼별·포맷별 집계는 열 구성이 같다 — 머리글만 다르다 */
function sliceColumns(head: string): ColumnDef<MarketSlice>[] {
  return [
    { key: 'label', header: head, primary: true, cell: (s) => s.label },
    { key: 'count', header: '건수', cell: (s) => <span className="ci-num">{s.count}</span> },
    { key: 'share', header: '비중', cell: (s) => <span className="ci-num">{s.share}%</span> },
    { key: 'median', header: '평소 대비 중앙값', cell: (s) => basis(s.medianOutlierText) },
  ]
}

const TIMING_COLUMNS: ColumnDef<TimingSlice>[] = [
  { key: 'label', header: '구간', primary: true, cell: (s) => s.label },
  { key: 'count', header: '건수', cell: (s) => <span className="ci-num">{s.count}</span> },
  {
    key: 'median', header: '평소 대비 중앙값',
    cell: (s) => s.medianOutlierText ?? <span className="ci-basis">표본 부족</span>,
  },
]

type TopChannel = MarketOverview['topChannels'][number]

const TOP_CHANNEL_COLUMNS: ColumnDef<TopChannel>[] = [
  { key: 'name', header: '채널', primary: true, cell: (c) => c.name },
  { key: 'count', header: '게시물', cell: (c) => <span className="ci-num">{c.count}</span> },
  { key: 'median', header: '평소 대비 중앙값', cell: (c) => basis(c.medianOutlierText) },
]

const PATTERN_COLUMNS: ColumnDef<PatternRow>[] = [
  { key: 'statement', header: '공식', primary: true, cell: (pt) => <strong>{pt.statement}</strong> },
  {
    key: 'lift', header: '효과와 근거',
    cell: (pt) => pt.liftText ?? <span className="ci-basis">근거 부족</span>,
  },
  { key: 'topic', header: '주제', cell: (pt) => pt.topicName ?? '전체' },
  { key: 'confidence', header: '신뢰도', cell: (pt) => <ConfidenceBadge confidence={pt.confidence} /> },
]

interface Props {
  workspaceId: string
  tab: Tab
  topics: { id: string; name: string }[]
  topicId: string | null
  items: CiContentListItem[]
  population: number
  windowDays: number
  sort: string
  platform: string
  format: string
  basisText: string
  market: MarketOverview | null
  timing: TimingOverview | null
  marketWhy: MarketContrast | null
  patterns: PatternRow[] | null
  signals: SignalRow[] | null
  /** AI 가 찾아온 확인 대기 후보. 확정본과 섞지 않는다 */
  signalCandidates: SignalRow[] | null
}

export default function TrendsView(p: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { query, set } = useListQuery(LIST_DEFAULTS)
  // 알림에서 바로 상세로 들어오는 경로(§8.1 "알림에서 상세 시트로 직행").
  // 상세를 여는 것도 URL 상태로 둔다 — 링크를 공유하면 같은 화면이 열려야 한다.
  const [openId, setOpenId] = useState<string | null>(searchParams.get('content'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 성공 공식 행을 눌렀을 때 열 근거. 문장을 함께 들고 가야 시트 헤더가 비지 않는다.
  const [openDiscovery, setOpenDiscovery] = useState<PatternRow | null>(null)
  const [groupByChannel, setGroupByChannel] = useState(false)
  // 시장 탭의 집계표는 **근거**다 — 결론보다 먼저 보이면 무엇을 하라는 화면인지 사라진다.
  const [showBasis, setShowBasis] = useState(false)
  const [sKind, setSKind] = useState('news')
  const [sTitle, setSTitle] = useState('')
  const [sUrl, setSUrl] = useState('')

  // 이미 트렌드 화면에 있는 상태에서 알림을 누르면 컴포넌트가 다시 마운트되지 않는다.
  // useState 초기값만 믿으면 그때 상세가 열리지 않는다.
  const contentParam = searchParams.get('content')
  useEffect(() => { if (contentParam) setOpenId(contentParam) }, [contentParam])

  function closeDetail() {
    setOpenId(null)
    if (contentParam) setParam('content', '')
  }

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // 조건이 바뀌면 목록 위치를 1페이지로 되돌린다 — 3페이지를 보던 채로 주제를 바꾸면
    // 결과가 줄어 빈 화면이 되고, 화면은 "패턴이 없습니다"라고 거짓말을 한다.
    // 'content'는 상세 시트를 여닫는 값일 뿐 목록 조건이 아니다 — 위치를 건드리지 않는다.
    if (key !== 'content') params.delete('page')
    // 탭을 옮길 때만 검색어까지 지운다 — 다른 목록에 남의 검색어를 물려주지 않는다
    if (key === 'tab') params.delete('q')
    router.push(`/ci/trends?${params}`, { scroll: false })
  }

  async function recomputePatterns() {
    setBusy(true); setError(null)
    try {
      // 지금 보고 있는 주제만 다시 계산한다 — 전체를 한 번에 돌리면 몇 분이 걸리고,
      // 그동안 화면은 멈춘 것처럼 보인다. 전체 훑기는 워커가 한다.
      const qs = p.topicId ? `?topicId=${encodeURIComponent(p.topicId)}` : ''
      // 경로를 리터럴로 둔다 — 템플릿으로 조립하면 배선 가드가 이 호출을 못 본다
      const res = await fetch('/api/ci/patterns/recompute' + qs, {
        method: 'POST', headers: { 'X-CI-Workspace': p.workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<{ discoveryNotice: string | null }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      // 발견이 갱신되지 않았으면 그 사실을 말한다 — 목록이 그대로인 이유를
      // 사용자가 추측하게 두지 않는다(조용한 성공은 고장과 구분되지 않는다).
      setNotice(res.data?.discoveryNotice ?? null)
      router.refresh()
    } finally { setBusy(false) }
  }

  /** 밀린 "왜 터졌나" 분석을 지금 돌린다. 결과 건수를 그대로 알려준다 — 조용히 끝내지 않는다. */
  async function analyzeCreatives() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/ci/creative/backfill', {
        method: 'POST', headers: { 'X-CI-Workspace': p.workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<{ note: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setNotice(res.data.note)
      router.refresh()
    } finally { setBusy(false) }
  }

  async function addSignal() {
    if (!sTitle.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': p.workspaceId },
        body: JSON.stringify({
          kind: sKind, title: sTitle.trim(),
          url: sUrl.trim() || undefined,
          topicId: p.topicId ?? undefined,
        }),
      }).then((r) => r.json() as Promise<ApiResponse<unknown>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setSTitle(''); setSUrl('')
      router.refresh()
    } finally { setBusy(false) }
  }

  /** 확인 대기에서 고른 것. 사람이 «전부»가 아니라 «고른 것»만 등록한다 */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * 고른 후보를 확정하거나, 남은 것을 버린다.
   *
   * 버리는 것을 삭제가 아니라 «폐기»로 두는 이유: 지우면 다음 훑기에서 같은 주소가
   * 다시 올라온다. 사람이 이미 «아니다»라고 한 것을 매번 다시 보여 주면 후보함을 안 본다.
   */
  async function decideSignals(action: 'confirm' | 'dismiss', ids: string[]) {
    if (ids.length === 0) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/signals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': p.workspaceId },
        body: JSON.stringify({ ids, action }),
      }).then((r) => r.json() as Promise<ApiResponse<{ changed: number }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setNotice(action === 'confirm'
        ? `${res.data.changed}건을 이슈로 등록했습니다`
        : `${res.data.changed}건을 버렸습니다`)
      setPicked(new Set())
      router.refresh()
    } catch {
      // 여기서 잡지 않으면 진행 표시만 꺼지고 사용자는 «아무 일도 안 일어났다»를 본다
      setError({ code: 'NETWORK', message: '이슈를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요' })
    } finally { setBusy(false) }
  }

  async function removeSignal(id: string) {
    try {
      const res = await fetch(`/api/ci/signals?id=${id}`, { method: 'DELETE', headers: { 'X-CI-Workspace': p.workspaceId } })
        .then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      router.refresh()
    } catch {
      setError({ code: 'NETWORK', message: '이슈를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요' })
    }
  }

  const topicSelect = (
    <div>
      <label className="label" htmlFor="ci-f-topic" style={{ margin: 0 }}>주제</label>
      <select className="input-field" id="ci-f-topic" style={{ width: 'auto' }}
        value={p.topicId ?? ''} onChange={(e) => setParam('topicId', e.target.value)}>
        <option value="">전체</option>
        {p.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )

  // 공식·이슈는 서버가 전량을 내려준다 — 검색·페이지는 화면에서 자른다(URL이 진실).
  const needle = query.q.trim().toLowerCase()
  const { from, to } = rangeOf(query)

  const patternsAll = (p.patterns ?? []).filter((pt) => !needle
    || pt.statement.toLowerCase().includes(needle)
    || (pt.topicName ?? '').toLowerCase().includes(needle))

  // 계절은 90일 이상 창에서만 말한다. 28일 창의 "가을 1.9배"는 계절이 아니라
  // 그냥 최근이다 — 없는 것을 보여주느니 왜 없는지를 보여준다.
  const timingBlocks: { title: string; slices: TimingSlice[] }[] = p.timing
    ? [
      ...(p.timing.seasonMeaningful ? [{ title: '계절', slices: p.timing.bySeason }] : []),
      { title: '시간대', slices: p.timing.byDayPart },
      { title: '요일', slices: p.timing.byWeekday },
    ]
    : []

  const signalsAll = (p.signals ?? []).filter((s) => !needle
    || s.title.toLowerCase().includes(needle)
    || (s.topicName ?? '').toLowerCase().includes(needle))

  const SIGNAL_COLUMNS: ColumnDef<SignalRow>[] = [
    {
      key: 'title', header: '이슈', primary: true,
      cell: (s) => (s.url
        ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
        : <strong>{s.title}</strong>),
    },
    {
      key: 'kind', header: '종류',
      cell: (s) => SIGNAL_KINDS.find((k) => k.id === s.kind)?.label ?? s.kind,
    },
    { key: 'topic', header: '주제', cell: (s) => s.topicName ?? '전체' },
    { key: 'occurred', header: '시점', cell: (s) => s.occurredAtText ?? '—' },
    {
      key: 'actions', header: '작업',
      // 같은 화면의 다른 목록은 행이 열린다(성공 공식). 액션 칸은 행 클릭을 발화시키면 안 된다 —
      // 「삭제」를 눌렀는데 상세가 열리는 사고가 실제로 있었다(§2-3-1 (1)).
      cell: (s) => (
        <button type="button" className="btn-ghost"
          onClick={(e) => { e.stopPropagation(); removeSignal(s.id) }}>삭제</button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="트렌드"
        description="시장에서 지금 무엇이 통하는지"
        below={<StageNav stages={RESEARCH_STAGES} />}
      />

      <SegmentedTabs
        ariaLabel="트렌드 보기"
        tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
        activeId={p.tab}
        onSelect={(id) => setParam('tab', id)}
      />

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}
      {notice && (
        <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }} role="status">{notice}</p>
      )}

      {/* ── 시장 ── */}
      {p.tab === 'market' && p.market && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
            {topicSelect}
            <div>
              <label className="label" htmlFor="m-window" style={{ margin: 0 }}>기간</label>
              <select className="input-field" id="m-window" style={{ width: 'auto' }}
                value={String(p.windowDays)} onChange={(e) => setParam('windowDays', e.target.value)}>
                {WINDOWS.map((w) => <option key={w} value={w}>{w}일</option>)}
              </select>
            </div>
            <MetricBasis text={p.market.basisText} />
          </div>

          {p.market.insufficient ? (
            <EmptyState
              title="이 기간에 모인 시장 데이터가 없습니다"
              description={`관심 채널을 ${MARKET_MIN_CHANNELS}곳 이상 등록하면 시장 그림이 만들어집니다. 그보다 적으면 한 계정의 습관을 시장이라 부르게 되어 집계만 보여 드립니다.`}
              action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
            />
          ) : (
            <>
              {/* 결론이 먼저다. 나열은 근거이지 답이 아니다. */}
              {p.marketWhy && (
                <AccountWhyPanel
                  contrast={p.marketWhy}
                  title="지금 시장에서 무엇이 통하나"
                  composition={p.marketWhy.composition.text}
                />
              )}

              <button type="button" className="btn-ghost"
                aria-expanded={showBasis}
                onClick={() => setShowBasis((v) => !v)}
                title="위 결론이 어떤 집계에서 나왔는지 펼쳐 봅니다">
                {showBasis ? '근거 접기' : '근거 자세히 보기'}
              </button>

              {showBasis && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  {/* 용어를 화면이 직접 푼다 — 아래 표 전부가 이 말을 쓴다 */}
                  <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>
                    ‘평소 대비’는 그 채널 자기 자신의 최근 중앙값과 견준 배수입니다.
                    1.0배면 그 채널의 평소만큼이라는 뜻이고, 채널끼리 크기를 비교한 값이 아닙니다.
                  </p>

              <section style={{ marginBottom: 'var(--space-6)' }}>
                <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>플랫폼별</h2>
                <ListSurface
                  rows={p.market.byPlatform}
                  columns={sliceColumns('플랫폼')}
                  query={SUMMARY_QUERY}
                  rowKey={(s) => s.label}
                  empty={{
                    title: '이 기간에 집계된 플랫폼이 없습니다',
                    description: '기간을 넓히거나 관심 채널을 더 등록해 보세요.',
                    action: { label: '관심 채널 추가', href: '/ci/monitoring' },
                  }}
                />
              </section>

              <section style={{ marginBottom: 'var(--space-6)' }}>
                <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>포맷별</h2>
                <ListSurface
                  rows={p.market.byFormat}
                  columns={sliceColumns('포맷')}
                  query={SUMMARY_QUERY}
                  rowKey={(s) => s.label}
                  empty={{
                    title: '이 기간에 집계된 포맷이 없습니다',
                    description: '기간을 넓히거나 관심 채널을 더 등록해 보세요.',
                    action: { label: '관심 채널 추가', href: '/ci/monitoring' },
                  }}
                />
              </section>

              {p.timing && p.timing.contextFilled > 0 && (
                <section style={{ marginBottom: 'var(--space-6)' }}>
                  <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
                    언제 통했나
                  </h2>
                  <p className="ci-basis" style={{ marginBottom: 'var(--space-2)' }}>
                    게시 시각을 콘텐츠 지역 기준으로 읽었습니다 · 최근 {p.timing.windowDays}일 {p.timing.contextFilled}/{p.timing.total}건 판정
                    {p.timing.regionUnknown > 0 && ` · 지역 미상 ${p.timing.regionUnknown}건은 UTC 기준`}
                    {!p.timing.seasonMeaningful
                      && ` · 계절은 ${SEASON_MIN_WINDOW_DAYS}일 이상 볼 때만 말합니다`}
                  </p>
                  <div className={timingBlocks.length >= 3 ? 'responsive-grid-cols-3' : 'responsive-grid-cols-2'}>
                    {timingBlocks.map(({ title, slices }) => (
                      <div key={title}>
                        <h3 className="ci-creative-head">{title}</h3>
                        <ListSurface
                          rows={slices}
                          columns={TIMING_COLUMNS}
                          query={SUMMARY_QUERY}
                          rowKey={(s) => s.key}
                          empty={{
                            title: `${title}별로 나눌 만한 게시물이 없습니다`,
                            description: '게시 시각을 확보한 게시물이 쌓이면 자동으로 채워집니다.',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

                  <section>
                    <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>많이 올린 채널</h2>
                    <ListSurface
                      rows={p.market.topChannels}
                      columns={TOP_CHANNEL_COLUMNS}
                      query={SUMMARY_QUERY}
                      rowKey={(c) => c.id}
                      empty={{
                        title: '채널 정보를 아직 확보하지 못했습니다',
                        description: '관심 채널을 등록하면 어느 채널이 얼마나 올리는지 여기 모입니다.',
                        action: { label: '관심 채널 추가', href: '/ci/monitoring' },
                      }}
                    />
                  </section>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── 떡상 ── */}
      {p.tab === 'outliers' && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
            {topicSelect}
            <div>
              <label className="label" htmlFor="ci-f-platform" style={{ margin: 0 }}>플랫폼</label>
              <select className="input-field" id="ci-f-platform" style={{ width: 'auto' }}
                value={p.platform} onChange={(e) => setParam('platform', e.target.value)}>
                <option value="">전체</option>
                {CI_PLATFORMS.map((pl) => <option key={pl} value={pl}>{CI_PLATFORM_LABEL[pl]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ci-f-format" style={{ margin: 0 }}>포맷</label>
              <select className="input-field" id="ci-f-format" style={{ width: 'auto' }}
                value={p.format} onChange={(e) => setParam('format', e.target.value)}>
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ci-f-window" style={{ margin: 0 }}>기간</label>
              <select className="input-field" id="ci-f-window" style={{ width: 'auto' }}
                value={String(p.windowDays)} onChange={(e) => setParam('windowDays', e.target.value)}>
                {WINDOWS.map((w) => <option key={w} value={w}>{w}일</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ci-f-sort" style={{ margin: 0 }}>정렬</label>
              <select className="input-field" id="ci-f-sort" style={{ width: 'auto' }}
                value={p.sort} onChange={(e) => setParam('sort', e.target.value)}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <button type="button" className="ci-metric"
              onClick={() => setGroupByChannel((v) => !v)}
              title="채널별로 묶어 어느 채널이 잘 나가는지 비교합니다">
              {groupByChannel ? '전체 목록으로' : '채널별로 묶기'}
            </button>
            <button type="button" className="btn-ghost" onClick={analyzeCreatives} disabled={busy}
              title="평소 대비 1.5배를 넘은 콘텐츠의 썸네일 문구와 후킹을 분석합니다">
              {busy ? '분석 중…' : '왜 터졌는지 분석'}
            </button>
            <MetricBasis text={p.basisText} />
          </div>

          {p.items.length === 0 ? (
            <EmptyState
              title="이 조건에 해당하는 떡상이 아직 없습니다"
              description="관심 채널을 3곳 이상 등록하면 이 주제의 떡상이 여기 모입니다. 수집함에 넣은 단건은 시장 통계에 넣지 않습니다."
              action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
            />
          ) : (
            <>
              {p.population < 30 && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <InsufficientData what="같은 주제 상위 %" action={{ label: '관심 채널 추가', href: '/ci/monitoring' }} />
                </div>
              )}
              {groupByChannel ? (
                <ChannelGroupedList
                  // 떡상은 고정 30건이라 페이지가 없다 — 손에 든 것을 그대로 묶는다.
                  // (수집함은 1,600건이 페이지로 나뉘므로 서버가 채널을 집계한다)
                  groups={toChannelGroups(p.items)}
                  workspaceId={p.workspaceId}
                  onOpen={setOpenId}
                  onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
                  onAddToBoard={(id) => router.push(`/ci/boards?add=${id}`)}
                />
              ) : (
                <div className="ci-card-grid">
                  {p.items.map((item) => (
                    <ContentCard key={item.id} item={item} onOpen={setOpenId}
                      onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
                      onAddToBoard={(id) => router.push(`/ci/boards?add=${id}`)} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── 성공 공식 ── */}
      {p.tab === 'patterns' && p.patterns && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--space-4)' }}>
            {topicSelect}
            <button type="button" className="btn-ghost" onClick={recomputePatterns} disabled={busy}>
              {busy ? '계산 중…' : '다시 계산'}
            </button>
          </div>

          <ListToolbar
            query={query}
            onChange={set}
            searchPlaceholder="공식 문장 · 주제 검색"
            total={patternsAll.length}
          />

          <ListSurface
            rows={patternsAll.slice(from, to + 1)}
            columns={PATTERN_COLUMNS}
            query={query}
            rowKey={(pt) => pt.id}
            onRowClick={(pt) => setOpenDiscovery(pt)}
            empty={needle
              ? { title: '검색어에 맞는 공식이 없습니다', description: '다른 낱말로 찾아보세요.' }
              : {
                title: '아직 공식으로 부를 만한 발견이 없습니다',
                description: '떡상 1건과 같은 채널의 평범한 게시물을 나란히 놓고 차이를 찾습니다. 서로 다른 채널 3곳 이상에서 같은 차이가 반복될 때만 공식으로 올립니다 — 한 채널의 습관을 시장의 공식으로 팔지 않기 위해서입니다.',
                action: { label: '관심 채널 추가', href: '/ci/monitoring' },
              }}
          />

          <ListPager query={query} total={patternsAll.length} onChange={set} />
        </>
      )}

      {/* ── 이슈 ── */}
      {p.tab === 'signals' && p.signals && (
        <>
          {/*
            AI 가 찾아온 확인 대기.
            자동 등록하지 않는다 — 추출·제안형 AI 는 후보를 보여주고 사람이 확정한다(§5-3).
            손입력 폼보다 **위**에 둔다: 먼저 할 일이 먼저 보여야 한다.
          */}
          {p.signalCandidates && p.signalCandidates.length > 0 && (
            <section className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)',
              }}>
                <strong>AI가 찾은 이슈 · 확인 대기 {p.signalCandidates.length}건</strong>
                <span className="ci-basis">
                  출처가 없는 것은 담지 않았습니다 · 고른 것만 등록됩니다
                </span>
              </div>

              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {p.signalCandidates.map((c) => (
                  <li key={c.id} className="card" style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 'var(--space-3)',
                    alignItems: 'start', padding: 'var(--space-3)',
                  }}>
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={() => togglePick(c.id)}
                      aria-label={`${c.title} 선택`}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      <p className="ci-basis" style={{ margin: 'var(--space-1) 0 0' }}>
                        {signalKindLabel(c.kind)}
                        {c.source ? ` · ${c.source}` : ''}
                        {c.occurredAtText ? ` · ${c.occurredAtText}` : ''}
                        {c.topicName ? ` · 주제 ${c.topicName}` : ' · 주제 미정'}
                      </p>
                      {c.reason && (
                        <p className="ci-basis" style={{ margin: 'var(--space-1) 0 0' }}>{c.reason}</p>
                      )}
                    </div>
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="ci-metric">
                        원문 보기
                      </a>
                    )}
                  </li>
                ))}
              </ul>

              <div style={{
                display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end',
                marginTop: 'var(--space-3)', flexWrap: 'wrap',
              }}>
                <button type="button" className="btn-ghost" disabled={busy}
                  onClick={() => decideSignals('dismiss', p.signalCandidates!.map((c) => c.id))}>
                  전부 버리기
                </button>
                <button type="button" className="btn-primary" disabled={busy || picked.size === 0}
                  onClick={() => decideSignals('confirm', Array.from(picked))}>
                  선택한 {picked.size}건 등록
                </button>
              </div>
            </section>
          )}

          <section className="card" style={{
            display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end',
            padding: 'var(--space-3)', marginBottom: 'var(--space-4)',
          }}>
            <div style={{ width: '100%' }}>
              <strong style={{ fontSize: 'var(--fs-sm)' }}>직접 적기</strong>
              <p className="ci-basis" style={{ margin: 'var(--space-1) 0 0' }}>
                AI가 못 본 것을 여기에 적습니다.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="s-kind">종류</label>
              <select className="input-field" id="s-kind" value={sKind} onChange={(e) => setSKind(e.target.value)}>
                {SIGNAL_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '220px' }}>
              <label className="label" htmlFor="s-title">이슈 내용</label>
              <input className="input-field" id="s-title" value={sTitle}
                onChange={(e) => setSTitle(e.target.value)} placeholder="지금 화제가 된 것" />
            </div>
            <div style={{ minWidth: '180px' }}>
              <label className="label" htmlFor="s-url">링크 (선택)</label>
              <input className="input-field" id="s-url" value={sUrl} onChange={(e) => setSUrl(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" onClick={addSignal} disabled={busy || !sTitle.trim()}>
              이슈 등록
            </button>
          </section>

          <ListToolbar
            query={query}
            onChange={set}
            searchPlaceholder="이슈 내용 · 주제 검색"
            total={signalsAll.length}
          />

          <ListSurface
            rows={signalsAll.slice(from, to + 1)}
            columns={SIGNAL_COLUMNS}
            query={query}
            rowKey={(s) => s.id}
            empty={needle
              ? { title: '검색어에 맞는 이슈가 없습니다', description: '다른 낱말로 찾아보세요.' }
              : {
                title: '등록된 이슈가 아직 없어요',
                description: 'AI가 주기적으로 뉴스·검색 급상승·커뮤니티 화제를 찾아 위에 「확인 대기」로 담아 둡니다. 직접 적어 둘 수도 있어요.',
              }}
          />

          <ListPager query={query} total={signalsAll.length} onChange={set} />
        </>
      )}

      <DetailSheet contentId={openId} workspaceId={p.workspaceId}
        onClose={closeDetail}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)} />

      {/* 성공 공식의 "근거 N건"을 실제로 여는 자리. 숫자만 보여주고 못 열면 "믿어라"와 같다. */}
      {openDiscovery && (
        <DiscoveryEvidenceSheet
          discoveryId={openDiscovery.id}
          workspaceId={p.workspaceId}
          statement={openDiscovery.statement}
          onClose={() => setOpenDiscovery(null)}
        />
      )}
    </>
  )
}
