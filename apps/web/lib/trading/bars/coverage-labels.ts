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
export type EmptyDayKind = 'weekend' | 'before_start' | 'not_collected'

export const EMPTY_DAY_LABEL: Record<EmptyDayKind, string> = {
  weekend: '장이 안 서는 날',
  before_start: '수집 시작 전',
  not_collected: '아직 안 모은 날',
}

export const EMPTY_DAY_HINT: Record<EmptyDayKind, string> = {
  weekend: '주말이라 봉이 없는 것이 맞습니다',
  before_start: '이 날은 수집이 시작되기 전입니다. 봉을 채우려면 아래 CSV 로 채우기를 씁니다',
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

/**
 * 빈 줄이 어느 종류인가.
 *
 * **「아직 안 모았다」와 「모으기 전이었다」는 다른 사실이다** (실측 2026-09-29:
 * 크론이 처음 돈 것은 9/26 01:37 이고 그 앞 평일 9/21~9/25 는 아무도 안 보고 있던 날이다).
 * 앞의 것은 왜 빠졌나를 물어야 하고, 뒤의 것은 물을 것이 없다 — 없는 과거는 코드로 못 만든다.
 * 그 자리에는 대신 **할 수 있는 일**(CSV 로 채우기)을 적는다.
 *
 * @param collectingSince 수집이 시작된 날 (`YYYY-MM-DD`, 서울). 모르면 null —
 *   모르는데 「시작 전」이라고 단정하지 않는다
 */
export function emptyDayKind(tradeDate: string, collectingSince?: string | null): EmptyDayKind {
  if (isWeekendDate(tradeDate)) return 'weekend'
  if (collectingSince && tradeDate < collectingSince) return 'before_start'
  return 'not_collected'
}
