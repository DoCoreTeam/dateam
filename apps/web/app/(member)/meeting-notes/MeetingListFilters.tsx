'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useDebounce } from '@/hooks/useDebounce'

interface Props {
  q: string
  sort: string
  filter: string
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: '전체 상태' },
  { value: 'draft', label: '작성중' },
  { value: 'final', label: '확정' },
  { value: 'archived', label: '보관' },
]

const SORTS: { value: string; label: string }[] = [
  { value: 'recent', label: '최근 회의순' },
  { value: 'oldest', label: '오래된 회의순' },
  { value: 'created', label: '최근 작성순' },
  { value: 'title', label: '제목순' },
]

// 검색/정렬/필터 상태를 URL 쿼리스트링에 동기화 — 공유·뒤로가기 가능.
export default function MeetingListFilters({ q, sort, filter }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState(q)
  const debouncedSearch = useDebounce(search, 300)
  // 외부(뒤로가기 등)로 q가 바뀌면 입력값을 동기화. 사용자가 친 직후의 덮어쓰기는 방지.
  const lastPushed = useRef(q)

  function pushParams(next: { q?: string; sort?: string; filter?: string }) {
    const params = new URLSearchParams()
    const nq = next.q !== undefined ? next.q : search
    const nSort = next.sort !== undefined ? next.sort : sort
    const nFilter = next.filter !== undefined ? next.filter : filter
    if (nq.trim()) params.set('q', nq.trim())
    if (nSort !== 'recent') params.set('sort', nSort)
    if (nFilter !== 'all') params.set('filter', nFilter)
    // 필터 변경 시 1페이지로 리셋 (page 키 미설정)
    const qs = params.toString()
    router.push(`/meeting-notes${qs ? `?${qs}` : ''}`)
  }

  // 디바운스된 검색어가 현재 URL의 q와 다르면 URL 갱신.
  useEffect(() => {
    if (debouncedSearch.trim() === q.trim()) return
    lastPushed.current = debouncedSearch
    pushParams({ q: debouncedSearch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  // URL q가 입력과 어긋나면(뒤로가기 등) 입력을 맞춤.
  useEffect(() => {
    if (q !== lastPushed.current) {
      setSearch(q)
      lastPushed.current = q
    }
  }, [q])

  const hasFilters = Boolean(search) || filter !== 'all' || sort !== 'recent'

  function reset() {
    setSearch('')
    lastPushed.current = ''
    router.push('/meeting-notes')
  }

  return (
    <div className="filter-bar">
      <div className="filter-search-wrap">
        <Search size={14} />
        <input className="filter-search"
          placeholder="제목·본문 검색…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="회의노트 검색"
        />
      </div>

      <select className="filter-select"
        value={filter}
        onChange={(e) => pushParams({ filter: e.target.value })}
        aria-label="상태 필터"
      >
        {STATUS_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      <select className="filter-select"
        value={sort}
        onChange={(e) => pushParams({ sort: e.target.value })}
        aria-label="정렬"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {hasFilters && (
        <button className="filter-clear" onClick={reset}>
          <X size={13} /> 초기화
        </button>
      )}
    </div>
  )
}
