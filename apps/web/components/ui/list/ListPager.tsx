'use client'

// components/ui/list/ListPager.tsx — 페이지 이동 한 벌
//
// 두 모드를 같은 API로 낸다:
//   pages — 기본. 위치를 기억할 수 있고 DOM이 자라지 않는다.
//   more  — 피드형(활동로그·알림)만. 시간순 흐름을 끊지 않는 게 더 중요할 때.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { pageCount, pageWindow, type ListQuery } from '@/lib/ui/list-query'

interface Props {
  query: ListQuery
  /** 총 건수를 아는 목록(offset 페이지네이션) */
  total?: number
  /** 총 건수를 모르는 목록(커서 API) — 더 볼 게 있는지만 안다 */
  hasMore?: boolean
  onChange: (patch: Partial<ListQuery>) => void
  loading?: boolean
}

export default function ListPager({ query, total, hasMore, onChange, loading }: Props) {
  if (query.mode === 'more') {
    const known = typeof total === 'number'
    const shown = known ? Math.min(total, query.size * query.page) : undefined
    // 총 건수를 아는 목록은 남은 양을 보여주고, 커서형은 더 있는지만 말한다
    const more = known ? (shown as number) < (total as number) : !!hasMore
    if (!more) return null
    return (
      <div className="list-pager list-pager-more">
        <button type="button" className="btn-ghost" disabled={loading}
          onClick={() => onChange({ page: query.page + 1 })}>
          {loading ? <AXDotLoader /> : known ? `더 보기 (${(shown as number).toLocaleString()}/${(total as number).toLocaleString()})` : '더 보기'}
        </button>
      </div>
    )
  }

  const count = pageCount(total ?? 0, query.size)
  if (count <= 1) return null

  return (
    <nav className="list-pager" aria-label="페이지 이동">
      <button type="button" className="list-page-btn" disabled={query.page <= 1}
        aria-label="이전 페이지" onClick={() => onChange({ page: query.page - 1 })}>
        <ChevronLeft size={16} />
      </button>

      {pageWindow(query.page, count).map((n) => (
        <button
          key={n}
          type="button"
          className={`list-page-btn${n === query.page ? ' is-active' : ''}`}
          aria-current={n === query.page ? 'page' : undefined}
          onClick={() => onChange({ page: n })}
        >
          {n}
        </button>
      ))}

      <button type="button" className="list-page-btn" disabled={query.page >= count}
        aria-label="다음 페이지" onClick={() => onChange({ page: query.page + 1 })}>
        <ChevronRight size={16} />
      </button>
    </nav>
  )
}
