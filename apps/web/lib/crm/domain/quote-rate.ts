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

/** 한 해는 열두 달 — 기간 단위 「년」을 펼 때 쓴다 */
const MONTHS_PER_YEAR = 12

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

/* ── 기간 칸에서 오는 시간 축 ───────────────────────────────────────────────
 *
 * **기간은 「얼마나」이고 날짜는 「언제」다.** 사람은 「2개월」은 아는데
 * 「10/7~12/6」은 모를 때가 많다. 그래서 기간 칸이 따로 있고, 날짜가 있으면 거기서 센다.
 *
 * 실측 2026-10-06: 품목 164줄 가운데 날짜를 적은 줄이 **0줄**이었다 —
 * 날짜 칸은 금액을 안 바꾸기 때문이다. 금액을 안 바꾸는 칸은 아무도 채우지 않는다.
 */

/**
 * 기간을 시간으로 편다.
 *
 * **달력 시간이다.** 17대를 2개월 쓰면 장비-시간은 24,820h 이지만 여기서 세는 것은
 * 1,460h 다 — 수량을 곱하지 않는다. 열일곱 배 차이라 어느 쪽인지 숨기면 안 되고,
 * 시간당 금액을 적는 쪽이 「17대 기준」이라고 이름에 적는다.
 */
export function durationHours(
  value: number | string | null | undefined,
  unit: string | null | undefined,
  hoursPerMonth: number = DEFAULT_HOURS_PER_MONTH,
): number | null {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return null
  const hpm = Number.isFinite(hoursPerMonth) && hoursPerMonth > 0 ? hoursPerMonth : DEFAULT_HOURS_PER_MONTH
  switch (unit) {
    case 'HOUR': return v
    case 'DAY': return v * HOURS_PER_DAY
    case 'MONTH': return v * hpm
    case 'YEAR': return v * MONTHS_PER_YEAR * hpm
    default: return null
  }
}

/**
 * 기간이 단가에 몇 배로 걸리나.
 *
 * **기준 단위가 있는 종류만 환산한다.** 시간당 단가에 「2개월」을 적으면 1,460 이고,
 * 월 단가에 「2개월」이면 2 다. 기준이 없는 종류(수량·공수·라이선스)는 **적은 수 그대로**
 * 곱한다 — 「17대 × 936,000원 × 2개월」의 단가는 「한 대를 한 달」의 값이고,
 * 없는 기준을 지어내 환산하면 사람이 적지 않은 숫자가 금액에 들어간다.
 *
 * 못 세면 null 이다. 1 을 돌려주지 않는다 — 부르는 쪽이 「기간 없음」과 「못 셈」을
 * 구분할 수 있어야 안내 문구가 거짓말을 안 한다.
 */
export function durationFactor(
  value: number | string | null | undefined,
  unit: string | null | undefined,
  priceBasis: 'HOUR' | 'MONTH' | null,
  hoursPerMonth: number = DEFAULT_HOURS_PER_MONTH,
): number | null {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return null
  if (!unit) return null
  if (priceBasis === null) return v

  const hours = durationHours(v, unit, hoursPerMonth)
  if (hours == null) return null
  if (priceBasis === 'HOUR') return hours

  const hpm = Number.isFinite(hoursPerMonth) && hoursPerMonth > 0 ? hoursPerMonth : DEFAULT_HOURS_PER_MONTH
  return hours / hpm
}

/* ── 수량에서 오는 시간 축 ───────────────────────────────────────────────────
 *
 * **시간 축의 근거는 둘이다.** 기간을 적었으면 기간이 세고, 안 적었으면 수량이 센다.
 *
 * GPU 임대 견적은 「1,440 Hours × 1,388원」처럼 **수량 칸에 시간이 그대로 적힌다.**
 * 그 줄에 시작일·종료일을 안 적었다고 총 시간을 모르는 것이 아닌데, 기간만 보던 때는
 * 고객이 체크한 시간당·월 금액이 통째로 사라졌다(실측 2026-10-05: 견적 DA-2026-1003-01
 * 은 고른 축 셋과 근거 셋이 다 저장돼 있었는데 품목 날짜가 비어 한 줄도 안 그려졌다).
 *
 * 날짜는 **언제**를 말하고 수량은 **얼마나**를 말한다. 환산이 필요한 것은 뒤쪽이다.
 */

/** 수량 칸이 시간을 담고 있다고 볼 단위들. 대소문자와 앞뒤 빈칸은 안 가린다 */
const HOUR_UNITS: readonly string[] = ['h', 'hr', 'hrs', 'hour', 'hours', '시간']

/**
 * 수량이 곧 총 시간인가. **단위가 시간을 가리킬 때만** 그 수량을 돌려준다.
 *
 * 「식」이나 「User」를 시간으로 읽으면 1,388원짜리 라이선스 한 식이 시간당 1,388원이 된다 —
 * 아무 근거도 없는 숫자를 고객에게 적어 보내는 것이라 단위를 모르면 아예 세지 않는다.
 */
export function hoursFromQuantity(
  unit: string | null | undefined,
  quantity: number | string | null | undefined,
): number | null {
  const u = (unit ?? '').trim().toLowerCase()
  if (!HOUR_UNITS.includes(u)) return null
  const n = Number(quantity)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/** 총 시간이 월 기준 시간으로 **딱 나뉘면** 그 개월. 안 떨어지면 null 이고 개월을 말하지 않는다 */
export function monthsFromHours(totalHours: number, hoursPerMonth: number): number | null {
  if (!Number.isFinite(totalHours) || totalHours <= 0) return null
  if (!Number.isFinite(hoursPerMonth) || hoursPerMonth <= 0) return null
  const m = totalHours / hoursPerMonth
  return Number.isInteger(m) && m > 0 ? m : null
}

/** 시간 축 하나에서 되짚은 금액 셋 */
export interface HoursRate {
  totalHours: number
  /** 딱 떨어지는 개월. 어중간하면 null */
  months: number | null
  /** 한 달치(minor). 개월을 모르면 null */
  monthlyMinor: number | null
  /** 시간당(minor) */
  hourlyMinor: number | null
  /** 시간당이 나누어떨어졌나 */
  hourlyExact: boolean
}

/**
 * 시간 축에서 금액 셋을 되짚는다. **셈은 늘 저장된 합계에서 내려온다** —
 * 어느 쪽을 적어도 합계와 어긋나지 않고, 반올림 여부만 따로 말한다.
 *
 * 개월을 아는 쪽(기간)은 그 값을 넘기고, 모르는 쪽(수량)은 시간에서 센다.
 */
export function rateFromHours(
  totalMinor: number,
  totalHours: number,
  hoursPerMonth: number,
  months: number | null = monthsFromHours(totalHours, hoursPerMonth),
): HoursRate | null {
  if (!Number.isFinite(totalHours) || totalHours <= 0) return null
  const monthly = monthlyFromTotal(totalMinor, months)
  const hourly = hourlyFromTotal(totalMinor, totalHours)
  return {
    totalHours,
    months,
    monthlyMinor: monthly ? monthly.minor : null,
    hourlyMinor: hourly ? hourly.minor : null,
    hourlyExact: hourly ? hourly.exact : false,
  }
}
