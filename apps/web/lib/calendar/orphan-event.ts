// 고아 캘린더 일정 판정 SSOT(순수·테스트 대상).
// 자동생성 일정(link_kind='daily')은 원본 일일업무에서 파생된다. 원본이 삭제(하드/소프트)되면
// deleteDailyLog의 cascade가 보통 정리하지만, 직접 DB 삭제·재분석 등 우회 경로로 고아가 남을 수 있다.
// 캘린더는 "원본 업무가 살아있는" 자동생성 일정만 보여야 한다(읽기 시점 방어 — 비파괴적).

export interface DailyLinkableEvent {
  user_id: string
  link_kind: string | null
  link_id: string | null
}

/**
 * 본인 소유의 자동생성(link_kind='daily') 일정인데 원본 일일업무가 살아있지 않으면 고아.
 * - 본인 소유에만 적용: 타인(조직계층) 일정의 링크 로그는 RLS로 못 읽어 오탐하므로 제외.
 * - link_id 없는 수동 일정, 다른 link_kind는 대상 아님.
 * @param liveLogIds 살아있는(soft-delete 아님) 일일업무 id 집합.
 */
export function isOrphanDailyEvent(
  ev: DailyLinkableEvent,
  currentUserId: string,
  liveLogIds: Set<string>,
): boolean {
  return (
    ev.user_id === currentUserId &&
    ev.link_kind === 'daily' &&
    !!ev.link_id &&
    !liveLogIds.has(ev.link_id)
  )
}
