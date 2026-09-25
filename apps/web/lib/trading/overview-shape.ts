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

/** 신호 한 줄. 화면이 확인 단추를 그리는 데 필요한 것만 */
export interface SignalRow {
  id: string
  contractCode: string
  direction: 'long' | 'short'
  referencePrice: number
  stopPrice: number
  targetPrice: number
  barCloseAt: string
  notifySentAt: string | null
  openedAt: string | null
  ackAt: string | null
  orderAt: string | null
  fillAt: string | null
  result: string | null
  userReportedStop: number | null
  /** 보정 확률. 없으면 이 신호는 안 나갔어야 한다(M3) */
  calibratedProb: number | null
}

export interface RunRow {
  scheduledMinute: string
  status: string
  reason: string | null
  userMessage: string | null
}

import type { CriterionResult } from './gate/criteria.ts'

export type { CriterionResult }

/** 관문 판정. 아직 아무것도 못 쟀으면 criteria 가 비어 있다 */
export interface GateSummary {
  passed: boolean
  failedCount: number
  insufficientCount: number
}

export interface TradingOverview {
  contractCode: string | null
  coverage: DayCoverage[]
  judgments: JudgmentRow[]
  recentRuns: RunRow[]
  /** 최근 신호. 1-C 전에는 늘 비어 있다 */
  signals: SignalRow[]
  gate: GateSummary
  /** 관문 항목별 판정 */
  gateCriteria: CriterionResult[]
  /** 아직 아무것도 안 모였나. 빈 화면과 고장난 화면을 구분해 말해야 한다 */
  empty: boolean
}

/**
 * 신호가 아직 살아 있나 — 유효 시간 안인가.
 *
 * 결과가 이미 적힌 신호는 지나간 것이다. 살아 있는 것만 단추를 그린다 —
 * 지나간 신호에 단추가 남아 있으면 사람은 눌러도 되는 줄 안다.
 */
export function isSignalActionable(row: SignalRow, now: Date, validMinutes: number): boolean {
  if (row.result !== null) return false
  return now.getTime() <= Date.parse(row.barCloseAt) + validMinutes * 60_000
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
