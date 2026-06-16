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
  onRegisterQuote?: () => void
  onManageMapping?: () => void
}

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

export default function UnifiedTable({ rows, loading = false, error = null, usdKrw = 1, marginPct, isAdmin = false, onMarginSaved, onRegisterQuote, onManageMapping }: UnifiedTableProps) {
  // 하이드레이션 안전: 서버/첫 렌더는 DEFAULT_VIEW, mount 후 저장된 보기로 복원(localStorage 불일치 방지).
  const [view, setView] = useState<GpuViewId>(DEFAULT_VIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('KRW')
  const [bulkOpen, setBulkOpen] = useState(false)
  // 정렬: null이면 기본(모델·용량). 컬럼 헤더 클릭 시 해당 컬럼 asc→desc→해제 순환.
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  // 모델별 그룹 접힘 상태 — model_name 집합. 기본 전체 접힘(첫 데이터 로드 시 1회 초기화).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const collapseInited = useRef(false)
  useEffect(() => {
    if (collapseInited.current || rows.length === 0) return
    collapseInited.current = true
    setCollapsed(new Set(rows.map((r) => r.model_name)))
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
  // 기본 정렬: 모델명(숫자 인식, A10<A100) → 같은 모델은 용량(GB) 오름차순. 목록 뒤죽박죽 방지.
  const defaultCmp = (a: UnifiedRow, b: UnifiedRow) => {
    const m = a.model_name.localeCompare(b.model_name, 'en', { numeric: true, sensitivity: 'base' })
    return m !== 0 ? m : memGB(a.memory) - memGB(b.memory)
  }
  const sortedRows = [...rows].sort((a, b) => {
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

  // 모델별 그룹핑 — visibleRows는 이미 정렬·검색 반영. Map 삽입순서로 등장 순서 보존.
  const groupMap = new Map<string, UnifiedRow[]>()
  for (const r of visibleRows) {
    const arr = groupMap.get(r.model_name)
    if (arr) arr.push(r)
    else groupMap.set(r.model_name, [r])
  }
  const groups = Array.from(groupMap, ([model, groupRows]) => ({ model, rows: groupRows }))
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.model))
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.model)))

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
            return (
              <span key={col.key} role="cell" className={base}>
                <span className="gpu-unified-model">
                  <span title={memoryTitle(row.memory, row.gpu_count) || undefined}>
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
            <div className="gpu-unified-state">{q ? '검색 결과가 없습니다.' : '등록된 항목이 없습니다.'}</div>
          )}

          {!loading && !error &&
            groups.map((group) => {
              const isCollapsed = collapsed.has(group.model)
              return (
                <div key={group.model} role="rowgroup" className="gpu-unified-group">
                  <button
                    type="button"
                    className="gpu-unified-group-head"
                    onClick={() => toggleGroup(group.model)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="gpu-unified-group-chevron" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                    <span className="gpu-unified-group-name">{group.model}</span>
                    <span className="gpu-unified-group-count">{group.rows.length}개 구성</span>
                  </button>
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
          <DetailPanel key={selectedRow?.id ?? 'empty'} row={selectedRow} currency={currency} onRegisterQuote={onRegisterQuote} onManageMapping={onManageMapping} />
        </div>
      </div>

      {bulkOpen && (
        <BulkReflectPanel rows={rows} currency={currency} onClose={() => setBulkOpen(false)} />
      )}
    </div>
  )
}
