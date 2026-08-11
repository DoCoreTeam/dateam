// lib/ci/corpus.ts — 통계 모집단 필터 SSOT
// 설계서 §7.3 데이터 규칙: "모니터링 코퍼스만 표시. 수집함 단건은 통계 제외."
//
// 이 조건을 화면·API마다 복붙하면 한 곳만 빠져도 수집함 단건이 배수 통계에 섞여
// 시장 지표가 조용히 오염된다. 집계 경로는 반드시 이 모듈을 경유한다.

import type { CiContentSource } from './types.ts'

/** Supabase 쿼리 빌더에 적용하는 코퍼스 조건. */
export interface CorpusFilterable {
  eq(column: string, value: unknown): CorpusFilterable
  is(column: string, value: unknown): CorpusFilterable
}

/** 코퍼스 조건의 선언적 표현 — 테스트와 문서화를 위해 값으로도 노출한다. */
export const CORPUS_FILTER = {
  source: 'monitoring' as CiContentSource,
  is_stat_excluded: false,
  deleted_at: null,
} as const

/**
 * 통계 집계 쿼리에 코퍼스 조건을 적용한다.
 * 목록 조회(수집함 등)에는 쓰지 않는다 — 그쪽은 inbox도 보여줘야 한다.
 */
export function applyCorpusFilter<T extends CorpusFilterable>(query: T): T {
  return query
    .eq('source', CORPUS_FILTER.source)
    .eq('is_stat_excluded', CORPUS_FILTER.is_stat_excluded)
    .is('deleted_at', CORPUS_FILTER.deleted_at) as T
}

/** 인메모리 배열에 같은 조건을 적용한다(파생값 계산 경로용). */
export interface CorpusRow {
  source: CiContentSource
  is_stat_excluded: boolean
  deleted_at: string | null
}

export function isInCorpus(row: CorpusRow): boolean {
  return row.source === 'monitoring' && !row.is_stat_excluded && row.deleted_at === null
}

export function filterCorpus<T extends CorpusRow>(rows: readonly T[]): T[] {
  return rows.filter(isInCorpus)
}
