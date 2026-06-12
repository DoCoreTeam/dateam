'use client'

// 통합 표 — 마스터·디테일 셸 (좌 목록 + 보기 전환 + 우 상세 패널)
// 보기 전환 = 컬럼 프리셋 교체(VIEW_PRESETS SSOT). 행 선택 시 우측 상세(목록 맥락 유지).
// 데이터 어댑터(cockpit/market/... → UnifiedRow[])는 P1-3에서 연결. 본 컴포넌트는 표현만.

import { useEffect, useState } from 'react'
import ViewSwitcher, { restoreSavedView } from './ViewSwitcher'
import DetailPanel from './DetailPanel'
import { getViewPreset, DEFAULT_VIEW } from '@/lib/gpu/unified-views'
import type { GpuViewId } from '@/lib/gpu/unified-views'
import { resolveCell } from '@/lib/gpu/unified-row'
import type { UnifiedRow } from '@/lib/gpu/unified-row'

interface UnifiedTableProps {
  rows: UnifiedRow[]
  loading?: boolean
  error?: string | null
}

export default function UnifiedTable({ rows, loading = false, error = null }: UnifiedTableProps) {
  // 하이드레이션 안전: 서버/첫 렌더는 DEFAULT_VIEW, mount 후 저장된 보기로 복원(localStorage 불일치 방지).
  const [view, setView] = useState<GpuViewId>(DEFAULT_VIEW)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { setView(restoreSavedView()) }, [])

  const preset = getViewPreset(view)
  const q = query.trim().toLowerCase()
  const visibleRows = q
    ? rows.filter((r) =>
        r.model_name.toLowerCase().includes(q) ||
        (r.memory ?? '').toLowerCase().includes(q) ||
        (r.supplier_name ?? '').toLowerCase().includes(q))
    : rows
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null

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
      </div>

      <div className="gpu-unified-split">
        {/* 좌: 목록 (마스터) */}
        <div className="gpu-unified-list" role="table" aria-label={`통합 표 — ${preset.label}`}>
          <div className="gpu-unified-row gpu-unified-row--head" role="row">
            {preset.columns.map((col) => (
              <span
                key={col.key}
                role="columnheader"
                className={`gpu-unified-cell gpu-unified-cell--${col.align}${col.hideMobile ? ' gpu-unified-cell--hide-mobile' : ''}`}
              >
                {col.label}
              </span>
            ))}
          </div>

          {loading && <div className="gpu-unified-state">불러오는 중…</div>}
          {error && <div className="gpu-unified-state gpu-unified-state--error">{error}</div>}
          {!loading && !error && visibleRows.length === 0 && (
            <div className="gpu-unified-state">{q ? '검색 결과가 없습니다.' : '등록된 항목이 없습니다.'}</div>
          )}

          {!loading && !error &&
            visibleRows.map((row) => {
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
                    const cell = resolveCell(row, col)
                    const base = `gpu-unified-cell gpu-unified-cell--${col.align}${col.hideMobile ? ' gpu-unified-cell--hide-mobile' : ''}`
                    if (cell.kind === 'model') {
                      return (
                        <span key={col.key} role="cell" className={base}>
                          <span className="gpu-unified-model">
                            {cell.text}
                            {row.memory && <small>{row.memory}</small>}
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
          <DetailPanel row={selectedRow} />
        </div>
      </div>
    </div>
  )
}
