'use client'

// components/ui/list/ListPager.tsx — 페이지 이동 한 벌
//
// 두 모드를 같은 API로 낸다:
//   pages — 기본. 위치를 기억할 수 있고 DOM이 자라지 않는다.
//   more  — 피드형(활동로그·알림)만. 시간순 흐름을 끊지 않는 게 더 중요할 때.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { pageCount, pageWindow, type ListQuery } from '@/lib/ui/list-query'
import type { Counter } from '@/lib/terms'

interface Props {
  query: ListQuery
  /** 총 건수를 아는 목록(offset 페이지네이션) */
  total?: number
  /** 총 건수를 모르는 목록(커서 API) — 더 볼 게 있는지만 안다 */
  hasMore?: boolean
  /**
   * 지금까지 화면에 그려진 건수.
   *
   * 커서형 목록은 '더 보기'를 눌러도 `query.page` 가 올라가지 않는다(URL 에 커서를 싣지 않으므로).
   * 그래서 `size × page` 로 진행량을 계산하면 몇 번을 눌러도 "20/372" 에 멈춘 것처럼 보인다.
   * 실제로 몇 건을 들고 있는지는 목록만 알고 있으니 그 값을 받는다.
   */
  loaded?: number
  onChange: (patch: Partial<ListQuery>) => void
  loading?: boolean
  /**
   * 무엇을 세는지에 따라 붙는 말 (용어집 §03). 사람은 「명」, 회사는 「곳」이다.
   * 안 주면 「건」 — 기록·문서가 목록의 대다수라서다.
   */
  counter?: Counter
}

export default function ListPager({ query, total, hasMore, loaded, onChange, loading, counter = '건' }: Props) {
  if (query.mode === 'more') {
    const known = typeof total === 'number'
    const shown = known
      ? Math.min(total, typeof loaded === 'number' ? loaded : query.size * query.page)
      : undefined
    /**
     * 더 볼 게 있느냐는 **서버가 준 커서**가 먼저다.
     * 숫자만으로 판정하면(shown < total) 그 사이 다른 사람이 회사를 하나 만든 순간
     * 커서는 끝났는데 버튼은 남아, 눌러도 아무것도 안 늘어나는 버튼이 된다.
     */
    const more = typeof hasMore === 'boolean'
      ? hasMore
      : known && (shown as number) < (total as number)
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
  /**
   * 한 쪽뿐이면 페이지 단추 대신 **끝났다는 한 줄**을 적는다.
   *
   * 왜 (사용자 지적 2026-09-19): 서른 몇 줄을 훑어 바닥에 닿았는데 아무 표시가 없어서
   * 「페이지네이션이 없는 건가」 싶었다. 실제로는 한 쪽이라 단추를 안 그린 것인데,
   * 화면은 그 사실을 말한 적이 없다. 없는 것과 끝난 것은 사람에게 같아 보인다.
   *
   * 0건이면 아무것도 안 그린다 — 빈 상태가 이미 그 말을 하고 있고, 두 번 말하면 군더더기다.
   */
  if (count <= 1) {
    if (!total) return null
    return (
      <p className="list-pager list-pager-end">전체 {total.toLocaleString()}{counter}, 여기까지입니다</p>
    )
  }

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
