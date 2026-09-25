/**
 * 묶음 봉을 **언제** 만드나 — 순수 판정
 *
 * ## 왜 판정을 따로 두나 (실측 2026-09-26)
 *
 * `aggregateBars` 는 단정 15개로 검증돼 있었는데 **아무도 안 불렀다.**
 * 잘 도는 함수와 실제로 도는 함수는 다른 사실이고, 시험은 앞만 봤다.
 * 이제 「지금 묶을 때인가」를 따로 물어 그 판정 자체를 시험할 수 있게 한다.
 *
 * ## 규칙
 *
 * 방금 확정한 1분 봉이 묶음 구간의 **마지막 분**일 때만 묶는다.
 * 구간 중간에 묶으면 아직 안 온 분을 빼고 묶게 되고, 그 봉은 다른 시장을 요약한 값이
 * 되는데 겉으로는 멀쩡한 봉과 구분되지 않는다.
 */

import type { Timeframe } from './confirm.ts'
import { TIMEFRAME_MINUTES } from './confirm.ts'

/** 1-A 가 모으는 묶음 봉. 15분은 1-B 비교에서 켠다(명세 §3.2 는 1분·5분) */
export const ROLLUP_TIMEFRAMES: readonly Timeframe[] = ['5m']

/**
 * 방금 확정한 1분 봉이 이 묶음 구간을 **닫는가**.
 *
 * 구간은 자정 눈금으로 나뉜다 — 09:00·09:05… 가 되어 거래소 눈금과 맞는다.
 */
export function closesBucket(barStartAt: Date, tf: Timeframe): boolean {
  const size = TIMEFRAME_MINUTES[tf]
  if (size <= 1) return false
  const minutesFromEpoch = Math.floor(barStartAt.getTime() / 60_000)
  return (minutesFromEpoch + 1) % size === 0
}

/** 그 묶음 구간의 시작 시각. 이 시각부터 size 분을 읽어 묶는다 */
export function bucketStartOf(barStartAt: Date, tf: Timeframe): Date {
  const spanMs = TIMEFRAME_MINUTES[tf] * 60_000
  return new Date(Math.floor(barStartAt.getTime() / spanMs) * spanMs)
}

/** 지금 닫히는 묶음들. 하나도 없으면 빈 배열 */
export function bucketsClosedBy(barStartAt: Date): { tf: Timeframe; from: Date }[] {
  return ROLLUP_TIMEFRAMES
    .filter((tf) => closesBucket(barStartAt, tf))
    .map((tf) => ({ tf, from: bucketStartOf(barStartAt, tf) }))
}

/** KIS 시세 응답에서 미결제약정. 못 읽으면 null — 0 으로 때우지 않는다 */
export function openInterestOf(price: Readonly<Record<string, string>> | null): number | null {
  if (!price) return null
  const raw = price.hts_otst_stpl_qty
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
