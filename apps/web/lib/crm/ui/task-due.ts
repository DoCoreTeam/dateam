// lib/crm/ui/task-due.ts — 할 일 마감 칸의 «시작값» SSOT
//
// ## 왜 생겼나 (사용자 지적 2026-09-08)
//
// *"기본적으로 오늘 날짜 부터 잡아야지 비어 있으면 안되지"*
//
// 할 일 추가 폼의 마감 칸이 「연도. 월. 일.」로 비어 시작했다.
// 코드에는 이유가 적혀 있었다 — 「선택 항목이라 기본값을 넣지 않는다.
// '마감 없음'과 '오늘 마감'은 다른 뜻이다」. 뜻이 다르다는 말 자체는 맞다.
//
// 그런데 **실제로 쌓인 할 일이 그 말을 반박한다.** 실측(운영 DB 2026-09-08):
// 목록 4건 중 3건이 「오늘까지」이고, 마감이 빈 1건은 «마감 없음»을 고른 것이 아니라
// **안 넣은 것**으로 보인다. 기본이 비어 있으면 사람은 그 칸을 지나치고,
// 마감 없는 할 일은 목록 맨 아래로 가라앉아 영원히 안 된다.
//
// 그래서 시작값을 **오늘**로 둔다. 「마감 없음」이 정말 필요하면 지우면 되고,
// 그건 **고르는 행위**가 되어 원래 의도했던 «두 뜻의 구분»이 오히려 살아난다.
//
// ## 왜 컴포넌트 밖인가
//
// 두 자리에서 쓴다 — 처음 열 때와 하나 만든 뒤(다음 것을 바로 적게). 두 곳이 갈리면
// 「추가하면 마감이 사라지는」 화면이 된다. 그리고 이 값은 **하이드레이션이 걸린 자리**라
// (서버가 그린 HTML 과 클라이언트 첫 렌더가 같아야 한다) 계산을 한 곳에 모아 둔다.
// `kstTodayKey` 는 타임존이 박힌 포맷터라 서버·클라이언트가 같은 날짜를 낸다.

import { kstTodayKey } from '../../datetime/kst.ts'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 마감 칸에 처음 채울 값.
 *
 * @param param 주소로 넘어온 마감일(`?due=`). 공유 링크가 이기게 한다 —
 *   누가 「이 날짜로 하나 만들어 주세요」를 보냈으면 그 뜻이 오늘보다 앞선다.
 * @param today 기본은 KST 오늘. 시험에서 고정하려고 받는다.
 */
export function initialDueDate(param: string | null | undefined, today: string = kstTodayKey()): string {
  return DATE_ONLY.test(param ?? '') ? (param as string) : today
}

/**
 * 시작일 칸에 처음 채울 값 — **오늘**이다.
 *
 * 사용자 지시(2026-09-08): 「할일도 시작과 종료일이 있어야 할 것 같아」.
 * 종료일은 이미 마감(`dueAt`)이 그 뜻이라, 새로 생긴 것은 시작일 하나다.
 * 마감과 같은 이유로 비워 두지 않는다 — 「오늘부터 하는 일」이 압도적으로 흔하다.
 */
export function initialStartDate(param: string | null | undefined, today: string = kstTodayKey()): string {
  return initialDueDate(param, today)
}

/**
 * 날짜(YYYY-MM-DD)를 서버로 보낼 **KST 앵커 ISO** 로.
 *
 * 시작은 그날 **00:00**, 마감은 그날 **23:59** 다 — 같은 날을 골랐을 때
 * 「시작이 마감보다 늦다」가 되지 않게 하는 것이 이 구분의 이유다.
 * 오프셋 없는 문자열을 그대로 저장하면 UTC 로 적재돼 9시간 어긋난다(§datetime 정책).
 */
export function toStartIso(date: string): string | null {
  return DATE_ONLY.test(date) ? `${date}T00:00:00+09:00` : null
}
export function toDueIso(date: string): string | null {
  return DATE_ONLY.test(date) ? `${date}T23:59:00+09:00` : null
}

/**
 * 시작이 마감보다 늦은가 — **막지 않고 알린다.**
 *
 * 사람이 일부러 그렇게 적는 경우(마감을 먼저 정하고 시작을 뒤로 미룸)가 있고,
 * 저장을 막으면 적던 것을 잃는다. 화면이 한 줄로 말해 주는 편이 낫다.
 */
export function startsAfterDue(start: string, due: string): boolean {
  if (!DATE_ONLY.test(start) || !DATE_ONLY.test(due)) return false
  return start > due
}
