// 통합 검색 결과 타입 메타 — API 응답 type('daily'|'dept'|'weekly')별 라벨/색을 한 곳에 둠(SSOT).
// 색은 lib/tokens/status-colors의 STATUS_COLORS 의미색을 재사용(복붙 금지).
import { STATUS_COLORS } from '@/lib/tokens/status-colors'

export type WorkSearchType = 'daily' | 'dept' | 'weekly'

export interface WorkSearchResult {
  type: WorkSearchType
  id: string
  title: string
  snippet: string
  date: string
  href: string
}

export interface WorkSearchResponse {
  results: WorkSearchResult[]
  nextCursor: string | null
  hasMore: boolean
}

export interface SearchTypeMeta {
  label: string
  color: string // 텍스트/보더 의미색
}

// 일일=진행중(파랑), 부서=예정(보라), 주간=메모(주황) 의미색 차용 — 시각 구분 명확.
export const SEARCH_TYPE_META: Record<WorkSearchType, SearchTypeMeta> = {
  daily: { label: '일일', color: STATUS_COLORS.doing.color },
  dept: { label: '부서', color: STATUS_COLORS.planned.color },
  weekly: { label: '주간', color: STATUS_COLORS.note.color },
}

export const SEARCH_TYPE_ORDER: WorkSearchType[] = ['daily', 'dept', 'weekly']

// 필터 칩 정의 — '전체'는 빈 선택(types 파라미터 생략)으로 표현.
export interface FilterChip {
  key: 'all' | WorkSearchType
  label: string
}

export const FILTER_CHIPS: FilterChip[] = [
  { key: 'all', label: '전체' },
  { key: 'daily', label: '일일' },
  { key: 'dept', label: '부서' },
  { key: 'weekly', label: '주간' },
]
