/**
 * 수집 상태의 빈 줄을 뭐라고 부르나 — **주말과 「아직 안 모은 날」은 다르다**
 *
 * ## 왜 필요한가 (실측 2026-09-28)
 *
 * 자료 화면의 수집 상태가 아홉 줄 중 **아홉 줄을 「세션 정보 없음」**으로 적고 있었다.
 * 그런데 그중 9/19·9/20·9/26·9/27 은 **토·일**이다. 장이 안 서는 날이라 봉이 없는 것이
 * 정상이고 사람이 할 일이 없다. 나머지 9/21~9/25 만 평일인데 달력도 봉도 없는,
 * 진짜로 빠진 날이다.
 *
 * 둘을 같은 말로 적으면 화면은 아홉 줄이 빨간 것처럼 보이고, 사람은 무엇을 고쳐야
 * 하는지 고를 수 없다. 넷은 고칠 것이 없고 다섯만 고칠 것이다.
 *
 * ## 요일은 우리가 안다
 *
 * 세션 달력이 비어 있어도 **그날이 토요일인지는 달력 없이 안다.** 모르는 것과
 * 알 수 있는데 안 본 것은 다르다. 공휴일은 여전히 모르지만, 그것은 달력이 채워지면
 * 드러나는 사실이라 「장이 서는데 안 모였다」 쪽으로 남겨 둔다 — 조용히 넘어가는 것보다 낫다.
 */

/** 빈 줄의 종류. 화면은 이 값으로 말을 고른다 */
export type EmptyDayKind = 'weekend' | 'not_collected'

export const EMPTY_DAY_LABEL: Record<EmptyDayKind, string> = {
  weekend: '장이 안 서는 날',
  not_collected: '아직 안 모은 날',
}

export const EMPTY_DAY_HINT: Record<EmptyDayKind, string> = {
  weekend: '주말이라 봉이 없는 것이 맞습니다',
  not_collected: '세션 달력이 그날까지 안 채워져 있어 몇 개가 빠졌는지 셀 수 없습니다',
}

/**
 * 서울 기준 요일. `trade_date` 는 `YYYY-MM-DD` 라 그 자체가 서울 날짜다 —
 * `new Date(s)` 로 읽으면 UTC 자정으로 잡혀 **하루가 밀린다.** 그래서 직접 센다.
 */
export function isWeekendDate(tradeDate: string): boolean {
  const [y, m, d] = tradeDate.split('-').map(Number)
  if (!y || !m || !d) return false
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 || day === 6
}

export function emptyDayKind(tradeDate: string): EmptyDayKind {
  return isWeekendDate(tradeDate) ? 'weekend' : 'not_collected'
}
