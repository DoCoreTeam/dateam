'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import { ConfidenceBadge } from '@/components/ci/StatusBadge'
import { EmptyState, InsufficientData } from '@/components/ci/states'
import type { MinePerf, MarketPerf, LearningPerf } from '@/lib/ci/queries/performance'

const TABS = [
  { id: 'mine', label: '내 콘텐츠' },
  { id: 'market', label: '시장 대비' },
  { id: 'learning', label: '학습' },
] as const

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

  function go(id: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set('tab', id)
    router.push(`/ci/performance?${p}`, { scroll: false })
  }

  return (
    <>
      <div role="tablist" className="ci-stage-nav" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" className="ci-stage-item"
            aria-selected={tab === t.id} aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine' && mine && (
        mine.rows.length === 0 ? (
          <EmptyState
            title="아직 추적 중인 내 게시물이 없습니다"
            description="게시에서 주소를 입력하면 그 시점부터 성과가 쌓입니다. 과거 게시물도 주소만 붙여넣으면 소급 추적됩니다."
            action={{ label: '게시로 이동', href: '/ci/publish' }}
          />
        ) : (
          <>
            <section style={{
              display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap',
              padding: 'var(--space-4)', border: 'var(--border-w-2) solid var(--border-color)',
              borderRadius: 'var(--radius)', background: 'var(--color-surface)', marginBottom: 'var(--space-4)',
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

            <table className="table-base table-card">
              <thead>
                <tr><th>제목</th><th>플랫폼</th><th>게시일</th><th>조회수</th><th>평소 대비</th><th>상위</th><th>신뢰도</th></tr>
              </thead>
              <tbody>
                {mine.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="card-header"><strong>{r.title ?? '제목 없음'}</strong></td>
                    <td data-label="플랫폼">{CI_PLATFORM_LABEL[r.platform]}</td>
                    <td data-label="게시일">{r.publishedAtText ?? <span className="ci-basis">미확인</span>}</td>
                    <td data-label="조회수">
                      {r.views != null ? <span className="ci-num">{r.views.toLocaleString('ko-KR')}</span>
                        : <span className="ci-basis">—</span>}
                    </td>
                    <td data-label="평소 대비">
                      {r.outlierText ?? <span className="ci-basis" title="비교 이력이 8개 미만입니다">—</span>}
                    </td>
                    <td data-label="상위">{r.percentileText ?? <span className="ci-basis">—</span>}</td>
                    <td data-label="신뢰도"><ConfidenceBadge confidence={r.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      )}

      {tab === 'market' && market && (
        market.insufficient ? (
          <InsufficientData what="시장 비교" action={{ label: '관심 채널 추가', href: '/ci/monitoring' }} />
        ) : (
          <>
            <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>{market.basisText}</p>
            <table className="table-base table-card">
              <thead><tr><th>콘텐츠</th><th>평소 대비</th></tr></thead>
              <tbody>
                {market.topPeers.map((p) => (
                  <tr key={p.id}>
                    <td className="card-header">{p.title ?? '제목 없음'}</td>
                    <td data-label="평소 대비">{p.outlierText ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              <p className="ci-empty-desc">
                공식으로 부를 만한 반복 패턴이 아직 없습니다. 근거 20개·채널 5곳을 넘어야 공식으로 승격합니다.
              </p>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {learning.patterns.map((p) => (
                  <li key={p.id} style={{
                    padding: 'var(--space-3)', border: 'var(--border-w-2) solid var(--border-color)',
                    borderRadius: 'var(--radius)', background: 'var(--color-surface)',
                  }}>
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
              <p className="ci-empty-desc">아직 정정한 내역이 없습니다. 분류를 고치면 다음 추천에 반영됩니다.</p>
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
                  <li key={p.topicId} className="ci-empty-desc">{p.suggestion}</li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              분류 품질
            </h2>
            {learning.slo.total === 0 ? (
              <p className="ci-empty-desc">아직 분류한 콘텐츠가 없어 비율을 계산하지 않습니다.</p>
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
