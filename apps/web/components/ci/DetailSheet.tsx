'use client'

// components/ci/DetailSheet.tsx — 콘텐츠 상세 시트 (설계서 §5.4 / §7.4)
// "전 화면 공용, 중복 구현 금지" — 수집함·트렌드·홈·성과 어디서든 이 컴포넌트로만 열린다.
// 화면마다 상세 뷰를 다시 만들면 표시 규칙이 갈라진다.

import { useEffect, useState } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import Link from 'next/link'
import { X, Pencil } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { isEnterKey } from '@/lib/ui/ime'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import type { CiContentListItem, CiEvidence, ApiResponse } from '@/lib/ci/contracts'
import MetricBadge, { MetricBasis } from './MetricBadge'
import CreativeSummary from './CreativeSummary'
import { ComparabilityBadge, MissingFieldsBadge, ConfidenceBadge, IngestStatusBadge } from './StatusBadge'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import EvidenceSheet from './EvidenceSheet'

type Tab = 'meta' | 'analysis' | 'group' | 'ingest'

const TABS: { id: Tab; label: string }[] = [
  { id: 'meta', label: '메타 정보' },
  { id: 'analysis', label: '분석' },
  { id: 'group', label: '같은 소재 묶음' },
  { id: 'ingest', label: '수집 정보' },
]

export interface DetailSheetData extends CiContentListItem {
  caption: string | null
  /** 통계에서 빠져 있는가 — 삭제와 다른 일이다(행은 남고 집계에서만 빠진다) */
  isStatExcluded: boolean
  /** 근거가 부족하면 서버가 null을 준다 — 단정 문구를 만들지 않는다(§7.4) */
  analysis: string | null
  groupSiblings: { id: string; platform: string; title: string | null }[]
  provenanceMethod: string | null
  fetchedAt: string | null
  keywords: string[]
  durationText: string | null
  language: string | null
  metrics: {
    viewsText: string | null
    likesText: string | null
    commentsText: string | null
    capturedAtText: string | null
    sourceMethod: string | null
    isEstimated: boolean
  } | null
}

interface DetailSheetProps {
  contentId: string | null
  workspaceId: string
  onClose: () => void
  onNextStep?: (id: string) => void
  onAddToBoard?: (id: string) => void
}

