/**
 * 거래일 세기 — **주말만 빼면 틀린다**
 *
 * 「최종거래일까지 몇 거래일 남았나」는 월물 교체 기한(§6.3)이 보는 값이다.
 * 주말만 빼고 세면 추석이나 설이 낀 해에 여유가 실제보다 많아 보이고,
 * 그러면 교체가 늦어 만기 당일까지 유동성이 마른 월물로 판단하게 된다.
 *
 * 그래서 KIS 국내휴장일조회가 주는 개장일 표로 센다.
 * **표가 없으면 `null`(모름)** 이다 — 주말만 빼고 센 값을 답으로 내밀지 않는다.
 */

export interface OpenDay {
  /** YYYY-MM-DD (서울) */
  date: string
  open: boolean
}

/**
 * `from` 다음 날부터 `until` 까지의 개장일 수.
 *
 * `from` 은 안 센다 — 「오늘부터 며칠 남았나」에서 오늘은 남은 날이 아니다.
 * `until` 은 센다 — 최종거래일 당일도 거래일이다.
 *
 * 표가 그 구간을 다 덮지 못하면 `null`. 덮은 데까지만 세면 실제보다 적게 나오고,
 * 적게 나오면 기한이 더 가까운 것으로 보여 **너무 일찍 교체한다.**
 */
export function tradingDaysBetween(
  days: readonly OpenDay[],
  from: string,
  until: string,
): number | null {
  if (until <= from) return 0
  if (days.length === 0) return null
  const byDate = new Map(days.map((d) => [d.date, d.open]))
  let count = 0
  for (let cursor = nextDay(from); cursor <= until; cursor = nextDay(cursor)) {
    const known = byDate.get(cursor)
    // 한 날이라도 모르면 답을 못 낸다. 모르는 날을 휴장으로 치면 적게 세고,
    // 개장으로 치면 많이 센다 — 둘 다 지어낸 값이다
    if (known === undefined) return null
    if (known) count += 1
  }
  return count
}

/** 서울 기준 다음 날. 날짜 문자열만 다루므로 시간대 변환이 끼지 않는다 */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d + 1))
  return at.toISOString().slice(0, 10)
}

/** 휴장일 표가 이 구간을 다 덮나. 덮는 데까지 쓰지 말고 미리 묻는다 */
export function coversRange(days: readonly OpenDay[], from: string, until: string): boolean {
  if (until <= from) return true
  const have = new Set(days.map((d) => d.date))
  for (let cursor = nextDay(from); cursor <= until; cursor = nextDay(cursor)) {
    if (!have.has(cursor)) return false
  }
  return true
}
