'use client'

// components/ui/list/ListSurface.tsx — 목록 본문(표·카드·조밀)
//
// 컬럼 정의 한 벌로 세 가지 보기를 그린다. 화면이 <table>을 다시 짜지 않는다.
// 빈·로딩·오류 3상태를 여기서 강제한다 — 지금까지는 화면마다 빈 상태 문구를
// 직접 렌더(188건)하거나 오류를 그냥 삼켰다.
// 표는 `.table-card`를 쓴다 — 모바일 카드 변환은 이미 그 클래스가 한다(가로 스크롤 금지).

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  /**
   * 행을 눌러 **그 자리에서** 여는 경우(시트·드로어). 라우트로 이동하면 `rowHref`를 쓴다.
   */
  onRowClick?: (row: T) => void
  /**
   * 행을 눌러 **상세 라우트로 이동**하는 경우. 행 전체가 눌리고, 제목 칸은 진짜 `<a>`가 되어
   * 새 탭·우클릭·키보드 이동이 전부 된다(onRowClick만으로는 그게 안 된다).
   *
   * 왜 부품이 갖는가: 목록에 '상세' 버튼만 두고 행은 죽여 놓은 화면이 반복해서 나왔다
   * (사용자 지적: "행을 누르면 동작하는 게 왜 없지?", "상세를 눌러야 상세가 보이는 것도 이상한데?").
   * 화면마다 기억해야 하는 규칙은 반드시 빠뜨린다 — 그래서 여기서 강제한다.
   */
  rowHref?: (row: T) => string
  /** 선택(일괄 작업)을 쓰는 화면만 넘긴다 */
  selection?: ListSelection<T>
}

/**
 * 다중 선택 배선. `onToggleAll`을 주면 전체 선택 체크박스(헤더 + 모바일)가 붙는다.
 * 예전엔 이 기능이 `NbTable`에만 있어서, 일괄 삭제가 필요한 화면은 표 부품을 갈아탈 수밖에 없었다
 * (그게 "표가 여러 방식"이 된 이유다). 부품을 새로 만들지 않고 **여기에 흡수**한다.
 */
export interface ListSelection<T> {
  selected: Set<string>
  onToggle: (id: string) => void
  allSelected?: boolean
  someSelected?: boolean
  onToggleAll?: () => void
  /** 행 체크박스 aria-label(기본 "행 선택") */
  rowLabel?: (row: T) => string
}

function sortKeyOf<T>(col: ColumnDef<T>): string | null {
  if (!col.sortable) return null
  return typeof col.sortable === 'string' ? col.sortable : col.key
}

/** 전체선택 체크박스 — 부분선택은 indeterminate(DOM 프로퍼티라 ref로만 설정 가능). */
function SelectAllCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" className="nb-row-check" data-testid="nb-select-all"
      checked={checked} onChange={onChange} aria-label={checked ? '전체 선택 해제' : '전체 선택'} />
  )
}

export default function ListSurface<T>({
  rows, columns, query, rowKey, onChange, loading, error, empty, onRowClick, rowHref, selection,
}: Props<T>) {
  const router = useRouter()
  // 행 열기 = 라우트 이동(rowHref) 또는 그 자리 열기(onRowClick). 둘 다 같은 제스처로 동작한다.
  const openRow = rowHref ? (row: T) => router.push(rowHref(row)) : onRowClick
  const rowOpens = Boolean(openRow)
  /**
   * 앵커 위에서 시작한 클릭이면 행 핸들러는 비켜선다.
   *
   * 왜: 제목 칸은 진짜 링크(`rowHref`)라 Next `Link`가 이미 이동을 맡는다. 여기서 행까지
   * `router.push`를 부르면 **같은 클릭에 이동 요청이 두 번** 나간다. 행 안의 다른 링크
   * (거래처·원본 열기)는 목적지가 아예 달라서, 행이 끼어들면 **엉뚱한 곳으로 간다.**
   * 어느 쪽이든 "그 링크가 하려던 일"이 옳다 — 행은 링크가 없는 자리에서만 대신 연다.
   */
  const rowClick = openRow
    ? (row: T) => (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('a')) return
        openRow(row)
      }
    : undefined
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
              className={`card list-card${rowOpens ? ' is-clickable' : ''}`}
              onClick={rowClick?.(row)}
            >
              <h3 className="list-card-title">
                {rowHref ? <Link href={rowHref(row)}>{primary.cell(row)}</Link> : primary.cell(row)}
              </h3>
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
  const table = (
    <table className={`table-base table-card${dense ? ' list-compact' : ''}`}>
      <thead>
        <tr>
          {selection && (
            <th scope="col" className="nb-select-cell">
              {selection.onToggleAll
                ? <SelectAllCheckbox checked={!!selection.allSelected} indeterminate={!!selection.someSelected} onChange={selection.onToggleAll} />
                : <span className="sr-only">선택</span>}
            </th>
          )}
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
              className={[rowOpens ? 'is-clickable' : '', selection?.selected.has(id) ? 'is-selected' : ''].filter(Boolean).join(' ') || undefined}
              onClick={rowClick?.(row)}
              // rowHref면 제목 칸이 진짜 링크라 키보드는 그쪽이 받는다 — 행을 또 tab 대상으로 만들지 않는다
              role={onRowClick && !rowHref ? 'button' : undefined}
              tabIndex={onRowClick && !rowHref ? 0 : undefined}
              onKeyDown={onRowClick && !rowHref ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row) } } : undefined}
            >
              {selection && (
                // 체크박스 클릭이 행 클릭(상세 열기)으로 전파되지 않게 셀 단위로 차단
                <td className="nb-select-cell" data-label="선택" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" className="nb-row-check"
                    aria-label={selection.rowLabel?.(row) ?? '행 선택'}
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
                  {rowHref && c === (columns.find((x) => x.primary) ?? columns[0])
                    ? <Link href={rowHref(row)} className="list-row-link">{c.cell(row)}</Link>
                    : c.cell(row)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  if (!selection?.onToggleAll) return table
  return (
    <>
      {/* 모바일은 thead가 카드 변환으로 숨겨져 헤더의 전체선택이 사라진다 → 표 밖에 같은 기능을 둔다 */}
      <label className="nb-select-all-mobile mobile-only-flex">
        <input type="checkbox" className="nb-row-check" checked={!!selection.allSelected}
          onChange={selection.onToggleAll} aria-label={selection.allSelected ? '전체 선택 해제' : '전체 선택'} />
        전체 선택
      </label>
      {table}
    </>
  )
}
