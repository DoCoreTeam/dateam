'use client'

// components/ui/list/ListToolbar.tsx — 목록 상단 한 줄 규격
//
// 왜: 검색·필터·정렬·보기전환이 화면마다 다른 자리에 다른 모양으로 있었다
//   (전수 검색 결과 공용 부품 0건). 사용자는 화면을 옮길 때마다 다시 찾아야 했다.
// 선택 모드(일괄 작업)와 휴지통 필터도 여기로 흡수한다 — 별도 바를 띄우면
//   목록 위에 줄이 두 개가 되고, 그 둘의 자리가 또 화면마다 달라진다.

import { useEffect, useState, type ReactNode } from 'react'
import { Search, X, LayoutGrid, List as ListIcon, Rows3 } from 'lucide-react'
import { isEnterKey } from '@/lib/ui/ime'
import type { ListQuery, ListView } from '@/lib/ui/list-query'
import { LIST_SIZES } from '@/lib/ui/list-query'
import type { ListFilterDef } from './types'

const VIEW_META: Record<ListView, { label: string; icon: ReactNode }> = {
  table: { label: '표', icon: <ListIcon size={14} /> },
  card: { label: '카드', icon: <LayoutGrid size={14} /> },
  compact: { label: '조밀', icon: <Rows3 size={14} /> },
}

interface Props {
  query: ListQuery
  onChange: (patch: Partial<ListQuery>) => void
  searchPlaceholder?: string
  filters?: ListFilterDef[]
  sortOptions?: { key: string; label: string }[]
  /** 이 화면이 제공할 보기. 1개면 전환 버튼을 숨긴다 */
  views?: ListView[]
  /** 검색 결과 총 건수 — 필터가 먹었는지 사용자가 확인하는 유일한 신호 */
  total?: number
  /** 선택 모드(일괄 작업). count가 0이면 평소 도구줄을 보여준다 */
  selection?: { count: number; onClear: () => void; actions: ReactNode }
  /** 페이지 크기를 서버가 고정하는 목록(커서 API)은 끈다 — 안 먹는 선택지를 두지 않는다 */
  showSize?: boolean
  /** 목록 오른쪽 끝 액션(새로 만들기 등) */
  actions?: ReactNode
}

export default function ListToolbar({
  query, onChange, searchPlaceholder = '검색', filters = [], sortOptions = [],
  views = ['table', 'card'], total, selection, actions, showSize = true,
}: Props) {
  // 타이핑마다 서버를 때리지 않는다. 확정(Enter/blur)에만 조회한다.
  const [draft, setDraft] = useState(query.q)
  useEffect(() => { setDraft(query.q) }, [query.q])

  if (selection && selection.count > 0) {
    return (
      <div className="list-toolbar list-toolbar-selection" role="toolbar" aria-label="선택 작업">
        <span className="list-selection-count">{selection.count}건 선택됨</span>
        <div className="list-toolbar-right">
          {selection.actions}
          <button type="button" className="btn-ghost" onClick={selection.onClear}>선택 해제</button>
        </div>
      </div>
    )
  }

  return (
    <div className="list-toolbar" role="toolbar" aria-label="목록 도구">
      <div className="list-search">
        <Search size={15} aria-hidden />
        <input className="input-field" type="search"
          value={draft}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) onChange({ q: draft.trim() }) }}
          onBlur={() => { if (draft.trim() !== query.q) onChange({ q: draft.trim() }) }}
        />
        {query.q && (
          <button type="button" className="list-search-clear" aria-label="검색어 지우기"
            onClick={() => onChange({ q: '' })}>
            <X size={14} />
          </button>
        )}
      </div>

      {filters.map((f) => (
        <label key={f.key} className="list-filter">
          <span className="sr-only">{f.label}</span>
          <select className="input-field"
            value={query.filters[f.key] ?? ''}
            aria-label={f.label}
            onChange={(e) => onChange({ filters: { [f.key]: e.target.value } })}
          >
            <option value="">{f.label} 전체</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}

      {sortOptions.length > 0 && (
        <label className="list-filter">
          <span className="sr-only">정렬</span>
          <select className="input-field"
            value={`${query.sort.key}:${query.sort.dir}`}
            aria-label="정렬"
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':')
              onChange({ sort: { key, dir: dir === 'asc' ? 'asc' : 'desc' } })
            }}
          >
            {sortOptions.flatMap((s) => ([
              <option key={`${s.key}:desc`} value={`${s.key}:desc`}>{s.label} ↓</option>,
              <option key={`${s.key}:asc`} value={`${s.key}:asc`}>{s.label} ↑</option>,
            ]))}
          </select>
        </label>
      )}

      <div className="list-toolbar-right">
        {typeof total === 'number' && <span className="list-total">{total.toLocaleString()}건</span>}

        {views.length > 1 && (
          <div className="list-views" role="group" aria-label="보기 전환">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                className={`list-view-btn${query.view === v ? ' is-active' : ''}`}
                aria-pressed={query.view === v}
                title={`${VIEW_META[v].label} 보기`}
                onClick={() => onChange({ view: v })}
              >
                {VIEW_META[v].icon}
                <span className="sr-only">{VIEW_META[v].label} 보기</span>
              </button>
            ))}
          </div>
        )}

        {showSize && (
        <label className="list-filter">
          <span className="sr-only">한 번에 볼 개수</span>
          <select className="input-field"
            value={query.size}
            aria-label="한 번에 볼 개수"
            onChange={(e) => onChange({ size: Number(e.target.value) as ListQuery['size'] })}
          >
            {LIST_SIZES.map((s) => <option key={s} value={s}>{s}개씩</option>)}
          </select>
        </label>
        )}

        {actions}
      </div>
    </div>
  )
}
