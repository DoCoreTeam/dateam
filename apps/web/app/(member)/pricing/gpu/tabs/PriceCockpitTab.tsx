'use client'

// tabs/PriceCockpitTab.tsx — 가격 콕핏 전면 재설계 v2
//
// F1: 컬럼 재구성 (쉬운 라벨 — 막무가내 용어 0)
// F2: 검색(debounce) + 필터(Tier/미설정) + 정렬(헤더 클릭) + URL 동기화
// F3: 셀 클릭 즉시 펼침 + 관장 화면 이동
// F4: 디자인 토큰 전용 — 인라인 style 0, table-card 반응형

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import useSWR, { useSWRConfig } from 'swr'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'
import { fmtKRW } from '@/lib/gpu/format-price'
import { GpuModelName } from '@/components/pricing/gpu/GpuModelName'
import { buildTierModelGroups, tierKey, modelKey, TIER_META } from '@/lib/gpu/group'
import { useCollapsibleGroups } from '@/hooks/useCollapsibleGroups'

import type {
  CockpitProduct,
  CockpitResponse,
  ExpandSection,
  SortConfig,
  SortKey,
} from '@/components/pricing/gpu/cockpit/types'
import type { GcubeCheckItem } from '@/app/api/pricing/gpu/gcube-check/route'
import { StrategicCell } from '@/components/pricing/gpu/cockpit/StrategicCell'
import { GcubeSiteCell } from '@/components/pricing/gpu/cockpit/GcubeSiteCell'
import { CandidateCell } from '@/components/pricing/gpu/cockpit/CandidateCell'
import { SortIcon } from '@/components/pricing/gpu/cockpit/SortIcon'
import { MarginBadge } from '@/components/pricing/gpu/cockpit/MarginBadge'
import {
  CostDrawer,
  CompetitorDrawer,
  GcubeDrawer,
  StrategicHistoryDrawer,
} from '@/components/pricing/gpu/cockpit/DrawerSections'

// ── 상수 ──────────────────────────────────────────────────────────

const DEBOUNCE_MS = 280

type TierFilter = 0 | 1 | 2 | 3
type SpecialFilter = 'all' | 'unset'

// ── 훅: 검색 디바운스 ─────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

// ── URL 상태 동기화 훅 ────────────────────────────────────────────

function useCockpitUrl() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const getParam = (key: string) => params.get(key) ?? ''

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === '') {
          next.delete(k)
        } else {
          next.set(k, v)
        }
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, router, pathname],
  )

  return { getParam, setParam }
}

// ── 행 컴포넌트 ───────────────────────────────────────────────────

interface CockpitRowProps {
  product: CockpitProduct
  isAdmin: boolean
  expandSection: ExpandSection
  activeCompetitor: string
  onExpand: (section: ExpandSection) => void
  onSelectCompetitor: (name: string) => void
  onSaved: () => void
  onGoToTab: (tab: string) => void
  /** gcube-check API에서 병합된 이 product의 반영 상태 */
  syncItem?: GcubeCheckItem
}

