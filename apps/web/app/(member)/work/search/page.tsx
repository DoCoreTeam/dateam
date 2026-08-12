// 통합 검색 결과 페이지 — 개인 일일 / 부서업무 / 주간보고를 한 화면에서 검색.
// 목록 표준(§2-6): 검색어·유형 필터·더보기는 URL이 진실(useListQuery) + ListToolbar/ListSurface/ListPager.
// 데이터는 기존 그대로 /api/work/search 커서 페이지네이션(SWR Infinite).
'use client'

import { useEffect, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import PageHeader from '@/components/ui/PageHeader'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import EmptyState from '@/components/ui/EmptyState'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'
import {
  FILTER_CHIPS,
  SEARCH_TYPE_META,
  type WorkSearchResponse,
  type WorkSearchResult,
} from './search-types'

const PAGE_LIMIT = 20

// 커서 API라 개수는 서버가 정한다. 정렬 축은 서버가 관련도로 고정 → 정렬 선택지를 두지 않는다.
const LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'date', dir: 'desc' },
  mode: 'more',
  view: 'card',
  filterKeys: ['types'],
}

const TYPE_FILTER: ListFilterDef = {
  key: 'types',
  label: '유형',
  options: FILTER_CHIPS.filter((c) => c.key !== 'all').map((c) => ({ value: c.key, label: c.label })),
}

/** plain text를 q 기준으로 분할해 매칭 부분만 <mark>로 강조(대소문자 무시, XSS 안전) */
function highlight(text: string, q: string): ReactNode {
  const query = q.trim()
  if (!query) return text
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let idx = lower.indexOf(qLower, cursor)
  let key = 0
  while (idx >= 0) {
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    parts.push(<mark key={key++}>{text.slice(idx, idx + query.length)}</mark>)
    cursor = idx + query.length
    idx = lower.indexOf(qLower, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function formatDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export default function WorkSearchPage() {
  const router = useRouter()
  const { query, set } = useListQuery(LIST_DEFAULTS, { persistKey: '/work/search' })

  const q = query.q.trim()
  const typeFilter = query.filters.types ?? ''

  const getKey = (index: number, prev: WorkSearchResponse | null): string | null => {
    if (!q) return null
    if (prev && !prev.hasMore) return null
    const cursor = prev?.nextCursor ? `&cursor=${encodeURIComponent(prev.nextCursor)}` : ''
    const types = typeFilter ? `&types=${typeFilter}` : ''
    return `/api/work/search?q=${encodeURIComponent(q)}&limit=${PAGE_LIMIT}${types}${cursor}`
  }

  const { data, error, size, setSize, isLoading, isValidating } =
    useSWRInfinite<WorkSearchResponse>(getKey)

  // '더 보기'는 URL(page)이 진실이다 — 새로고침해도 보던 만큼 다시 불러온다
  useEffect(() => { if (size !== query.page) setSize(query.page) }, [query.page, size, setSize])

  const results = data ? data.flatMap((p) => p.results) : []
  const hasMore = data ? (data[data.length - 1]?.hasMore ?? false) : false

  const columns = useMemo<ColumnDef<WorkSearchResult>[]>(() => [
    {
      key: 'title', header: '제목', primary: true,
      cell: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: SEARCH_TYPE_META[r.type].color }}>
            {SEARCH_TYPE_META[r.type].label}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }}>{highlight(r.title, q)}</span>
        </span>
      ),
    },
    {
      key: 'snippet', header: '내용',
      cell: (r) => r.snippet
        ? <span style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{highlight(r.snippet, q)}</span>
        : <span style={{ color: 'var(--text-faint)' }}>—</span>,
    },
    {
      key: 'date', header: '날짜', align: 'right',
      cell: (r) => <time dateTime={r.date} style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{formatDate(r.date)}</time>,
    },
  ], [q])

  // PageHeader의 h1에는 id가 없다 — 끊긴 aria-labelledby 대신 섹션에 직접 이름을 준다
  return (
    <section aria-label="통합 검색">
      <PageHeader
        title="통합 검색"
        description="개인 일일업무 · 부서업무 · 주간보고를 한 번에 찾습니다."
      />

      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="업무 제목·내용으로 검색"
        filters={[TYPE_FILTER]}
        views={['card']}
        showSize={false}
        total={q && !isLoading ? results.length : undefined}
      />

      {!q ? (
        <EmptyState
          title="검색어를 입력하세요"
          description="업무 제목·내용으로 일일·부서·주간 기록을 찾아봅니다."
        />
      ) : (
        <>
          <ListSurface
            rows={results}
            columns={columns}
            query={query}
            rowKey={(r) => `${r.type}-${r.id}`}
            onChange={set}
            loading={isLoading}
            error={error ? { message: '검색에 실패했습니다', code: error.message, onRetry: () => { void setSize(1) } } : null}
            empty={{ title: '검색 결과가 없습니다', description: `“${q}”에 일치하는 업무를 찾지 못했습니다. 다른 낱말로 찾아보세요.` }}
            onRowClick={(r) => router.push(r.href)}
          />
          <ListPager query={query} hasMore={hasMore} onChange={set} loading={isValidating && !isLoading} />
        </>
      )}
    </section>
  )
}
