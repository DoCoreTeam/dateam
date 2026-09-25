/**
 * 화면과 서버가 함께 쓰는 꼴과 셈 — **`server-only` 밖에 있다**
 *
 * 읽기는 서버만 하지만(`overview.ts`), 그 결과를 그리는 부품은 클라이언트다.
 * 형과 순수 셈이 `server-only` 모듈 안에 있으면 그 부품이 import 하는 순간
 * 빌드가 「서버 전용을 클라이언트에서 부른다」로 죽는다 — 실제로 한 번 죽였다.
 */

export interface DayCoverage {
  tradeDate: string
  /** 그날 접속매매 시간에 있어야 할 1분 봉 수 */
  expected: number
  /** 실제로 있는 1분 봉 수 */
  actual: number
  /** 세션 정보가 없어 셀 수 없는 날 */
  unknown: boolean
  /**
   * 그날 당일 청산 시각 (ISO). 접속매매 종료 − N분이라 **날마다 다르다** —
   * 만기일은 15:05, 평일은 15:20. 화면에 고정 시각을 두지 않는 이유가 이것이다(§6.3).
   */
  sameDayExitAt: string | null
}

export interface JudgmentRow {
  id: string
  contractCode: string
  barCloseAt: string
  judge: string
  status: string
  triggerId: string | null
  rawScore: Record<string, number> | null
  abstainReason: string | null
  decisionAt: string | null
}

export interface RunRow {
  scheduledMinute: string
  status: string
  reason: string | null
  userMessage: string | null
}

export interface TradingOverview {
  contractCode: string | null
  coverage: DayCoverage[]
  judgments: JudgmentRow[]
  recentRuns: RunRow[]
  /** 아직 아무것도 안 모였나. 빈 화면과 고장난 화면을 구분해 말해야 한다 */
  empty: boolean
}

/** 그날 수집이 온전한가. 사람이 「5거래일 결측 없음」을 셀 수 있게 한 줄로 답한다 */
export function isDayComplete(day: DayCoverage): boolean {
  return !day.unknown && day.expected > 0 && day.actual >= day.expected
}

/** 결측 봉 수 */
export function missingCount(day: DayCoverage): number {
  if (day.unknown) return 0
  return Math.max(0, day.expected - day.actual)
}
