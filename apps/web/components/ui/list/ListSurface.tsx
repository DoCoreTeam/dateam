'use client'

// components/ui/list/ListSurface.tsx — 목록 본문(표·카드·조밀)
//
// 컬럼 정의 한 벌로 세 가지 보기를 그린다. 화면이 <table>을 다시 짜지 않는다.
// 빈·로딩·오류 3상태를 여기서 강제한다 — 지금까지는 화면마다 빈 상태 문구를
// 직접 렌더(188건)하거나 오류를 그냥 삼켰다.
// 표는 `.table-card`를 쓴다 — 모바일 카드 변환은 이미 그 클래스가 한다(가로 스크롤 금지).

import type { ReactNode } from 'react'
import EmptyState, { type EmptyStateAction } from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import SortIcon from '@/components/ui/SortIcon'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import type { ListQuery } from '@/lib/ui/list-query'
import type { ColumnDef } from './types'

interface Props<T> {
  rows: T[]
  columns: ColumnDef<T>[]
  query: ListQuery
  rowKey: (row: T) => string
  onChange?: (patch: Partial<ListQuery>) => void
  loading?: boolean
  error?: { code?: string; message: string; onRetry?: () => void } | null
  empty: { title: string; description?: ReactNode; action?: EmptyStateAction }
  onRowClick?: (row: T) => void
  /** 선택(일괄 작업)을 쓰는 화면만 넘긴다 */
  selection?: { selected: Set<string>; onToggle: (id: string) => void }
}

function sortKeyOf<T>(col: ColumnDef<T>): string | null {
  if (!col.sortable) return null
  return typeof col.sortable === 'string' ? col.sortable : col.key
}

export default function ListSurface<T>({
  rows, columns, query, rowKey, onChange, loading, error, empty, onRowClick, selection,
}: Props<T>) {
  if (error) {
    return <ErrorState message={error.message} code={error.code} onRetry={error.onRetry} />
  }
  if (loading && rows.length === 0) return <SkelList rows={6} />
  if (rows.length === 0) {
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />
  }

  if (query.view === 'card') {
    const primary = columns.find((c) => c.primary) ?? columns[0]
    const rest = columns.filter((c) => c !== primary && !c.hideOnCard)
    return (
      <div className="list-cards">
        {rows.map((row) => {
          const id = rowKey(row)
          return (
            <article
              key={id}
              className={`card list-card${onRowClick ? ' is-clickable' : ''}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              <h3 className="list-card-title">{primary.cell(row)}</h3>
              <dl className="list-card-fields">
                {rest.map((c) => (
                  <div key={c.key} className="list-card-field">
                    <dt>{c.header}</dt>
                    <dd>{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )
        })}
      </div>
    )
  }

  const dense = query.view === 'compact'
  return (
    <table className={`table-base table-card${dense ? ' list-compact' : ''}`}>
      <thead>
        <tr>
          {selection && <th scope="col" className="list-select-col"><span className="sr-only">선택</span></th>}
          {columns.map((c) => {
            const sk = sortKeyOf(c)
            const active = sk === query.sort.key
            return (
              <th key={c.key} scope="col" style={{ width: c.width, textAlign: c.align }}
                aria-sort={active ? (query.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                {sk && onChange ? (
                  <button
                    type="button"
                    className="list-sort-btn"
                    onClick={() => onChange({
                      // 같은 열을 다시 누르면 방향만 뒤집는다
                      sort: { key: sk, dir: active && query.sort.dir === 'desc' ? 'asc' : 'desc' },
                    })}
                  >
                    {c.header}
                    <SortIcon active={active} dir={query.sort.dir} />
                  </button>
                ) : c.header}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const id = rowKey(row)
          return (
            <tr
              key={id}
              className={onRowClick ? 'is-clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {selection && (
                <td className="list-select-col" onClick={(e) => e.stopPropagation()}>
                  <input className="input-field" type="checkbox"
                    aria-label="행 선택"
                    checked={selection.selected.has(id)}
                    onChange={() => selection.onToggle(id)}
                  />
                </td>
              )}
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  // 첫 칸(또는 primary)은 모바일 카드의 제목 줄이 된다
                  className={c.primary || (i === 0 && !columns.some((x) => x.primary)) ? 'card-header' : (c.hideOnCard ? 'card-hide' : undefined)}
                  // 이름이 필요 없는 칸(썸네일·액션)은 모바일에서 레이블을 붙이지 않는다
                  data-label={c.noLabel ? undefined : c.header}
                  style={{ textAlign: c.align }}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
