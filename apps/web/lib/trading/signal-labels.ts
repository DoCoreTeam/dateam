/**
 * 신호 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

import type { SignalResult } from './position/pnl.ts'

export const DIRECTION_LABEL: Record<'long' | 'short', string> = {
  long: '매수',
  short: '매도',
}

/** 사람이 어떻게 했나. 결과가 없으면 아직 아무것도 아니다 */
export const SIGNAL_RESULT_LABEL: Record<SignalResult, string> = {
  followed: '따름',
  late: '늦게 따름',
  skipped: '건너뜀',
  expired: '만료',
}

export function signalResultLabel(result: string | null): string {
  if (!result) return '대기'
  return SIGNAL_RESULT_LABEL[result as SignalResult] ?? result
}

/** 가격 한 줄. 자릿수를 고정해 표에서 자리가 안 흔들리게 한다 */
export function formatIndexPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '값 없음'
  return value.toFixed(2)
}

/** 확률 한 줄. 없으면 없다고 말한다 — 0% 로 적으면 「0%로 계산했다」가 된다 */
export function formatProbability(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '보정 없음'
  return `${(value * 100).toFixed(0)}%`
}
