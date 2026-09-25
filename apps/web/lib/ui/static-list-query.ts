/**
 * 조작이 없는 목록의 질의값
 *
 * `ListSurface` 는 검색·정렬·쪽 넘김을 함께 다루는 부품이라 질의값을 받는다.
 * 그런데 **읽기만 하는 상태 표**는 그 조작이 없다 — 그렇다고 표를 직접 짜면
 * 모바일 카드 변환과 빈 상태가 그 화면에서만 달라진다(`lib/ui/list-standard.test.ts`).
 *
 * 그래서 「조작 없음」을 값 하나로 못 박아 둔다. 화면마다 빈 객체를 손으로 지으면
 * 어느 화면은 `view` 를 빠뜨리고 그 화면만 다르게 그려진다.
 */

import type { ListQuery } from './list-query.ts'

export const STATIC_LIST_QUERY: ListQuery = {
  q: '',
  sort: { key: '', dir: 'desc' },
  filters: {},
  view: 'table',
  size: 100,
  mode: 'pages',
  page: 1,
}
