/**
 * 연차·월별 배분 SSOT — 기간이 있는 금액은 전부 여기를 거친다
 *
 * **왜 계산인가**: 8판은 `yearAllocationJson` 을 손으로 관리하려 했다.
 * 그런데 시작·종료가 이미 있으면 배분은 **나눗셈이다.**
 * 손으로 넣게 두면 기간을 고쳤을 때 배분이 따라오지 않아 조용히 어긋난다.
 *
 * **누가 쓰나**: 현물 명세 · 재원(국비·지방비·자부담) · 견적 라인의 매출 인식.
 * 셋이 같은 함수를 쓰므로 «2027년 얼마»가 어디서든 같은 값이다.
 *
 * **1원도 잃지 않는다**: 월할로 나눈 뒤 잔차를 최대잔여법으로 배분한다(불변식 I7).
 */

import { largestRemainder } from './money.ts'

export interface PeriodAllocation {
  year: number
  /** 그 해에 걸린 개월 수 */
  months: number
  amountMinor: bigint
}

export interface MonthAllocation {
  year: number
  month: number
  amountMinor: bigint
}

/** `YYYY-MM-DD` 또는 Date 를 {y,m} 으로. 시각은 버린다 — 배분은 날짜 단위다 */
function ym(d: Date | string): { y: number; m: number } {
  if (typeof d === 'string') {
    const mres = /^(\d{4})-(\d{2})/.exec(d)
    if (mres) return { y: Number(mres[1]), m: Number(mres[2]) }
    const dt = new Date(d)
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 }
  }
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}

/** 시작~종료가 걸친 달 수 (양 끝 포함). 종료가 시작보다 앞서면 1 */
export function monthSpan(start: Date | string, end: Date | string): number {
  const a = ym(start)
  const b = ym(end)
  const n = (b.y - a.y) * 12 + (b.m - a.m) + 1
  return n < 1 ? 1 : n
}

/**
 * 월별로 고르게 나눈다. 잔차는 앞쪽 달이 먼저 받는다(최대잔여법).
 *
 * 왜 «고르게»인가: 현물은 실제 투입에 따라 정산되지만
 * 견적 시점에 우리가 아는 것은 **기간뿐**이다. 모르는 것을 지어내지 않고
 * 아는 것(기간)으로만 나눈다. 실적이 다르면 그때 실적으로 갱신한다.
 */
export function allocateByMonth(
  amountMinor: bigint,
  start: Date | string,
  end: Date | string,
): MonthAllocation[] {
  const n = monthSpan(start, end)
  const a = ym(start)
  const shares = largestRemainder(amountMinor, Array.from({ length: n }, () => BigInt(1)))
  const out: MonthAllocation[] = []
  for (let i = 0; i < n; i++) {
    const total = a.m - 1 + i
    out.push({ year: a.y + Math.floor(total / 12), month: (total % 12) + 1, amountMinor: shares[i] })
  }
  return out
}

/**
 * 연차별로 묶는다. 월할 안분 결과를 연도로 접는다.
 *
 * 예) 180,000,000 · 2026-03 ~ 2028-02 (24개월)
 *     → 2026년 10개월 75,000,000 · 2027년 12개월 90,000,000 · 2028년 2개월 15,000,000
 */
export function allocateByYear(
  amountMinor: bigint,
  start: Date | string,
  end: Date | string,
): PeriodAllocation[] {
  const months = allocateByMonth(amountMinor, start, end)
  const byYear = new Map<number, PeriodAllocation>()
  for (const m of months) {
    const cur = byYear.get(m.year)
    if (cur) {
      cur.months += 1
      cur.amountMinor += m.amountMinor
    } else {
      byYear.set(m.year, { year: m.year, months: 1, amountMinor: m.amountMinor })
    }
  }
  return Array.from(byYear.values()).sort((a, b) => a.year - b.year)
}

export interface DatedAmount {
  amountMinor: bigint | number | string
  startDate?: Date | string | null
  endDate?: Date | string | null
}

/**
 * 여러 항목의 연차 배분을 합친다 — 현물 명세 3건의 «2027년 합계» 같은 것.
 *
 * 기간이 없는 항목은 **배분하지 않고 빼 둔다.** 0으로 때우면 합계가 조용히 작아진다.
 */
export function sumByYear(items: readonly DatedAmount[]): {
  years: PeriodAllocation[]
  /** 기간이 없어 배분하지 못한 금액 — 화면이 «기간 미정 N원»으로 밝힌다 */
  undatedMinor: bigint
} {
  const acc = new Map<number, PeriodAllocation>()
  let undated = BigInt(0)
  for (const it of items) {
    const amount = typeof it.amountMinor === 'bigint' ? it.amountMinor : BigInt(Math.round(Number(it.amountMinor) || 0))
    if (!it.startDate || !it.endDate) {
      undated += amount
      continue
    }
    for (const y of allocateByYear(amount, it.startDate, it.endDate)) {
      const cur = acc.get(y.year)
      if (cur) {
        cur.amountMinor += y.amountMinor
        cur.months = Math.max(cur.months, y.months)
      } else acc.set(y.year, { ...y })
    }
  }
  return { years: Array.from(acc.values()).sort((a, b) => a.year - b.year), undatedMinor: undated }
}
