/**
 * 성적 관문 — **쌓인 판단이 비용을 넘겨 벌었을 때만 신호를 낸다**
 *
 * ## 왜 필요한가
 *
 * 실측 2026-11-05: 판단 3,540건을 비용 넣고 채점하니 합계 -17,758,418원, 32일 중 8일만 플러스였다.
 * 그런데 신호를 막던 것은 성적이 아니라 **보정 모델이 없다는 사실**이었다.
 * 보정이 생기는 날 성적과 무관하게 신호가 나간다 — 그것은 관문이 아니라 우연이다.
 *
 * ## 기준은 검증 관문과 같은 값이다 (M4)
 *
 * 건수는 `gate_min_validate_trades`, 손익비는 `gate_min_profit_factor` 를 읽고
 * 손익비 셈은 `stats/metrics.ts` 의 `profitFactor` 를 그대로 쓴다.
 * 여기서 따로 정하면 화면의 관문 줄과 이 관문이 다른 기준으로 통과한다.
 *
 * ## 세 가지 답
 *
 * 건수가 모자라면 **미달이 아니라 아직 못 잼**이다. 둘을 섞으면 표본 열 건으로 전략을 버린다.
 */

import { profitFactor } from '../stats/metrics.ts'
import { isSettled, type JudgmentScore } from './score.ts'

export interface TrackRecord {
  /** 결판이 난 판단 수 (목표·손절·시간·장 마감) */
  settled: number
  /** 번 것 ÷ 잃은 것 (R). 잃은 것이 0이면 null */
  profitFactor: number | null
  /** 비용 포함 순손익 합 (원, 1계약) */
  netKrw: number
}

export interface TrackRecordThresholds {
  minTrades: number
  minProfitFactor: number
}

export type TrackRecordStatus = 'pass' | 'fail' | 'insufficient'

export interface TrackRecordGate {
  status: TrackRecordStatus
  record: TrackRecord
  thresholds: TrackRecordThresholds
  /** 실행 기록에 남길 기계 사유 */
  code: string
}

/**
 * 관문은 **규칙 판단만** 센다. AI 판단은 같은 봉에 규칙과 함께 기록되고 방향이 99.6% 같았다
 * (실측 2026-11-05 1,757건 중 1,750건). 둘을 다 세면 같은 거래를 두 번 세어 건수 기준을
 * 절반의 거래로 채운다
 */
export const GATE_JUDGE = 'rule'

export function trackRecordOf(scores: readonly JudgmentScore[]): TrackRecord {
  const settled = scores.filter((s) => s.judge === GATE_JUDGE && isSettled(s) && s.netPnlR !== null)
  return {
    settled: settled.length,
    profitFactor: profitFactor(settled.map((s) => ({ tradeDate: s.barAt.slice(0, 10), netPnlR: s.netPnlR ?? 0 }))),
    netKrw: settled.reduce((a, s) => a + (s.netPnlKrw ?? 0), 0),
  }
}

export function trackRecordGate(
  record: TrackRecord,
  thresholds: TrackRecordThresholds,
): TrackRecordGate {
  const at = { record, thresholds }
  if (record.settled < thresholds.minTrades) {
    return { ...at, status: 'insufficient', code: `track_record:insufficient:${record.settled}<${thresholds.minTrades}` }
  }
  // 잃은 것이 0이면 손익비가 없다. 무한으로 보면 몇 건으로도 통과한다
  if (record.profitFactor === null || record.profitFactor < thresholds.minProfitFactor) {
    const pf = record.profitFactor === null ? 'none' : record.profitFactor.toFixed(2)
    return { ...at, status: 'fail', code: `track_record:fail:pf=${pf}<${thresholds.minProfitFactor}` }
  }
  return { ...at, status: 'pass', code: 'track_record:pass' }
}

/** 화면에 넘길 모양. 기계 사유(code)는 화면에 안 싣는다 */
export function signalGateViewOf(gate: TrackRecordGate): {
  status: TrackRecordStatus
  settled: number
  profitFactor: number | null
  minTrades: number
  minProfitFactor: number
} {
  return {
    status: gate.status,
    settled: gate.record.settled,
    profitFactor: gate.record.profitFactor,
    minTrades: gate.thresholds.minTrades,
    minProfitFactor: gate.thresholds.minProfitFactor,
  }
}

/** 설정에서 기준을 읽는다. 화면과 tick 이 같은 자리에서 읽어야 같은 기준으로 판정한다 */
export function trackRecordThresholdsOf(values: Readonly<Record<string, unknown>>): TrackRecordThresholds {
  return {
    minTrades: Number(values.gate_min_validate_trades) || 500,
    minProfitFactor: Number(values.gate_min_profit_factor) || 1.25,
  }
}
