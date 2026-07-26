'use client'

// 통합 표 — 마스터·디테일 셸 (좌 목록 + 보기 전환 + 우 상세 패널)
// 보기 전환 = 컬럼 프리셋 교체(VIEW_PRESETS SSOT). 행 선택 시 우측 상세(목록 맥락 유지).
// 데이터 어댑터(cockpit/market/... → UnifiedRow[])는 P1-3에서 연결. 본 컴포넌트는 표현만.

import { useEffect, useRef, useState } from 'react'
import { Globe, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import ViewSwitcher, { restoreSavedView } from './ViewSwitcher'
import DetailPanel from './DetailPanel'
import BulkReflectPanel from './BulkReflectPanel'
import MarginControl from '../MarginControl'
import { getViewPreset, DEFAULT_VIEW } from '@/lib/gpu/unified-views'
import type { GpuViewId } from '@/lib/gpu/unified-views'
import { resolveCell } from '@/lib/gpu/unified-row'
import { formatCardMemory, memoryTitle } from '@/lib/gpu/card-memory'
import { baseModelKey, baseModelName } from '@/lib/gpu/canonical-model'
import { generationRank } from '@/lib/gpu/generation'
import { extractFormFactor } from '@/lib/gpu/form-factor'
import type { UnifiedRow, CurrencyCtx } from '@/lib/gpu/unified-row'
import type { CurrencyMode } from '@/lib/gpu/format-price'

interface UnifiedTableProps {
  rows: UnifiedRow[]
  loading?: boolean
  error?: string | null
  /** 표시 통화 환산 환율(1 USD = ? KRW). cockpit usd_krw. */
  usdKrw?: number
  /** gcube 판매 마진(%) — 전역 설정값. 통합 표 auto_price 산정에 사용됨. */
  marginPct?: number
  /** 관리자만 마진 편집 가능. */
  isAdmin?: boolean
  /** 마진 저장 성공 후 — 가격 데이터 revalidate. */
  onMarginSaved?: () => void
  /** 노출(취급) 토글 후 — 가격 데이터 revalidate. */
  onVisibilityChanged?: () => void
  onRegisterQuote?: () => void
  onManageMapping?: () => void
}

/** 모델 표시 정렬 모드 — 최신순(세대 랭크) 기본 / 이름순(알파벳). URL·저장 없이 세션 상태. */
type OrderMode = 'newest' | 'name'

/** 메모리 문자열("160GB")에서 GB 숫자 추출. 없으면 맨 뒤로(Infinity). */
function memGB(memory: string | null): number {
  if (!memory) return Number.POSITIVE_INFINITY
  const m = memory.match(/(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : Number.POSITIVE_INFINITY
}

/** 컬럼 키 → 정렬 원시값. 빈값(null/'')은 정렬 방향과 무관하게 항상 맨 뒤(아래)로 보낸다. */
function sortValue(row: UnifiedRow, key: string): number | string | null {
  switch (key) {
    case 'model': return row.model_name
    case 'tier': return row.tier
    case 'supplyCost': return row.supply_cost_krw
    case 'autoPrice': return row.auto_price_krw
    case 'sellPrice': return row.sell_price_krw
    case 'margin': return row.margin_pct
    case 'marketMin': return row.market_min_krw
    case 'marketMedian': return row.market_median_krw
    case 'marketMax': return row.market_max_krw
    case 'marketDev': return row.market_dev_pct
    case 'sampleCount': return row.sample_count
    case 'supplier': return row.supplier_name
    case 'availableQty': return row.available_qty
    case 'stockStatus': return row.stock_status
    case 'discountRate': return row.discount_rate
    case 'customerPrice': return row.customer_price_krw
    default: return null
  }
}

export default function UnifiedTable({ rows, loading = false, error = null, usdKrw = 1, marginPct, isAdmin = false, onMarginSaved, onVisibilityChanged, onRegisterQuote, onManageMapping }: UnifiedTableProps) {
  // 하이드레이션 안전: 서버/첫 렌더는 DEFAULT_VIEW, mount 후 저장된 보기로 복원(localStorage 불일치 방지).
  const [view, setView] = useState<GpuViewId>(DEFAULT_VIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('KRW')
  const [bulkOpen, setBulkOpen] = useState(false)
  // 정렬 모드(그룹 기본 순서): 최신순(세대) 기본 — 사용자 요청. 컬럼 정렬(sortConfig)이 있으면 그게 우선.
  const [orderMode, setOrderMode] = useState<OrderMode>('newest')
  // 노출 큐레이션: 기본은 취급 모델(is_active)만. "전체 보기"로 숨김/검토대기까지 노출. 전원 동일 기본(취급만).
  const [showAll, setShowAll] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null) // admin 토글 진행 중 그룹키
  // 정렬: null이면 기본(모델·용량). 컬럼 헤더 클릭 시 해당 컬럼 asc→desc→해제 순환.
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  // 모델별 그룹 접힘 상태 — base 모델키 집합(폼팩터 하위로 접음: H100/H100 SXM/PCIe/NVL → 한 "H100"). 기본 전체 접힘.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const collapseInited = useRef(false)
  useEffect(() => {
    if (collapseInited.current || rows.length === 0) return
    collapseInited.current = true
    setCollapsed(new Set(rows.map((r) => baseModelKey(r.model_name))))
  }, [rows])
  const toggleGroup = (model: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(model)) next.delete(model)
      else next.add(model)
      return next
    })
  useEffect(() => { setView(restoreSavedView()) }, [])

  const currency: CurrencyCtx = { mode: currencyMode, usdKrw }
  const preset = getViewPreset(view)
  const toggleSort = (key: string) => {
    setSortConfig((prev) =>
      prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null,
    )
  }
  // 기본 정렬:
  //   · 최신순(newest, 기본) = 아키텍처 세대 내림차순(SSOT generationRank) → 같은 세대는 이름 → 용량.
  //   · 이름순(name) = 모델명 알파벳(숫자 인식, A10<A100) → 용량.
  const defaultCmp = (a: UnifiedRow, b: UnifiedRow) => {
    if (orderMode === 'newest') {
      const g = generationRank(b.model_name) - generationRank(a.model_name) // 큰 값(최신)이 위로
      if (g !== 0) return g
    }
    const m = a.model_name.localeCompare(b.model_name, 'en', { numeric: true, sensitivity: 'base' })
    return m !== 0 ? m : memGB(a.memory) - memGB(b.memory)
  }
  // 노출 필터(표시 계층 전용) — 기본은 취급(is_active)만. showAll이면 전량. 검색/정렬 전에 적용.
  const curated = showAll ? rows : rows.filter((r) => r.is_active)
  const hiddenCount = rows.length - curated.length
  const sortedRows = [...curated].sort((a, b) => {
    if (!sortConfig) return defaultCmp(a, b)
    const av = sortValue(a, sortConfig.key)
    const bv = sortValue(b, sortConfig.key)
    const aEmpty = av == null || av === ''
    const bEmpty = bv == null || bv === ''
    // 빈값은 방향 무관 항상 아래로
    if (aEmpty && bEmpty) return defaultCmp(a, b)
    if (aEmpty) return 1
    if (bEmpty) return -1
    let c: number
    if (typeof av === 'number' && typeof bv === 'number') c = av - bv
    else c = String(av).localeCompare(String(bv), 'en', { numeric: true })
    if (c === 0) c = defaultCmp(a, b)
    return sortConfig.dir === 'asc' ? c : -c
  })
  const q = query.trim().toLowerCase()
  const visibleRows = q
    ? sortedRows.filter((r) =>
        r.model_name.toLowerCase().includes(q) ||
        (r.memory ?? '').toLowerCase().includes(q) ||
        (r.supplier_name ?? '').toLowerCase().includes(q))
    : sortedRows
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null

  // base 모델별 그룹핑 — 폼팩터(SXM/PCIe/NVL)를 하위로 접어 "H100" 하나로 묶는다(그룹핑 SSOT=baseModelKey).
  //   visibleRows는 이미 정렬·검색 반영. Map 삽입순서로 등장 순서 보존. 표시명은 폼팩터 없는 base명.
  const groupMap = new Map<string, { name: string; rows: UnifiedRow[] }>()
  for (const r of visibleRows) {
    const key = baseModelKey(r.model_name)
    const g = groupMap.get(key)
    if (g) g.rows.push(r)
    else groupMap.set(key, { name: baseModelName(r.model_name), rows: [r] })
  }
  const groups = Array.from(groupMap, ([key, g]) => ({ key, name: g.name, rows: g.rows }))
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key))
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))

  // admin 취급(노출) 토글 — 그룹 내 전 구성(productIds)의 is_active를 일괄 변경. PATCH → 재조회.
  //   noop 방지: 이미 목표 상태면 스킵. 실패는 alert(가격표는 revalidate로 원복).
  const toggleGroupVisibility = async (groupKey: string, ids: string[], nextActive: boolean) => {
    if (ids.length === 0) return
    setBusyKey(groupKey)
    try {
      const res = await fetch('/api/pricing/gpu/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: ids, is_active: nextActive }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || '요청 실패')
      }
      onVisibilityChanged?.()
    } catch (e) {
      alert(e instanceof Error ? e.message : '노출 변경에 실패했습니다.')
    } finally {
      setBusyKey(null)
    }
  }

  // 멤버 행 1줄 렌더(그룹 안). 모델명은 그룹 헤더에 있으므로 행에선 구성(용량·공급사)을 보여준다.
  const renderRow = (row: UnifiedRow) => {
    const selected = row.id === selectedId
    return (
      <button
        key={row.id}
        type="button"
        role="row"
        aria-selected={selected}
        className={`gpu-unified-row gpu-unified-row--item${selected ? ' gpu-unified-row--sel' : ''}`}
        onClick={() => setSelectedId(row.id)}
      >
        {preset.columns.map((col) => {
          const cell = resolveCell(row, col, currency)
          const base = `gpu-unified-cell gpu-unified-cell--${col.align}${col.hideMobile ? ' gpu-unified-cell--hide-mobile' : ''}`
          if (cell.kind === 'model') {
            // 그룹은 base명(예 "H100"). 행은 폼팩터(SXM/PCIe/NVL)를 태그로 구분 + 구성(카드VRAM·공급사) 표시.
            const ff = extractFormFactor(row.model_name).formFactor
            return (
              <span key={col.key} role="cell" className={base}>
                <span className="gpu-unified-model">
                  <span title={memoryTitle(row.memory, row.gpu_count) || undefined}>
                    {ff && <span className="gpu-ubadge gpu-ubadge--muted" style={{ marginRight: 6 }}>{ff}</span>}
                    {row.memory ? formatCardMemory(row.memory, row.gpu_count) : cell.text}
                  </span>
                  {row.supplier_name && <small>{row.supplier_name}</small>}
                </span>
              </span>
            )
          }
          if (cell.kind === 'badge') {
            return (
              <span key={col.key} role="cell" className={base}>
                {cell.text === '—'
                  ? <span className="gpu-unified-tone--muted">—</span>
                  : <span className={`gpu-ubadge gpu-ubadge--${cell.tone}`}>{cell.text}</span>}
              </span>
            )
          }
          // text / sell
          return (
            <span
              key={col.key}
              role="cell"
              className={`${base} gpu-unified-tone--${cell.tone}${cell.mono ? ' gpu-mono' : ''}`}
            >
              {cell.text}
            </span>
          )
        })}
      </button>
    )
  }

  return (
    <div className="gpu-unified">
      <div className="gpu-unified-toolbar">
        <div className="gpu-unified-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input className="input-field gpu-unified-search-input" type="search"
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="모델·공급사·경쟁사 검색…" aria-label="검색"
          />
        </div>
        <ViewSwitcher value={view} onChange={setView} />
        {/* 통화 토글 — 기존 가격표와 동일(원/달러). 모든 금액이 이 모드를 따른다. */}
        <div className="gpu-seg gpu-unified-cur" role="group" aria-label="표시 통화">
          <button type="button" className={currencyMode === 'KRW' ? 'on' : ''} onClick={() => setCurrencyMode('KRW')} title="원화 기준">₩ 원</button>
          <button type="button" className={currencyMode === 'USD' ? 'on' : ''} onClick={() => setCurrencyMode('USD')} title="달러 기준">$ 달러</button>
        </div>
        {/* gcube 판매 마진(%) 설정 — 전역 설정. auto_price 산정에 사용. 관리자만 편집. */}
        {marginPct != null && (
          <MarginControl marginPct={marginPct} isAdmin={isAdmin} onSaved={onMarginSaved} />
        )}
        {/* 정렬 모드 — 최신순(세대) 기본 / 이름순. */}
        <div className="gpu-seg gpu-unified-order" role="group" aria-label="정렬 순서">
          <button type="button" className={orderMode === 'newest' ? 'on' : ''} onClick={() => setOrderMode('newest')} title="최신 세대 순(Blackwell→Hopper→…)">최신순</button>
          <button type="button" className={orderMode === 'name' ? 'on' : ''} onClick={() => setOrderMode('name')} title="모델명 알파벳 순">이름순</button>
        </div>
        {/* 취급/전체 보기 — 기본은 취급 모델만. 숨김 개수 표시. */}
        <button
          type="button"
          className={`gpu-btn gpu-unified-showall-btn${showAll ? ' is-on' : ''}`}
          onClick={() => setShowAll((v) => !v)}
          title={showAll ? '취급 모델만 보기' : '숨김·검토대기 포함 전체 보기'}
        >
          {showAll ? '취급만 보기' : `전체 보기${hiddenCount > 0 ? ` (+${hiddenCount})` : ''}`}
        </button>
        {/* 모델 그룹 전체 접기/펼치기 */}
        <button
          type="button"
          className="gpu-btn gpu-unified-collapse-btn"
          onClick={toggleAll}
          title={allCollapsed ? '모든 모델 펼치기' : '모든 모델 접기'}
        >
          {allCollapsed ? <ChevronsUpDown size={14} aria-hidden /> : <ChevronsDownUp size={14} aria-hidden />}
          {allCollapsed ? '전체 펼치기' : '전체 접기'}
        </button>
        {/* 일괄 반영(P3) — 미반영 제품 모아 전략가 일괄 확정/반영완료. 관리자만 실제 처리됨. */}
        <button
          type="button"
          className="gpu-btn gpu-unified-bulk-btn"
          onClick={() => setBulkOpen(true)}
          title="미반영 제품 일괄 반영"
        >
          <Globe size={14} aria-hidden />
          일괄 반영
        </button>
      </div>

      <div className="gpu-unified-split">
        {/* 좌: 목록 (마스터) */}
        <div className="gpu-unified-list" role="table" aria-label={`통합 표 — ${preset.label}`}>
          <div className="gpu-unified-row gpu-unified-row--head" role="row">
            {preset.columns.map((col) => {
              const active = sortConfig?.key === col.key
              return (
                <button
                  key={col.key}
                  type="button"
                  role="columnheader"
                  className={`gpu-unified-cell gpu-unified-cell--${col.align}${col.hideMobile ? ' gpu-unified-cell--hide-mobile' : ''} gpu-unified-cell--sortable${active ? ' is-sorted' : ''}`}
                  onClick={() => toggleSort(col.key)}
                  aria-sort={active ? (sortConfig!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={`${col.label} 정렬`}
                >
                  {col.label}
                  <span className="gpu-unified-sortcue">{active ? (sortConfig!.dir === 'asc' ? '↑' : '↓') : ''}</span>
                </button>
              )
            })}
          </div>

          {loading && <div className="gpu-unified-state">불러오는 중…</div>}
          {error && <div className="gpu-unified-state gpu-unified-state--error">{error}</div>}
          {!loading && !error && visibleRows.length === 0 && (
            <div className="gpu-unified-state">
              {q ? '검색 결과가 없습니다.'
                : !showAll && hiddenCount > 0
                  ? `취급 중인 모델이 없습니다. 숨김 ${hiddenCount}개 — "전체 보기"로 확인하세요.`
                  : '등록된 항목이 없습니다.'}
            </div>
          )}

          {!loading && !error &&
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.key)
              const groupActive = group.rows.some((r) => r.is_active)
              const groupReview = group.rows.some((r) => r.needs_review)
              const groupIds = group.rows.map((r) => r.id)
              const busy = busyKey === group.key
              return (
                <div key={group.key} role="rowgroup" className={`gpu-unified-group${!groupActive ? ' gpu-unified-group--hidden' : ''}`}>
                  <div className="gpu-unified-group-head-row">
                    <button
                      type="button"
                      className="gpu-unified-group-head"
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={!isCollapsed}
                    >
                      <span className="gpu-unified-group-chevron" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                      <span className="gpu-unified-group-name">{group.name}</span>
                      <span className="gpu-unified-group-count">{group.rows.length}개 구성</span>
                      {groupReview && <span className="gpu-ubadge gpu-ubadge--warn" title="신규 유입 — 검토 대기">검토 대기</span>}
                      {!groupActive && <span className="gpu-ubadge gpu-ubadge--muted" title="가격표 기본 노출에서 제외됨">숨김</span>}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="gpu-btn gpu-unified-vis-btn"
                        disabled={busy}
                        onClick={() => toggleGroupVisibility(group.key, groupIds, !groupActive)}
                        title={groupActive ? '가격표에서 숨기기(취급 안 함)' : '가격표에 노출(취급)'}
                      >
                        {busy ? '…' : groupActive ? '숨기기' : '노출'}
                      </button>
                    )}
                  </div>
                  {!isCollapsed && group.rows.map(renderRow)}
                </div>
              )
            })}
        </div>

        {/* 우: 상세 (디테일) — 모바일에서는 선택 시 풀스크린 전환(CSS) */}
        <div className={`gpu-unified-detail${selectedRow ? ' gpu-unified-detail--open' : ''}`}>
          {selectedRow && (
            <button
              type="button"
              className="gpu-unified-detail-back"
              onClick={() => setSelectedId(null)}
              aria-label="목록으로"
            >
              ← 목록
            </button>
          )}
          <DetailPanel key={selectedRow?.id ?? 'empty'} row={selectedRow} currency={currency} onRegisterQuote={onRegisterQuote} onManageMapping={onManageMapping} isAdmin={isAdmin} />
        </div>
      </div>

      {bulkOpen && (
        <BulkReflectPanel rows={rows} currency={currency} onClose={() => setBulkOpen(false)} />
      )}
    </div>
  )
}
