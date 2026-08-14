// app/(member)/meeting-notes/list-defaults.ts — 회의노트 목록 기본값
//
// 왜 별도 파일인가: 이 상수는 **서버(page.tsx)와 클라이언트(MeetingListView) 둘 다** 쓴다.
//   예전엔 `'use client'` 파일인 MeetingListView가 export했는데, 서버 컴포넌트가
//   `defaults.sort.key`처럼 **점 접근**을 하는 순간 RSC 경계 위반으로 화면이 통째로 죽었다:
//   "Cannot access sort.key on the server. You cannot dot into a client module
//    from a server component." (v0.7.457 실브라우저에서 발견 — /meeting-notes 전체 크래시)
//   경계를 넘나드는 순수 데이터는 'use client'가 없는 모듈에 둔다.

import type { ListDefaults } from '@/lib/ui/list-query'

export const MEETING_LIST_DEFAULTS: ListDefaults = {
  sort: { key: 'meeting_at', dir: 'desc' },
  view: 'table',
  size: 20,
  // mode(리스트/날짜별/캘린더)·ym은 이 화면의 상태다 — 필터 키로 선언해야 URL 갱신에서 살아남는다
  filterKeys: ['filter', 'mode', 'ym'],
}
