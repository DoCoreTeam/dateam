/**
 * 금액을 시간당·월·기간 총액으로 환산한다 (순수 계산).
 *
 * **무엇이 진짜 값이고 무엇이 파생인지는 종류가 정한다.**
 *   · 기간요금(PERIOD): 월 단가가 진짜 값 → 시간당은 그것을 나눈 표시값.
 *     월 기준 시간이 730 이냐 720 이냐는 **합계를 안 바꾸고** 나눈 숫자만 바꾼다.
 *   · 사용량(USAGE): 시간당이 진짜 값 → 월 금액이 파생. 이때는 기준 시간이 합계를 바꾼다.
 *
 * **왜 나누어떨어지는지를 값으로 돌려주나**: 월 999,360원을 730 으로 나누면 1,368.98… 이라
 * 1,369원으로 적게 되는데, 고객이 그 값에 1,460시간을 곱하면 1,998,740원이 되어 합계보다
 * 20원 많다. 720 으로 나누면 딱 떨어져 그 일이 없다 — 그래서 **사람이 「약」을 붙일지 정하지 않고
 * 화면이 이 값을 보고 정한다**(실측 2026-10-04).
 *
 * 날짜는 **날짜 키('YYYY-MM-DD')로만** 다룬다. Date 로 셈하면 저장·조회 경로의 타임존 해석이
 * 섞여 하루가 밀린다. 들어온 Date 는 UTC 기준으로 키를 뽑는다(Prisma 가 UTC 자정으로 저장한다).
 */

/** 하루는 스물네 시간 — 기간을 시간으로 펼 때 쓴다 */
const HOURS_PER_DAY = 24

/** 설정이 비었을 때 쓰는 월 기준 시간. 한 해를 열두 달로 나눈 값 */
export const DEFAULT_HOURS_PER_MONTH = 730

export interface RatePeriod {
  /** 시작일 키 */
  start: string
  /** 종료일 키 */
  end: string
  /**
   * 딱 떨어지는 개월. **안 떨어지면 null** 이다.
   *
   * 임대 관행대로 **시작일과 종료일을 둘 다 센다** — 10월 7일에 시작해 12월 6일에 끝나면
   * 2개월이다(10/7+2개월=12/7, 거기서 하루 뺀 날). 45일처럼 어중간하면 null 이고,
   * 그때는 개월을 말하지 않고 일수와 시간으로만 말한다.
   */
  months: number | null
  /** 시작일과 종료일을 둘 다 센 일수 */
  days: number
  /** 기간 전체의 시간. 개월이 떨어지면 개월 기준, 아니면 일수 기준 */
  totalHours: number
}

export interface ConvertedRate {
  /** 반올림한 금액(minor) */
  minor: number
  /** 나누어떨어졌나. false 면 화면이 「약」을 붙인다 */
  exact: boolean
}

/** 'YYYY-MM-DD' 로 맞춘다. Date 는 UTC 기준으로 읽는다 */
export function toDateKey(v: Date | string | null | undefined): string | null {
  if (!v) return null
  if (typeof v === 'string') return v.length >= 10 ? v.slice(0, 10) : null
  const t = v.getTime()
  if (Number.isNaN(t)) return null
  return v.toISOString().slice(0, 10)
}

/** 날짜 키 → UTC 자정 밀리초. 날짜끼리만 빼므로 타임존이 끼어들 자리가 없다 */
function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** 시작 키에 n 개월을 더한 키. 말일 넘침은 그 달 말일로 당긴다(1/31 + 1개월 = 2/28) */
function addMonths(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0')
  return `${base.getUTCFullYear()}-${mm}-${String(day).padStart(2, '0')}`
}

/**
 * 기간을 센다. 둘 중 하나라도 없으면 null — 기간을 모르면 축을 못 세운다.
 * 끝이 시작보다 앞서면 null(DB CHECK 도 같은 것을 막는다).
 */
export function computePeriod(
  startAt: Date | string | null | undefined,
  endAt: Date | string | null | undefined,
  hoursPerMonth: number = DEFAULT_HOURS_PER_MONTH,
): RatePeriod | null {
  const start = toDateKey(startAt)
  const end = toDateKey(endAt)
  if (!start || !end) return null
  const s = keyToUtc(start)
  const e = keyToUtc(end)
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null

  const days = Math.round((e - s) / 86_400_000) + 1

  // 개월이 딱 떨어지는지 — 시작일에 n 개월을 더하고 하루를 뺀 날이 종료일인가
  let months: number | null = null
  for (let n = 1; n <= 120; n++) {
    const boundary = keyToUtc(addMonths(start, n)) - 86_400_000
    if (boundary === e) { months = n; break }
    if (boundary > e) break
  }

  const totalHours = months != null ? months * hoursPerMonth : days * HOURS_PER_DAY
  return { start, end, months, days, totalHours }
}

/** 나눗셈 한 번 — 반올림한 값과 딱 떨어졌는지를 함께 돌려준다 */
function divide(minor: number, by: number): ConvertedRate {
  if (!Number.isFinite(minor) || !Number.isFinite(by) || by <= 0) return { minor: 0, exact: false }
  return { minor: Math.round(minor / by), exact: minor % by === 0 }
}

/** 월 단가 → 시간당. 기간요금에서 쓴다 */
export function hourlyFromMonthly(monthlyMinor: number, hoursPerMonth: number): ConvertedRate {
  return divide(monthlyMinor, hoursPerMonth)
}

/** 시간당 → 월. 사용량에서 쓴다. 곱셈이라 늘 딱 떨어진다 */
export function monthlyFromHourly(hourlyMinor: number, hoursPerMonth: number): ConvertedRate {
  return { minor: Math.round(hourlyMinor * hoursPerMonth), exact: true }
}

/** 기간 총액 → 월 금액. 개월을 모르면 null */
export function monthlyFromTotal(totalMinor: number, months: number | null): ConvertedRate | null {
  if (months == null || months <= 0) return null
  return divide(totalMinor, months)
}

/** 기간 총액 → 시간당. 총 시간으로 나눈다 */
export function hourlyFromTotal(totalMinor: number, totalHours: number): ConvertedRate | null {
  if (!totalHours || totalHours <= 0) return null
  return divide(totalMinor, totalHours)
}
