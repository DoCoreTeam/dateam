// 통합 검색 결과 페이지 — 개인 일일 / 부서업무 / 주간보고를 한 화면에서 검색.
// URL(q·types) 동기화로 공유·뒤로가기 가능. SWR Infinite로 커서 페이지네이션('더 보기').
// 상태 3종(로딩/빈 결과/에러) + 검색어 없음 안내 UI.
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { Search, SearchX, AlertTriangle } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import { useDebounce } from '@/hooks/useDebounce'
import ResultCard from './ResultCard'
import {
  FILTER_CHIPS,
  type FilterChip,
  type WorkSearchResponse,
} from './search-types'

const PAGE_LIMIT = 20
const DEBOUNCE_MS = 300

type FilterKey = FilterChip['key']

function parseFilter(raw: string | null): FilterKey {
  const valid = FILTER_CHIPS.map((c) => c.key)
  return (valid as string[]).includes(raw ?? '') ? (raw as FilterKey) : 'all'
}

export default function WorkSearchPage() {
  const router = useRouter()
  const params = useSearchParams()

  const urlQ = params.get('q') ?? ''
  const filter = parseFilter(params.get('types'))

  // 입력은 로컬 상태 → 디바운스 후 URL(q) 갱신(replace로 히스토리 오염 방지)
  const [input, setInput] = useState(urlQ)
  const debounced = useDebounce(input, DEBOUNCE_MS)

  // 뒤로/공유 진입 등 URL이 외부에서 바뀌면 입력 동기화
  useEffect(() => { setInput(urlQ) }, [urlQ])

  // 디바운스된 입력을 URL에 반영
  useEffect(() => {
    if (debounced === urlQ) return
    const next = new URLSearchParams(params.toString())
    if (debounced.trim()) next.set('q', debounced.trim())
    else next.delete('q')
    router.replace(`/work/search?${next.toString()}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const setFilter = useCallback((key: FilterKey) => {
    const next = new URLSearchParams(params.toString())
    if (key === 'all') next.delete('types')
    else next.set('types', key)
    router.replace(`/work/search?${next.toString()}`)
  }, [params, router])

  const q = urlQ.trim()
  const typesParam = filter === 'all' ? '' : `&types=${filter}`

  const getKey = (index: number, prev: WorkSearchResponse | null): string | null => {
    if (!q) return null
    if (prev && !prev.hasMore) return null
    const cursor = prev?.nextCursor ? `&cursor=${encodeURIComponent(prev.nextCursor)}` : ''
    return `/api/work/search?q=${encodeURIComponent(q)}&limit=${PAGE_LIMIT}${typesParam}${cursor}`
  }

  const { data, error, size, setSize, isLoading, isValidating } =
    useSWRInfinite<WorkSearchResponse>(getKey)

  const results = data ? data.flatMap((p) => p.results) : []
  const hasMore = data ? (data[data.length - 1]?.hasMore ?? false) : false
  const isLoadingMore = isValidating && !!data && size > data.length
  const isFirstLoad = !data && isLoading && !!q

  return (
    <section aria-labelledby="work-search-heading">
      <PageHeader
        title="통합 검색"
        description="개인 일일업무 · 부서업무 · 주간보고를 한 번에 찾습니다."
      />
      <h1 id="work-search-heading" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>통합 검색</h1>

      <div className="work-search-input-wrap">
        <Search size={18} aria-hidden="true" className="work-search-input-icon" />
        <input className="input-field work-search-input"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="검색어를 입력하세요…"
          aria-label="업무 통합 검색"
          enterKeyHint="search"
          autoFocus
        />
      </div>

      <div className="work-search-filters" role="group" aria-label="결과 유형 필터">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="work-search-chip"
            aria-pressed={filter === chip.key}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* 검색어 없음 안내 */}
      {!q && (
        <div className="work-search-state">
          <Search size={40} className="work-search-state-icon" aria-hidden="true" />
          <p className="work-search-state-title">검색어를 입력하세요</p>
          <p className="work-search-state-desc">업무 제목·내용으로 일일·부서·주간 기록을 찾아봅니다.</p>
        </div>
      )}

      {/* 에러 */}
      {q && error && (
        <div className="work-search-state" role="alert">
          <AlertTriangle size={40} className="work-search-state-icon" aria-hidden="true" style={{ color: 'var(--danger)' }} />
          <p className="work-search-state-title">검색에 실패했습니다</p>
          <p className="work-search-state-desc">{error.message || '잠시 후 다시 시도해 주세요.'}</p>
          <NbButton variant="secondary" onClick={() => setSize(1)}>다시 시도</NbButton>
        </div>
      )}

      {/* 로딩(첫 페이지) — 스켈레톤 */}
      {isFirstLoad && !error && (
        <div className="work-search-list" aria-busy="true" aria-label="검색 중">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="work-search-skeleton" />
          ))}
        </div>
      )}

      {/* 빈 결과 */}
      {q && !error && !isFirstLoad && results.length === 0 && (
        <div className="work-search-state">
          <SearchX size={40} className="work-search-state-icon" aria-hidden="true" />
          <p className="work-search-state-title">검색 결과가 없습니다</p>
          <p className="work-search-state-desc">&ldquo;{q}&rdquo;에 일치하는 업무를 찾지 못했습니다.</p>
        </div>
      )}

      {/* 결과 리스트 */}
      {q && !error && results.length > 0 && (
        <>
          <div className="work-search-list">
            {results.map((r) => (
              <ResultCard key={`${r.type}-${r.id}`} result={r} query={q} />
            ))}
          </div>
          {hasMore && (
            <div className="work-search-more">
              <NbButton
                variant="secondary"
                onClick={() => setSize(size + 1)}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? '불러오는 중…' : '더 보기'}
              </NbButton>
            </div>
          )}
        </>
      )}
    </section>
  )
}
