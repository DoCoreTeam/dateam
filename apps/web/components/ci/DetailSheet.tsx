'use client'

// components/ci/DetailSheet.tsx — 콘텐츠 상세 시트 (설계서 §5.4 / §7.4)
// "전 화면 공용, 중복 구현 금지" — 수집함·트렌드·홈·성과 어디서든 이 컴포넌트로만 열린다.
// 화면마다 상세 뷰를 다시 만들면 표시 규칙이 갈라진다.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import type { CiContentListItem, CiEvidence, ApiResponse } from '@/lib/ci/contracts'
import MetricBadge, { MetricBasis } from './MetricBadge'
import { ComparabilityBadge, CompletenessBadge, ConfidenceBadge, IngestStatusBadge } from './StatusBadge'
import { ErrorState, RowSkeleton } from './states'
import EvidenceSheet from './EvidenceSheet'

type Tab = 'analysis' | 'group' | 'channel' | 'ingest'

const TABS: { id: Tab; label: string }[] = [
  { id: 'analysis', label: '분석' },
  { id: 'group', label: '같은 소재 묶음' },
  { id: 'channel', label: '채널' },
  { id: 'ingest', label: '수집 정보' },
]

export interface DetailSheetData extends CiContentListItem {
  caption: string | null
  /** 근거가 부족하면 서버가 null을 준다 — 단정 문구를 만들지 않는다(§7.4) */
  analysis: string | null
  groupSiblings: { id: string; platform: string; title: string | null }[]
  provenanceMethod: string | null
  fetchedAt: string | null
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

  // 근거 시트가 열려 있으면 ESC는 그쪽이 먼저 받는다(중첩 모달 규약)
  useEscClose(onClose, !showEvidence)

  useEffect(() => {
    if (!contentId) return
    let cancelled = false
    setLoading(true); setError(null); setTab('analysis')

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
          {loading && <RowSkeleton rows={5} />}
          {error && <ErrorState code={error.code} message={error.message} />}

          {data && !loading && (
            <>
              {data.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ci-thumb" src={data.thumbnailUrl} alt="" width={640} height={360} />
              )}
              <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, margin: 'var(--space-3) 0 var(--space-2)' }}>
                {data.title ?? '제목 없음'}
              </h3>
              <p className="ci-card-meta">
                <span>{CI_PLATFORM_LABEL[data.platform]}</span>
                {data.channelName && <span>{data.channelName}</span>}
                {data.publishedAtText && <span>{data.publishedAtText}</span>}
              </p>

              <div className="ci-card-badges" style={{ margin: 'var(--space-3) 0' }}>
                <MetricBadge text={data.outlierText} strong onOpenEvidence={openEvidence} />
                <MetricBadge text={data.percentileText} onOpenEvidence={openEvidence} />
                <ConfidenceBadge confidence={data.confidence} />
                <ComparabilityBadge cls={data.comparability} />
                <CompletenessBadge
                  completeness={data.completeness}
                  missingFields={data.missingFields}
                  onOpenMissing={openEvidence}
                />
                <IngestStatusBadge status={data.ingestStatus} />
              </div>

              <div role="tablist" className="ci-stage-nav" style={{ marginBottom: 'var(--space-3)' }}>
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    className="ci-stage-item"
                    aria-selected={tab === t.id}
                    aria-current={tab === t.id ? 'page' : undefined}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'analysis' && (
                data.analysis
                  ? <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7 }}>{data.analysis}</p>
                  : (
                    <p className="ci-empty-desc">
                      아직 근거가 충분하지 않아 분석을 단정하지 않습니다. 비교 표본이 쌓이면 표시됩니다.
                    </p>
                  )
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
                  : <p className="ci-empty-desc">같은 소재로 묶인 다른 게시물이 없습니다.</p>
              )}

              {tab === 'channel' && (
                data.channelName
                  ? <p style={{ fontSize: 'var(--fs-sm)' }}>{data.channelName}</p>
                  : <p className="ci-empty-desc">채널 정보를 아직 확보하지 못했습니다.</p>
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
