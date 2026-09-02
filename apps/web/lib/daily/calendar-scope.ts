/**
 * 캘린더가 "이 날에 속한다"고 보는 일일업무 판정 (SSOT).
 *
 * **왜**: 달력 칸(월간 요약)과 날짜를 눌러 여는 패널이 **서로 다른 API**를 쓰면서
 * "이 날의 업무"를 각자 다르게 판정하고 있었다. 그래서 칸에는 내용이 보이는데
 * 눌러서 열면 「이 날 기록이 없어요」가 떴다.
 * (실측 2026-09-02 · michaelkim@data-alliance.com: 9/30 칸에 부서업무 「시티큐브 용인」이
 *  1건 있는데 패널은 0건. 전수 6일이 같은 상태였고 그중 2일은 패널이 통째로 비었다.)
 *
 * 어긋난 지점은 셋이었다:
 * | | 칸 `/api/calendar/month` | 패널 `/api/daily/logs` |
 * |---|---|---|
 * | `task_kind` | 필터 없음 → **부서업무 포함** | `personal` 한정 → **부서업무 탈락** |
 * | 기간 밴드 | `[target_date, target_end_date]` 모든 날 | `target_date` **하루만** |
 * | 온보딩·raw 헤드 | 제외 | 포함 |
 *
 * 이 파일이 그 판정의 **유일한 자리**다. 칸과 패널은 여기서 같은 절과 같은 필터를 가져다 쓴다.
 * 판정을 바꾸려면 여기만 고치면 되고, 한쪽만 고쳐지는 일이 구조적으로 안 생긴다.
 */

import { EXCLUDE_RAW_HEAD_OR } from './raw-head.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 달력에 실재하는 날인지 본다 — 형식만 보면 `2026-02-30` 같은 없는 날이 통과한다.
 *
 * 그런 값은 PostgREST 까지 흘러가 date 파싱에서 터지고, 화면은 「데이터 조회 실패」(500)를
 * 받는다. 사실은 **잘못된 요청**이지 서버 고장이 아니다 — 라우트가 여기서 걸러 400 으로 답한다.
 * (실측 2026-09-02: `/api/daily/logs?date=2026-02-30` → 500. 캘린더 갈래·기본 갈래 둘 다.)
 */
export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function assertDate(label: string, value: string): void {
  if (!isRealDate(value)) {
    throw new Error(`calendar-scope: ${label}는 실재하는 YYYY-MM-DD여야 합니다 — '${value}'`)
  }
}

/**
 * 하루(`date`)에 걸치는 행을 고르는 PostgREST `.or()` 절.
 *
 * 세 갈래를 모두 본다 — 작성일이 그 날 / 마감일이 그 날 / 기간 업무의 밴드가 그 날을 덮음.
 * 밴드를 빼면 「다음 주 전체」 같은 업무가 칸에는 뜨는데 패널에는 안 나온다.
 */
export function calendarDayOr(date: string): string {
  assertDate('date', date)
  return [
    `log_date.eq.${date}`,
    `target_date.eq.${date}`,
    `and(target_date.lte.${date},target_end_date.gte.${date})`,
  ].join(',')
}

/**
 * 기간(`from`~`to`, 양끝 포함)에 걸치는 행을 고르는 PostgREST `.or()` 절.
 * 월간 요약이 쓰는 범위판 — 하루판(`calendarDayOr`)과 **같은 세 갈래**다.
 */
export function calendarRangeOr(from: string, to: string): string {
  assertDate('from', from)
  assertDate('to', to)
  return [
    `and(log_date.gte.${from},log_date.lte.${to})`,
    `and(target_date.gte.${from},target_date.lte.${to})`,
    `and(target_date.lte.${to},target_end_date.gte.${from})`,
  ].join(',')
}

/**
 * 칸과 패널이 함께 거는 캘린더 공통 필터 — 온보딩 실습 행과 원문 raw 헤드를 뺀다.
 *
 * **소프트삭제(`deleted_at`)는 여기 넣지 않는다.** 그건 캘린더만의 규칙이 아니라
 * `daily_logs` 를 읽는 **모든 경로**의 규칙이고, 정적 가드(`lib/daily/soft-delete-guard.test.ts`)가
 * 조회 지점마다 눈에 보이는지를 검사한다. 헬퍼 안으로 숨기면 가드가 못 보고,
 * 그 순간 「지운 업무가 다시 보인다」를 막던 장치가 통째로 헐거워진다.
 *
 * `task_kind`도 **일부러 걸지 않는다.** 캘린더는 개인 업무와 부서업무를 함께 보여준다
 * (부서업무 마감일이 달력에 뜨는 것이 이 화면의 쓸모다). 여기서 `personal`로 좁히면
 * 칸에서 본 부서업무를 패널이 못 찾는 그 사고로 되돌아간다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCalendarScopeFilters<T extends { eq: any; or: any }>(query: T): T {
  return query
    .eq('is_onboarding', false)
    .or(EXCLUDE_RAW_HEAD_OR) as T
}

/** 패널이 캘린더 판정으로 조회할 때 붙이는 쿼리 값 — 화면과 라우트가 같은 문자열을 쓴다. */
export const CALENDAR_SCOPE = 'calendar'
