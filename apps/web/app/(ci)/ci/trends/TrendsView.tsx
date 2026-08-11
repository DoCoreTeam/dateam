'use client'

// app/(ci)/ci/trends/TrendsView.tsx — R04 트렌드 (시장·떡상·성공 공식·이슈)
// 조건 바는 URL 상태로 보존한다 — 공유 가능한 뷰가 이 제품의 관례다.

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { ApiResponse, CiContentListItem } from '@/lib/ci/contracts'
import type { MarketOverview, PatternRow, SignalRow } from '@/lib/ci/queries/trends'
import { CI_PLATFORMS, CI_PLATFORM_LABEL } from '@/lib/ci/types'
import CiPageHeader from '@/components/ci/CiPageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import { ConfidenceBadge } from '@/components/ci/StatusBadge'
import { EmptyState, InsufficientData, ErrorState } from '@/components/ci/states'
import { MetricBasis } from '@/components/ci/MetricBadge'

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
  patterns: PatternRow[] | null
  signals: SignalRow[] | null
}

export default function TrendsView(p: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  const [sKind, setSKind] = useState('news')
  const [sTitle, setSTitle] = useState('')
  const [sUrl, setSUrl] = useState('')

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/ci/trends?${params}`, { scroll: false })
  }

  async function recomputePatterns() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/patterns/recompute', {
        method: 'POST', headers: { 'X-CI-Workspace': p.workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<unknown>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
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

  async function removeSignal(id: string) {
    await fetch(`/api/ci/signals?id=${id}`, { method: 'DELETE', headers: { 'X-CI-Workspace': p.workspaceId } })
    router.refresh()
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

  return (
    <>
      <CiPageHeader
        title="트렌드"
        desc="시장에서 지금 무엇이 통하는지"
        stageNav={<StageNav stages={RESEARCH_STAGES} />}
      />

      <div role="tablist" className="ci-stage-nav" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" className="ci-stage-item"
            aria-selected={p.tab === t.id} aria-current={p.tab === t.id ? 'page' : undefined}
            onClick={() => setParam('tab', t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} /></div>}

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
              description="관심 채널을 등록하면 그 채널의 게시물이 모여 시장 그림이 만들어집니다."
              action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
            />
          ) : (
            <>
              <section style={{ marginBottom: 'var(--space-6)' }}>
                <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>플랫폼별</h2>
                <table className="table-base table-card">
                  <thead><tr><th>플랫폼</th><th>건수</th><th>비중</th><th>평소 대비 중앙값</th></tr></thead>
                  <tbody>
                    {p.market.byPlatform.map((s) => (
                      <tr key={s.label}>
                        <td className="card-header">{s.label}</td>
                        <td data-label="건수"><span className="ci-num">{s.count}</span></td>
                        <td data-label="비중"><span className="ci-num">{s.share}%</span></td>
                        <td data-label="평소 대비 중앙값">{s.medianOutlierText ?? <span className="ci-basis">비교 이력 부족</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section style={{ marginBottom: 'var(--space-6)' }}>
                <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>포맷별</h2>
                <table className="table-base table-card">
                  <thead><tr><th>포맷</th><th>건수</th><th>비중</th><th>평소 대비 중앙값</th></tr></thead>
                  <tbody>
                    {p.market.byFormat.map((s) => (
                      <tr key={s.label}>
                        <td className="card-header">{s.label}</td>
                        <td data-label="건수"><span className="ci-num">{s.count}</span></td>
                        <td data-label="비중"><span className="ci-num">{s.share}%</span></td>
                        <td data-label="평소 대비 중앙값">{s.medianOutlierText ?? <span className="ci-basis">비교 이력 부족</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>많이 올린 채널</h2>
                {p.market.topChannels.length === 0 ? (
                  <p className="ci-empty-desc">채널 정보를 아직 확보하지 못했습니다.</p>
                ) : (
                  <table className="table-base table-card">
                    <thead><tr><th>채널</th><th>게시물</th><th>평소 대비 중앙값</th></tr></thead>
                    <tbody>
                      {p.market.topChannels.map((c) => (
                        <tr key={c.id}>
                          <td className="card-header">{c.name}</td>
                          <td data-label="게시물"><span className="ci-num">{c.count}</span></td>
                          <td data-label="평소 대비 중앙값">{c.medianOutlierText ?? <span className="ci-basis">비교 이력 부족</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
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
              <div className="ci-card-grid">
                {p.items.map((item) => (
                  <ContentCard key={item.id} item={item} onOpen={setOpenId}
                    onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
                    onAddToBoard={(id) => router.push(`/ci/boards?add=${id}`)} />
                ))}
              </div>
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

          {p.patterns.length === 0 ? (
            <EmptyState
              title="아직 공식으로 부를 만한 패턴이 없습니다"
              description="근거 20개·채널 5곳을 넘고 효과가 1.2배 이상일 때만 공식으로 승격합니다. 한 채널의 우연을 공식으로 팔지 않기 위해서입니다."
              action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
            />
          ) : (
            <table className="table-base table-card">
              <thead><tr><th>공식</th><th>효과와 근거</th><th>주제</th><th>신뢰도</th></tr></thead>
              <tbody>
                {p.patterns.map((pt) => (
                  <tr key={pt.id}>
                    <td className="card-header"><strong>{pt.statement}</strong></td>
                    <td data-label="효과와 근거">{pt.liftText ?? <span className="ci-basis">근거 부족</span>}</td>
                    <td data-label="주제">{pt.topicName ?? '전체'}</td>
                    <td data-label="신뢰도"><ConfidenceBadge confidence={pt.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ── 이슈 ── */}
      {p.tab === 'signals' && p.signals && (
        <>
          <section style={{
            display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end',
            padding: 'var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)',
            borderRadius: 'var(--radius)', background: 'var(--color-surface)', marginBottom: 'var(--space-4)',
          }}>
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

          {p.signals.length === 0 ? (
            <EmptyState
              title="등록된 이슈가 없습니다"
              description="뉴스·검색 급상승·커뮤니티 화제처럼 콘텐츠 소재가 될 만한 것을 위에서 기록해 두면 기획할 때 근거로 씁니다."
            />
          ) : (
            <table className="table-base table-card">
              <thead><tr><th>이슈</th><th>종류</th><th>주제</th><th>시점</th><th>작업</th></tr></thead>
              <tbody>
                {p.signals.map((s) => (
                  <tr key={s.id}>
                    <td className="card-header">
                      {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : <strong>{s.title}</strong>}
                    </td>
                    <td data-label="종류">{SIGNAL_KINDS.find((k) => k.id === s.kind)?.label ?? s.kind}</td>
                    <td data-label="주제">{s.topicName ?? '전체'}</td>
                    <td data-label="시점">{s.occurredAtText ?? '—'}</td>
                    <td className="card-actions">
                      <button type="button" className="btn-ghost" onClick={() => removeSignal(s.id)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <DetailSheet contentId={openId} workspaceId={p.workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)} />
    </>
  )
}