function CockpitRow({
  product: p,
  isAdmin,
  expandSection,
  activeCompetitor,
  onExpand,
  onSelectCompetitor,
  onSaved,
  onGoToTab,
  syncItem,
}: CockpitRowProps) {
  // 폴백: 새 BE 필드 없을 때 기존 BE 필드 사용
  const costMin = p.cost_min_krw ?? p.cost_krw ?? null
  const costMax = p.cost_max_krw ?? p.cost_krw ?? null
  const competitorMin = p.competitor_min_krw ?? p.market_min_krw ?? null
  const competitorMax = p.competitor_max_krw ?? p.market_max_krw ?? null
  const hasCompetitors = (p.competitors?.length ?? 0) > 0

  const patchedProduct: CockpitProduct = {
    ...p,
    cost_min_krw: costMin,
    cost_max_krw: costMax,
    competitor_min_krw: competitorMin,
    competitor_max_krw: competitorMax,
    competitors: p.competitors ?? [],
    cost_suppliers: p.cost_suppliers ?? [],
    strategic_history: p.strategic_history ?? [],
  }

  return (
    <React.Fragment>
      {/* ── 메인 행 ── */}
      <tr className="cockpit-row" aria-expanded={expandSection !== null}>
        {/* 모델·구성 */}
        <td className="card-header cockpit-th-left" data-label="모델·구성">
          <div className="cockpit-model-row">
            <div className="cockpit-model-cell">
              <GpuModelName modelName={p.model_name} gpuCount={p.gpu_count} />
              <span className="cockpit-model-sub">
                {p.memory} · Tier {p.tier}
              </span>
            </div>
          </div>
        </td>

        {/* gcube 사이트 가격 — 클릭 펼침 */}
        <td
          data-label="gcube 사이트 가격"
          className="cockpit-cell-clickable"
          onClick={() => onExpand(expandSection === 'gcube' ? null : 'gcube')}
        >
          <div className="cockpit-cell-inner">
            <GcubeSiteCell
              product={patchedProduct}
              isAdmin={isAdmin}
              onSaved={onSaved}
              syncItem={syncItem}
            />
            <ChevronDown
              size={12}
              className={`cockpit-cell-chevron${expandSection === 'gcube' ? ' cockpit-cell-chevron--open' : ''}`}
              aria-hidden
            />
          </div>
        </td>

        {/* 원가 (최저~최고) — 클릭 펼침 */}
        <td
          data-label="원가 (최저~최고)"
          className="cockpit-cell-clickable"
          onClick={() => onExpand(expandSection === 'cost' ? null : 'cost')}
        >
          <div className="cockpit-cell-inner">
            <div className="cockpit-range-cell">
              {costMin != null ? (
                <>
                  <span className="cockpit-price">{fmtKRW(costMin)}</span>
                  {costMax != null && costMax !== costMin && (
                    <>
                      <span className="cockpit-range-sep">~</span>
                      <span className="cockpit-price">{fmtKRW(costMax)}</span>
                    </>
                  )}
                  {(p.cost_is_propagated ?? p.is_propagated) && (
                    <span className="cockpit-estimate-badge" title="실제 견적 없음 — 상위 구성에서 전파된 추정 원가">
                      추정
                    </span>
                  )}
                  {p.cost_source === 'market_link' && (
                    <span className="cockpit-link-badge" title="경쟁사 공시가 기반 원가 (실제 매입 견적 아님)">
                      연계 원가
                    </span>
                  )}
                </>
              ) : (
                <span className="cockpit-price-sub">—</span>
              )}
            </div>
            <ChevronDown
              size={12}
              className={`cockpit-cell-chevron${expandSection === 'cost' ? ' cockpit-cell-chevron--open' : ''}`}
              aria-hidden
            />
          </div>
        </td>

        {/* 판매가 후보 — 클릭 = 이 값으로 지정 */}
        <td
          data-label="판매가 후보"
          onClick={(e) => e.stopPropagation()}
        >
          <CandidateCell
            product={patchedProduct}
            isAdmin={isAdmin}
            onPromoted={onSaved}
          />
        </td>

        {/* 경쟁사 가격 (최저~최고) — 클릭 펼침 */}
        <td
          data-label="경쟁사 가격 (최저~최고)"
          className={`cockpit-cell-clickable${hasCompetitors ? '' : ' cockpit-cell-no-expand'}`}
          onClick={() => {
            if (!hasCompetitors && competitorMin == null) return
            onExpand(expandSection === 'competitor' ? null : 'competitor')
          }}
        >
          <div className="cockpit-cell-inner">
            <div className="cockpit-range-cell">
              {competitorMin != null ? (
                <>
                  <span className="cockpit-price">{fmtKRW(competitorMin)}</span>
                  {competitorMax != null && competitorMax !== competitorMin && (
                    <>
                      <span className="cockpit-range-sep">~</span>
                      <span className="cockpit-price">{fmtKRW(competitorMax)}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="cockpit-price-sub">—</span>
              )}
            </div>
            {(hasCompetitors || competitorMin != null) && (
              <ChevronDown
                size={12}
                className={`cockpit-cell-chevron${expandSection === 'competitor' ? ' cockpit-cell-chevron--open' : ''}`}
                aria-hidden
              />
            )}
          </div>
        </td>

        {/* 우리 판매가 — 클릭 = 이력 펼침 / 연필 = 편집 */}
        <td
          data-label="우리 판매가"
          className="cockpit-cell-strategic"
        >
          <div className="cockpit-cell-inner">
            <StrategicCell
              product={patchedProduct}
              isAdmin={isAdmin}
              onSaved={onSaved}
            />
            <button
              className={`cockpit-history-toggle${expandSection === 'strategic' ? ' cockpit-history-toggle--open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onExpand(expandSection === 'strategic' ? null : 'strategic')
              }}
              aria-label="우리 판매가 변경 이력 보기"
              title="변경 이력"
            >
              <ChevronDown size={12} aria-hidden />
            </button>
          </div>
          {p.effective_margin_pct != null && (
            <div className="cockpit-strategic-meta">
              <MarginBadge
                pct={p.effective_margin_pct}
                label="시장에서 우리 위치를 정하는 가격 기준 마진"
              />
            </div>
          )}
        </td>
      </tr>

      {/* ── 펼침 드로어 ── */}
      {expandSection !== null && (
        <tr className="cockpit-drawer">
          <td colSpan={6} className="cockpit-drawer-td">
            {expandSection === 'cost' && (
              <CostDrawer
                product={patchedProduct}
                onGoToTab={onGoToTab}
              />
            )}
            {expandSection === 'competitor' && (
              <CompetitorDrawer
                product={patchedProduct}
                onGoToTab={onGoToTab}
                activeCompetitor={activeCompetitor}
                onSelectCompetitor={onSelectCompetitor}
              />
            )}
            {expandSection === 'gcube' && (
              <GcubeDrawer
                product={patchedProduct}
                onGoToTab={onGoToTab}
                syncItem={syncItem}
              />
            )}
            {expandSection === 'strategic' && (
              <StrategicHistoryDrawer product={patchedProduct} />
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────

interface PriceCockpitTabProps {
  isAdmin?: boolean
  /** GpuPricingClient에서 탭 전환 콜백 주입 */
  onGoToTab?: (tab: string) => void
}

export default function PriceCockpitTab({
  isAdmin = false,
  onGoToTab,
}: PriceCockpitTabProps) {
  const { data, isLoading, error, mutate } = useSWR<CockpitResponse>(
    '/api/pricing/gpu/cockpit',
    fetcher,
    { refreshInterval: 60000 },
  )
  // gcube 반영 상태 — 에러여도 UI 차단 않음 (안전 폴백: undefined)
  const { data: gcubeCheckData } = useSWR<{ items: GcubeCheckItem[] }>(
    '/api/pricing/gpu/gcube-check',
    fetcher,
    { refreshInterval: 300_000 }, // 5분마다 갱신 (비교적 정적 데이터)
  )
  const gcubeSyncMap = useMemo<Map<string, GcubeCheckItem>>(() => {
    const m = new Map<string, GcubeCheckItem>()
    for (const item of gcubeCheckData?.items ?? []) {
      m.set(item.product_id, item)
    }
    return m
  }, [gcubeCheckData])

  const { mutate: globalMutate } = useSWRConfig()
  const { getParam, setParam } = useCockpitUrl()

  // ── 필터·정렬·검색 상태 (URL 연동) ──────────────────────────
  const [search, setSearch] = useState(() => getParam('cq'))
  const [tierFilter, setTierFilter] = useState<TierFilter>(() => {
    const t = Number(getParam('ct'))
    return ([0, 1, 2, 3].includes(t) ? t : 0) as TierFilter
  })
  const [specialFilter, setSpecialFilter] = useState<SpecialFilter>(
    () => (getParam('csf') === 'unset' ? 'unset' : 'all'),
  )
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null)

  // URL → state 동기화 (마운트 이후 변경만)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    setParam({
      cq: search || null,
      ct: tierFilter !== 0 ? String(tierFilter) : null,
      csf: specialFilter !== 'all' ? specialFilter : null,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, tierFilter, specialFilter])

  const debouncedSearch = useDebounce(search, DEBOUNCE_MS)

  // ── 펼침 상태 (행별 섹션) ────────────────────────────────────
  interface ExpandState { productId: string; section: ExpandSection }
  const [expanded, setExpanded] = useState<ExpandState | null>(null)
  const [activeCompetitor, setActiveCompetitor] = useState('')

  const handleExpand = useCallback(
    (productId: string, section: ExpandSection) => {
      setExpanded((prev) =>
        prev?.productId === productId && prev.section === section
          ? null
          : section === null
          ? null
          : { productId, section },
      )
    },
    [],
  )

  const handleSaved = useCallback(() => {
    mutate()
    mutateGpu(globalMutate)
  }, [mutate, globalMutate])

  const goToTab = useCallback(
    (tab: string) => {
      if (onGoToTab) {
        onGoToTab(tab)
      } else {
        setParam({ tab })
      }
    },
    [onGoToTab, setParam],
  )

  // ── 정렬 핸들러 ────────────────────────────────────────────
  const handleSort = useCallback((key: SortKey) => {
    setSortConfig((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    )
  }, [])

  const products = data?.products ?? []

  // ── Tier→모델 그룹 접기 (4개 메뉴 공용 UX) ──────────────
  const allGroupKeys = useMemo(
    () => products.flatMap((p) => [tierKey(p.tier), modelKey(p.tier, p.model_name)]),
    [products],
  )
  const keepOpenTier1 = useMemo(() => [tierKey(1)], [])
  const { isCollapsed: isGroupCollapsed, toggle: toggleGroup } = useCollapsibleGroups(
    allGroupKeys, true, keepOpenTier1,
  )

  // ── 필터링 ────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (specialFilter === 'unset' && p.is_strategic_set) return false
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      return (
        p.model_name.toLowerCase().includes(q) ||
        (p.memory ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // ── 정렬 ─────────────────────────────────────────────────
  const sorted = sortConfig
    ? [...filtered].sort((a, b) => {
        const d = sortConfig.dir === 'asc' ? 1 : -1
        const pickVal = (p: CockpitProduct): number => {
          switch (sortConfig.key) {
            case 'model': return 0 // 문자열 정렬은 아래 별도
            case 'gcube': return (p.gcube_site_price_krw ?? (d > 0 ? Infinity : -Infinity))
            case 'cost': return (p.cost_min_krw ?? p.cost_krw ?? (d > 0 ? Infinity : -Infinity))
            case 'candidate': return (p.candidate_price_krw ?? (d > 0 ? Infinity : -Infinity))
            case 'competitor': return (p.competitor_min_krw ?? p.market_min_krw ?? (d > 0 ? Infinity : -Infinity))
            case 'strategic': return (p.strategic_krw ?? (d > 0 ? Infinity : -Infinity))
            default: return 0
          }
        }
        if (sortConfig.key === 'model') {
          return a.model_name.localeCompare(b.model_name, 'ko') * d
        }
        return (pickVal(a) - pickVal(b)) * d
      })
    : filtered

  // ── 로딩 ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint" role="status">로딩 중…</div>
      </div>
    )
  }

  // ── 에러 ───────────────────────────────────────────────────
  if (error) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint cockpit-error-hint" role="alert">
          데이터를 불러오지 못했습니다. 새로고침해 주세요.
        </div>
      </div>
    )
  }

  // ── 빈 상태 ────────────────────────────────────────────────
  if (products.length === 0) {
    return (
      <div className="price-cockpit-wrap">
        <div className="gpu-empty-hint">등록된 GPU 상품이 없습니다.</div>
      </div>
    )
  }

  const tierCounts = {
    t1: products.filter((p) => p.tier === 1).length,
    t2: products.filter((p) => p.tier === 2).length,
    t3: products.filter((p) => p.tier === 3).length,
    unset: products.filter((p) => !p.is_strategic_set).length,
  }

  return (
    <section className="price-cockpit-wrap" aria-label="가격 결정 콕핏">
      {/* ── 고정 툴바 영역 ── */}
      <div className="price-cockpit-toolbar-area">
      <div className="cockpit-toolbar">
        {/* 검색 */}
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            placeholder="모델명 검색 (H100, A100 ...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="모델명 검색"
          />
        </div>

        {/* Tier 필터 */}
        <div className="gpu-seg" role="group" aria-label="Tier 필터">
          {([0, 1, 2, 3] as TierFilter[]).map((t) => (
            <button
              key={t}
              className={tierFilter === t ? 'on' : ''}
              onClick={() => setTierFilter(t)}
              aria-pressed={tierFilter === t}
            >
              {t === 0
                ? `전체 ${products.length}`
                : `T${t} · ${[tierCounts.t1, tierCounts.t2, tierCounts.t3][t - 1]}`}
            </button>
          ))}
        </div>

        {/* 특수 필터 */}
        <div className="gpu-seg" role="group" aria-label="설정 상태 필터">
          <button
            className={specialFilter === 'all' ? 'on' : ''}
            onClick={() => setSpecialFilter('all')}
            aria-pressed={specialFilter === 'all'}
          >
            전체
          </button>
          <button
            className={specialFilter === 'unset' ? 'on' : ''}
            onClick={() => setSpecialFilter('unset')}
            aria-pressed={specialFilter === 'unset'}
            title="우리 판매가 미설정 항목만 보기"
          >
            미설정 {tierCounts.unset > 0 ? `· ${tierCounts.unset}` : ''}
          </button>
        </div>
      </div>
      </div>{/* end 고정 툴바 영역 */}

      {/* ── 스크롤 영역 (테이블만) ── */}
      <div className="price-cockpit-scroll">

      {/* ── 빈 필터 결과 ── */}
      {sorted.length === 0 && (
        <div className="gpu-empty-hint">검색·필터 결과가 없습니다.</div>
      )}

      {/* ── 테이블 ── */}
      {sorted.length > 0 && (
        <div className="price-cockpit-table-wrap">
          <table className="gpu-table table-base table-card price-cockpit-table">
            <thead>
              <tr>
                {/* 모델·구성 */}
                <th
                  className="cockpit-th-left cockpit-th-sortable"
                  onClick={() => handleSort('model')}
                  aria-sort={
                    sortConfig?.key === 'model'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                >
                  <span className="cockpit-th-inner">
                    모델·구성
                    <SortIcon col="model" sortConfig={sortConfig} />
                  </span>
                </th>

                {/* gcube 사이트 가격 */}
                <th
                  className="cockpit-th-sortable"
                  onClick={() => handleSort('gcube')}
                  aria-sort={
                    sortConfig?.key === 'gcube'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  title="gcube.co.kr에 현재 게시된 판매 가격"
                >
                  <span className="cockpit-th-inner">
                    gcube 사이트 가격
                    <SortIcon col="gcube" sortConfig={sortConfig} />
                  </span>
                </th>

                {/* 원가 */}
                <th
                  className="cockpit-th-sortable"
                  onClick={() => handleSort('cost')}
                  aria-sort={
                    sortConfig?.key === 'cost'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  title="공급사 매입 원가 범위 (최저~최고)"
                >
                  <span className="cockpit-th-inner">
                    원가 (최저~최고)
                    <SortIcon col="cost" sortConfig={sortConfig} />
                  </span>
                </th>

                {/* 판매가 후보 */}
                <th
                  className="cockpit-th-sortable"
                  onClick={() => handleSort('candidate')}
                  aria-sort={
                    sortConfig?.key === 'candidate'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  title="원가 + 마진율로 자동 계산된 판매가 후보"
                >
                  <span className="cockpit-th-inner">
                    판매가 후보
                    <SortIcon col="candidate" sortConfig={sortConfig} />
                  </span>
                </th>

                {/* 경쟁사 가격 */}
                <th
                  className="cockpit-th-sortable"
                  onClick={() => handleSort('competitor')}
                  aria-sort={
                    sortConfig?.key === 'competitor'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  title="시장 경쟁사 가격 범위 (최저~최고)"
                >
                  <span className="cockpit-th-inner">
                    경쟁사 가격 (최저~최고)
                    <SortIcon col="competitor" sortConfig={sortConfig} />
                  </span>
                </th>

                {/* 우리 판매가 */}
                <th
                  className="cockpit-th-sortable"
                  onClick={() => handleSort('strategic')}
                  aria-sort={
                    sortConfig?.key === 'strategic'
                      ? sortConfig.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  title="시장에서 우리 위치를 정하는 포지셔닝 가격"
                >
                  <span className="cockpit-th-inner">
                    우리 판매가
                    <SortIcon col="strategic" sortConfig={sortConfig} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // 정렬 활성 시: flat 목록 표시 (그룹 무의미)
                // 정렬 비활성 시: Tier→모델 2단계 그룹
                if (sortConfig) {
                  return sorted.map((p) => {
                    const currentSection =
                      expanded?.productId === p.id ? expanded.section : null
                    return (
                      <CockpitRow
                        key={p.id}
                        product={p}
                        isAdmin={isAdmin}
                        expandSection={currentSection}
                        activeCompetitor={activeCompetitor}
                        onExpand={(section) => handleExpand(p.id, section)}
                        onSelectCompetitor={setActiveCompetitor}
                        onSaved={handleSaved}
                        onGoToTab={goToTab}
                        syncItem={gcubeSyncMap.get(p.id)}
                      />
                    )
                  })
                }

                // 그룹 모드 — buildTierModelGroups 사용
                const tierGroups = buildTierModelGroups(sorted)
                return tierGroups.flatMap((tg) => {
                  const tKey = tierKey(tg.tier)
                  const tMeta = TIER_META[tg.tier] ?? { label: `Tier ${tg.tier}`, name: '', badge: 'gpu-badge-t2' }
                  const tCollapsed = isGroupCollapsed(tKey)
                  const tierRow = (
                    <tr
                      key={`tier-${tg.tier}`}
                      className="gpu-group-header"
                      onClick={() => toggleGroup(tKey)}
                      style={{ cursor: 'pointer', background: 'var(--surface-bg)' }}
                    >
                      <td colSpan={6}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ChevronRight
                            size={16}
                            style={{
                              transform: tCollapsed ? 'none' : 'rotate(90deg)',
                              transition: 'transform 0.15s',
                              color: 'var(--gpu-muted)',
                            }}
                          />
                          <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{tMeta.label}</strong>
                          <span style={{ fontSize: 11.5, color: 'var(--gpu-muted)', marginLeft: 'auto' }}>
                            {tg.count}개 모델 · {tg.itemCount}개 구성
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                  if (tCollapsed) return [tierRow]

                  const modelRows = tg.models.flatMap((mg) => {
                    const mKey = modelKey(tg.tier, mg.model)
                    const mCollapsed = isGroupCollapsed(mKey)
                    const modelRow = (
                      <tr
                        key={`model-${mKey}`}
                        className="gpu-group-header"
                        onClick={() => toggleGroup(mKey)}
                        style={{ cursor: 'pointer', background: 'var(--surface-bg)' }}
                      >
                        <td colSpan={6}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14 }}>
                            <ChevronRight
                              size={14}
                              style={{
                                transform: mCollapsed ? 'none' : 'rotate(90deg)',
                                transition: 'transform 0.15s',
                                color: 'var(--gpu-muted)',
                              }}
                            />
                            <span className={`gpu-badge ${tMeta.badge}`} style={{ fontSize: 9.5 }}>T{tg.tier}</span>
                            <strong style={{ fontSize: 13, color: 'var(--text)' }}>{mg.model}</strong>
                            <span style={{ fontSize: 11, color: 'var(--gpu-muted)', marginLeft: 'auto' }}>
                              {mg.items.length}개 구성
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                    if (mCollapsed) return [modelRow]
                    const productRows = mg.items.map((p) => {
                      const currentSection =
                        expanded?.productId === p.id ? expanded.section : null
                      return (
                        <CockpitRow
                          key={p.id}
                          product={p}
                          isAdmin={isAdmin}
                          expandSection={currentSection}
                          activeCompetitor={activeCompetitor}
                          onExpand={(section) => handleExpand(p.id, section)}
                          onSelectCompetitor={setActiveCompetitor}
                          onSaved={handleSaved}
                          onGoToTab={goToTab}
                          syncItem={gcubeSyncMap.get(p.id)}
                        />
                      )
                    })
                    return [modelRow, ...productRows]
                  })
                  return [tierRow, ...modelRows]
                })
              })()}
            </tbody>
          </table>
        </div>
      )}

      </div>{/* end 스크롤 영역 */}
    </section>
  )
}
