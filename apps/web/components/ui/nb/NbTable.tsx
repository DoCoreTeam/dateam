'use client'

import type { ReactNode, CSSProperties } from 'react'

// 공용 테이블 (SSOT) — .table-base.table-card 자동 적용(모바일 카드 변환, 가로스크롤 금지).
// 컬럼 정의형: cardHeader=모바일 카드 제목 행, hideOnMobile=card-hide, 그 외 data-label 자동.

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

interface NbTableProps<T> {
  columns: NbColumn<T>[]
  rows: T[]
  getRowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  empty?: ReactNode
  tableStyle?: CSSProperties
}

export default function NbTable<T>({ columns, rows, getRowKey, onRowClick, empty, tableStyle }: NbTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>
  }
  return (
    <table className="table-base table-card" style={{ width: '100%', ...tableStyle }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.thStyle}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={getRowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) } } : undefined}
            style={onRowClick ? { cursor: 'pointer' } : undefined}
          >
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
        ))}
      </tbody>
    </table>
  )
}
