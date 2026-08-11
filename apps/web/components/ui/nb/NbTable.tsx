'use client'

import type { ReactNode, CSSProperties } from 'react'
import { useEffect, useRef } from 'react'

// 공용 테이블 (SSOT) — .table-base.table-card 자동 적용(모바일 카드 변환, 가로스크롤 금지).
// 컬럼 정의형: cardHeader=모바일 카드 제목 행, hideOnMobile=card-hide, 그 외 data-label 자동.
// selection을 넘기면 맨 앞에 체크박스 열이 붙는다(다중선택 → 일괄 삭제. 상태는 useRowSelection SSOT).

export interface NbColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** 모바일 카드 제목 행으로 표시(레이블 없음) */
  cardHeader?: boolean
  /** 모바일에서 숨김(카드 헤더에 중복) */
  hideOnMobile?: boolean
  /** th/td 스타일 */
  thStyle?: CSSProperties
  tdStyle?: CSSProperties
  /** 모바일 data-label (기본=header가 문자열이면 그 값) */
  label?: string
}

/** 다중선택 배선 — useRowSelection이 주는 값을 그대로 넘기면 된다. */
export interface NbTableSelection<T> {
  isSelected: (row: T) => boolean
  onToggle: (row: T) => void
  onToggleAll: () => void
  allSelected: boolean
  someSelected: boolean
  /** 행 체크박스 aria-label(기본 "행 선택") */
  rowLabel?: (row: T) => string
}

interface NbTableProps<T> {
  columns: NbColumn<T>[]
  rows: T[]
  getRowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  tableStyle?: CSSProperties
  selection?: NbTableSelection<T>
}

/** 전체선택 체크박스 — 부분선택은 indeterminate(DOM 프로퍼티라 ref로만 설정 가능). */
function SelectAllCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" className="nb-row-check" data-testid="nb-select-all"
      checked={checked} onChange={onChange} aria-label={checked ? '전체 선택 해제' : '전체 선택'} />
  )
}

export default function NbTable<T>({ columns, rows, getRowKey, onRowClick, empty, tableStyle, selection }: NbTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>
  }
  const table = (
    <table className="table-base table-card" style={{ width: '100%', ...tableStyle }}>
      <thead>
        <tr>
          {selection && (
            <th className="nb-select-cell">
              <SelectAllCheckbox
                checked={selection.allSelected}
                indeterminate={selection.someSelected}
                onChange={selection.onToggleAll}
              />
            </th>
          )}
          {columns.map((c) => (
            <th key={c.key} style={c.thStyle}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const selected = selection ? selection.isSelected(row) : false
          return (
            <tr
              key={getRowKey(row, i)}
              className={selected ? 'is-selected' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) } } : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {selection && (
                // 체크박스 클릭이 행 클릭(상세 열기)으로 전파되지 않게 셀 단위로 차단
                <td className="nb-select-cell" data-label="선택" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="nb-row-check" checked={selected}
                    onChange={() => selection.onToggle(row)} aria-label={selection.rowLabel?.(row) ?? '행 선택'} />
                </td>
              )}
              {columns.map((c) => {
                const cls = c.cardHeader ? 'card-header' : c.hideOnMobile ? 'card-hide' : undefined
                const dataLabel = c.cardHeader ? undefined : (c.label ?? (typeof c.header === 'string' ? c.header : undefined))
                return (
                  <td key={c.key} className={cls} data-label={dataLabel} style={c.tdStyle}>
                    {c.render(row)}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  if (!selection) return table
  return (
    <>
      {/* 모바일은 thead가 카드 변환으로 숨겨져 헤더의 전체선택이 사라진다 → 표 밖에 같은 기능을 둔다 */}
      <label className="nb-select-all-mobile mobile-only-flex">
        <input type="checkbox" className="nb-row-check" checked={selection.allSelected}
          onChange={selection.onToggleAll} aria-label={selection.allSelected ? '전체 선택 해제' : '전체 선택'} />
        전체 선택
      </label>
      {table}
    </>
  )
}
