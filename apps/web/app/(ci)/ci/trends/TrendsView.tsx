'use client'

// app/(ci)/ci/trends/TrendsView.tsx — R04 트렌드 뷰 (설계서 §7.3)
// 조건 바는 URL 상태로 보존한다 — 공유 가능한 뷰가 이 제품의 관례다.

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CiContentListItem } from '@/lib/ci/contracts'
import { CI_PLATFORMS, CI_PLATFORM_LABEL } from '@/lib/ci/types'
import CiPageHeader from '@/components/ci/CiPageHeader'
import StageNav, { RESEARCH_STAGES } from '@/components/ci/StageNav'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import { EmptyState, InsufficientData } from '@/components/ci/states'
import { MetricBasis } from '@/components/ci/MetricBadge'

type Tab = 'market' | 'outliers' | 'patterns' | 'signals'

const TABS: { id: Tab; label: string }[] = [
  { id: 'market', label: '시장' },
  { id: 'outliers', label: '떡상' },
  { id: 'patterns', label: '성공 공식' },
  { id: 'signals', label: '이슈' },
]

const SORTS: { id: string; label: string }[] = [
  { id: 'outlier', label: '평소 대비 높은 순' },
  { id: 'recent', label: '최신순' },
  { id: 'velocity', label: '조회 속도순' },
]

const FORMATS: { id: string; label: string }[] = [
  { id: '', label: '전체' },
  { id: 'short', label: '숏폼' },
  { id: 'long', label: '롱폼' },
  { id: 'image', label: '이미지' },
  { id: 'text', label: '텍스트' },
]

const WINDOWS = [7, 28, 90]

interface TrendsViewProps {
  workspaceId: string
  tab: Tab
  items: CiContentListItem[]
  population: number
  windowDays: number
  sort: string
  platform: string
  format: string
  basisText: string
}

export default function TrendsView(p: TrendsViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(null)

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/ci/trends?${params}`, { scroll: false })
  }

  return (
    <>
      <CiPageHeader
        title="트렌드"
        desc="시장에서 지금 무엇이 통하는지"
        stageNav={<StageNav stages={RESEARCH_STAGES} />}
      />

      <div role="tablist" className="ci-stage-nav" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            className="ci-stage-item"
            aria-selected={p.tab === t.id}
            aria-current={p.tab === t.id ? 'page' : undefined}
            onClick={() => setParam('tab', t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {p.tab === 'outliers' ? (
        <>
          <div style={{
            display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap',
            alignItems: 'center', marginBottom: 'var(--space-4)',
          }}>
            <label className="label" htmlFor="ci-f-platform" style={{ margin: 0 }}>플랫폼</label>
            <select className="input-field" id="ci-f-platform" style={{ width: 'auto' }}
              value={p.platform} onChange={(e) => setParam('platform', e.target.value)}
            >
              <option value="">전체</option>
              {CI_PLATFORMS.map((pl) => (
                <option key={pl} value={pl}>{CI_PLATFORM_LABEL[pl]}</option>
              ))}
            </select>

            <label className="label" htmlFor="ci-f-format" style={{ margin: 0 }}>포맷</label>
            <select className="input-field" id="ci-f-format" style={{ width: 'auto' }}
              value={p.format} onChange={(e) => setParam('format', e.target.value)}
            >
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>

            <label className="label" htmlFor="ci-f-window" style={{ margin: 0 }}>기간</label>
            <select className="input-field" id="ci-f-window" style={{ width: 'auto' }}
              value={String(p.windowDays)} onChange={(e) => setParam('windowDays', e.target.value)}
            >
              {WINDOWS.map((w) => <option key={w} value={w}>{w}일</option>)}
            </select>

            <label className="label" htmlFor="ci-f-sort" style={{ margin: 0 }}>정렬</label>
            <select className="input-field" id="ci-f-sort" style={{ width: 'auto' }}
              value={p.sort} onChange={(e) => setParam('sort', e.target.value)}
            >
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

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
                  <InsufficientData
                    what="같은 주제 상위 %"
                    action={{ label: '관심 채널 추가', href: '/ci/monitoring' }}
                  />
                </div>
              )}
              <div className="ci-card-grid">
                {p.items.map((item) => (
                  <ContentCard
                    key={item.id}
                    item={item}
                    onOpen={setOpenId}
                    onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
                    onAddToBoard={(id) => router.push(`/ci/boards?add=${id}`)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <EmptyState
          title={`${TABS.find((t) => t.id === p.tab)?.label} 탭은 아직 준비 중입니다`}
          description="이번 단계에서는 떡상 탭을 먼저 실동작시켰습니다. 없는 기능을 있는 것처럼 보여주지 않습니다."
          action={{ label: '떡상 보기', href: '/ci/trends?tab=outliers' }}
        />
      )}

      <DetailSheet
        contentId={openId}
        workspaceId={p.workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />
    </>
  )
}