export default function DetailSheet({
  contentId, workspaceId, onClose, onNextStep, onAddToBoard,
}: DetailSheetProps) {
  const [tab, setTab] = useState<Tab>('analysis')
  const [data, setData] = useState<DetailSheetData | null>(null)
  const [evidence, setEvidence] = useState<CiEvidence | null>(null)
  const [showEvidence, setShowEvidence] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  // 제목 고치기 — AI가 붙인 제목이 틀리거나 비어 있을 때 사람이 바로잡는다.
  // 다른 값은 여기서 못 고친다: 주제·통계 제외는 전용 경로가 정정 이력을 남기고,
  // 조회수·게시일 같은 수집값은 고치는 순간 배수가 거짓이 되기 때문이다.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)

  // 통계 제외 — 지우는 게 아니라 **집계에서만 빼는** 별개의 일이다.
  // 잘못 수집돼 배수를 흐리는 게시물을, 기록은 남긴 채 통계에서만 제외한다.
  // 전용 경로(POST .../exclude)를 쓴다 — 그 경로가 제외 사유를 정정 이력에 남긴다.
  const [excluding, setExcluding] = useState(false)
  const [excludeError, setExcludeError] = useState<string | null>(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonDraft, setReasonDraft] = useState('')

  async function setExcluded(next: boolean, reason?: string) {
    if (!contentId) return
    setExcluding(true); setExcludeError(null)
    try {
      const res = await fetch(`/api/ci/contents/${contentId}/exclude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ excluded: next, reason: reason?.trim() || undefined }),
      }).then((r) => r.json() as Promise<ApiResponse<{ excluded: boolean }>>)
      if (!res.success) { setExcludeError(res.error.message); return }
      setData((prev) => (prev ? { ...prev, isStatExcluded: res.data.excluded } : prev))
      setReasonOpen(false); setReasonDraft('')
    } catch {
      setExcludeError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setExcluding(false)
    }
  }

  async function saveTitle() {
    if (!contentId) return
    const next = titleDraft.trim()
    if (!next) { setTitleError('제목을 입력해 주세요'); return }
    setSavingTitle(true); setTitleError(null)
    try {
      const res = await fetch(`/api/ci/contents/${contentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ title: next }),
      }).then((r) => r.json() as Promise<ApiResponse<{ title: string }>>)
      if (!res.success) { setTitleError(res.error.message); return }
      // 서버가 돌려준 값으로 화면을 맞춘다 — 내가 보낸 값을 그대로 믿지 않는다
      setData((prev) => (prev ? { ...prev, title: res.data.title } : prev))
      setEditingTitle(false)
    } catch {
      setTitleError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setSavingTitle(false)
    }
  }

  // 근거 시트가 열려 있으면 ESC는 그쪽이 먼저 받는다(중첩 모달 규약)
  useEscClose(onClose, !showEvidence)

  useEffect(() => {
    if (!contentId) return
    let cancelled = false
    setLoading(true); setError(null); setTab('meta')

    fetch(`/api/ci/contents/${contentId}`, { headers: { 'X-CI-Workspace': workspaceId } })
      .then((r) => r.json() as Promise<ApiResponse<DetailSheetData>>)
      .then((res) => {
        if (cancelled) return
        if (res.success) setData(res.data)
        else setError({ code: res.error.code, message: res.error.message })
      })
      .catch(() => {
        if (!cancelled) setError({ code: 'INTERNAL', message: '상세 정보를 불러오지 못했습니다' })
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [contentId, workspaceId])

  async function openEvidence() {
    if (!contentId) return
    setShowEvidence(true)
    if (evidence) return
    const res = await fetch(`/api/ci/contents/${contentId}/evidence`, {
      headers: { 'X-CI-Workspace': workspaceId },
    }).then((r) => r.json() as Promise<ApiResponse<CiEvidence>>).catch(() => null)
    if (res?.success) setEvidence(res.data)
  }

  if (!contentId) return null

  return (
    <div className="ci-sheet-backdrop" onClick={onClose} role="presentation">
      <aside
        className="ci-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="콘텐츠 상세"
      >
        <header className="ci-sheet-head">
          <h2 className="tape-title" style={{ margin: 0 }}>콘텐츠 상세</h2>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </header>

        <div className="ci-sheet-body">
          {loading && <SkelList rows={5} />}
          {error && <ErrorState code={error.code} message={error.message} helpHref="/ci/settings" />}

          {data && !loading && (
            <>
              {data.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ci-thumb" src={data.thumbnailUrl} alt="" width={640} height={360} />
              )}
              {editingTitle ? (
                <div style={{ margin: 'var(--space-3) 0 var(--space-2)' }}>
                  <label className="label" htmlFor="ci-title-edit" style={{ position: 'absolute', left: '-9999px' }}>
                    제목
                  </label>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
                    <input className="input-field" id="ci-title-edit"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // 한글 조합 중 엔터가 두 번 먹는 것을 막는다(공용 IME 가드)
                        if (isEnterKey(e)) { e.preventDefault(); void saveTitle() }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false) }
                      }}
                      disabled={savingTitle}
                      autoFocus
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn-primary" onClick={saveTitle} disabled={savingTitle}>
                      {savingTitle ? '저장 중…' : '저장'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setEditingTitle(false)} disabled={savingTitle}>
                      취소
                    </button>
                  </div>
                  {titleError && <p className="ci-status ci-status-danger" role="alert">{titleError}</p>}
                </div>
              ) : (
                <h3 style={{
                  fontSize: 'var(--fs-lg)', fontWeight: 700, margin: 'var(--space-3) 0 var(--space-2)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                }}>
                  <span>{data.title ?? '제목 없음'}</span>
                  <button type="button" className="btn-ghost"
                    onClick={() => { setTitleDraft(data.title ?? ''); setTitleError(null); setEditingTitle(true) }}
                    aria-label="제목 고치기" title="제목 고치기">
                    <Pencil size={14} />
                  </button>
                </h3>
              )}
              <p className="ci-card-meta">
                <span>{CI_PLATFORM_LABEL[data.platform]}</span>
                {/* 채널을 누르면 채널 상세로 — 콘텐츠에서 채널로 가는 길을 끊지 않는다 */}
                {data.channelName && (
                  data.channelId
                    ? (
                      <Link href={`/ci/channels/${data.channelId}`} style={{ color: 'var(--brand)' }}>
                        {data.channelName}
                      </Link>
                    )
                    : <span>{data.channelName}</span>
                )}
                {data.publishedAtText && <span>{data.publishedAtText}</span>}
                {data.durationText && <span>{data.durationText}</span>}
                <a href={data.canonicalUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                  원본 열기
                </a>
              </p>

              <div className="ci-card-badges" style={{ margin: 'var(--space-3) 0' }}>
                <MetricBadge text={data.outlierText} strong onOpenEvidence={openEvidence} />
                <MetricBadge text={data.percentileText} onOpenEvidence={openEvidence} />
                <ConfidenceBadge confidence={data.confidence} />
                <ComparabilityBadge cls={data.comparability} />
                <MissingFieldsBadge
                  status={data.ingestStatus}
                  missingFields={data.missingFields}
                  onOpenMissing={openEvidence}
                />
                <IngestStatusBadge status={data.ingestStatus} />
                {data.isStatExcluded && (
                  <span className="ci-status ci-status-warn" title="이 게시물은 배수·백분위 같은 집계에 들어가지 않습니다">
                    통계 제외됨
                  </span>
                )}
              </div>

              {/* 통계 제외 — 지우는 것과 다른 일이다. 기록은 남기고 집계에서만 뺀다.
                  잘못 수집돼 배수를 흐리는 게시물을 없애지 않고 바로잡는 길이다. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                flexWrap: 'wrap', marginBottom: 'var(--space-3)',
              }}>
                {data.isStatExcluded ? (
                  <>
                    <span className="ci-basis">이 게시물은 통계에서 빠져 있습니다</span>
                    <button type="button" className="btn-ghost"
                      onClick={() => setExcluded(false)} disabled={excluding}>
                      {excluding ? '되돌리는 중…' : '다시 넣기'}
                    </button>
                  </>
                ) : reasonOpen ? (
                  <>
                    <label className="label" htmlFor="ci-exclude-reason" style={{ position: 'absolute', left: '-9999px' }}>
                      제외 사유
                    </label>
                    <input className="input-field" id="ci-exclude-reason"
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (isEnterKey(e)) { e.preventDefault(); void setExcluded(true, reasonDraft) }
                        if (e.key === 'Escape') { e.preventDefault(); setReasonOpen(false) }
                      }}
                      placeholder="왜 빼는지 (선택)"
                      disabled={excluding}
                      autoFocus
                      style={{ flex: 1, minWidth: '200px' }}
                    />
                    <button type="button" className="btn-primary"
                      onClick={() => setExcluded(true, reasonDraft)} disabled={excluding}>
                      {excluding ? '빼는 중…' : '통계에서 빼기'}
                    </button>
                    <button type="button" className="btn-ghost"
                      onClick={() => setReasonOpen(false)} disabled={excluding}>취소</button>
                  </>
                ) : (
                  <button type="button" className="btn-ghost"
                    onClick={() => { setExcludeError(null); setReasonDraft(''); setReasonOpen(true) }}
                    title="지우지 않고 집계에서만 뺍니다">
                    통계에서 빼기
                  </button>
                )}
                {excludeError && <span className="ci-status ci-status-danger" role="alert">{excludeError}</span>}
              </div>

              <SegmentedTabs
                ariaLabel="상세 보기"
                tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
                activeId={tab}
                onSelect={(id) => setTab(id as typeof tab)}
              />

              {tab === 'meta' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <dl className="ci-meta-grid">
                    <div className="ci-meta-cell">
                      <dt className="ci-basis">조회수</dt>
                      <dd className="ci-metric-big">{data.metrics?.viewsText ?? '미확보'}</dd>
                    </div>
                    <div className="ci-meta-cell">
                      <dt className="ci-basis">좋아요</dt>
                      <dd className="ci-metric-big">{data.metrics?.likesText ?? '미확보'}</dd>
                    </div>
                    <div className="ci-meta-cell">
                      <dt className="ci-basis">댓글</dt>
                      <dd className="ci-metric-big">{data.metrics?.commentsText ?? '미확보'}</dd>
                    </div>
                    <div className="ci-meta-cell">
                      <dt className="ci-basis">길이</dt>
                      <dd className="ci-metric-big">{data.durationText ?? '미확보'}</dd>
                    </div>
                  </dl>
                  {data.metrics?.capturedAtText && (
                    <p className="ci-basis">
                      지표 확인 {data.metrics.capturedAtText}
                      {data.metrics.sourceMethod ? ` · ${data.metrics.sourceMethod}` : ''}
                      {data.metrics.isEstimated ? ' · 추정값' : ''}
                    </p>
                  )}

                  <section>
                    <h4 className="ci-creative-head">키워드</h4>
                    {data.keywords.length > 0 ? (
                      <div className="ci-card-badges" style={{ marginTop: 'var(--space-2)' }}>
                        {data.keywords.map((k) => (
                          <span key={k} className="ci-status ci-status-neutral">{k}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state-desc">
                        이 게시물에서 키워드를 확보하지 못했습니다. 업로더가 붙이지 않았거나
                        플랫폼이 공개하지 않는 경우입니다.
                      </p>
                    )}
                  </section>

                  <section>
                    <h4 className="ci-creative-head">설명문</h4>
                    {data.caption ? (
                      <p className="ci-caption">{data.caption}</p>
                    ) : (
                      <p className="empty-state-desc">설명문을 확보하지 못했습니다.</p>
                    )}
                  </section>
                </div>
              )}

              {tab === 'analysis' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {data.analysis && (
                    <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7 }}>{data.analysis}</p>
                  )}
                  <CreativeSummary creative={data.creative} />
                  {!data.analysis && !data.creative && (
                    <EmptyState
                      title="아직 근거가 충분하지 않아 분석을 단정하지 않습니다"
                      description="비교 표본이 쌓이고 평소 대비 1.5배를 넘으면 무엇이 통했는지 분석합니다."
                    />
                  )}
                </div>
              )}

              {tab === 'group' && (
                data.groupSiblings.length > 0
                  ? (
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {data.groupSiblings.map((s) => (
                        <li key={s.id} className="ci-card-meta">{s.platform} · {s.title ?? '제목 없음'}</li>
                      ))}
                    </ul>
                  )
                  : <EmptyState title="같은 소재로 묶인 다른 게시물이 없습니다" />
              )}

              {tab === 'ingest' && (
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2)', fontSize: 'var(--fs-sm)' }}>
                  <dt className="ci-basis">수집 방법</dt><dd>{data.provenanceMethod ?? '—'}</dd>
                  <dt className="ci-basis">수집 시각</dt><dd>{data.fetchedAt ?? '—'}</dd>
                  <dt className="ci-basis">미확보 항목</dt>
                  <dd>{data.missingFields.length ? data.missingFields.join(', ') : '없음'}</dd>
                </dl>
              )}

              {evidence && <MetricBasis text={evidence.basisText} />}
            </>
          )}
        </div>

        <footer className="ci-sheet-foot">
          {onNextStep && (
            <button type="button" className="btn-primary" onClick={() => onNextStep(contentId)}>
              아이디어 만들기
            </button>
          )}
          {onAddToBoard && (
            <button type="button" className="btn-ghost" onClick={() => onAddToBoard(contentId)}>
              보드 담기
            </button>
          )}
        </footer>
      </aside>

      {showEvidence && (
        <EvidenceSheet evidence={evidence} onClose={() => setShowEvidence(false)} />
      )}
    </div>
  )
}
