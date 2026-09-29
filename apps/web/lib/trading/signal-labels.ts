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

/**
 * 주문 계획이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 사용자 지적 2026-09-29: 「얼마동안 이게 유지가 될지 얼마에 들어갔다가 얼마에 나와야
 * 하는지 이런것도 알려주게 되어 있지? 요렇게 되어 있으니 내가 지금 주문을 어떻게 해야
 * 하는지 모르겠어」. 화면에는 방향과 점수만 있었다.
 */
export const PLAN_LABEL = {
  reference: '진입 기준가',
  chase: '진입 한계가',
  stop: '손절가',
  target: '목표가',
  validFor: '진입 유효',
  holdFor: '시간 청산',
  sessionExit: '당일 청산',
} as const

/** 기록에 남은 계획인가 지금 셈한 예고인가. 둘의 무게가 다르다 */
export const PLAN_SOURCE_LABEL: Record<'signal' | 'preview', string> = {
  signal: '신호에 적힌 값입니다',
  preview: '이 판단이 신호가 된다면 나갈 값입니다',
}

/** 분 한 줄. 없거나 0 이하면 없다고 말한다 — 「0분」은 즉시 청산이라는 뜻이 된다 */
export function formatMinutes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '값 없음'
  return `${Math.round(value)}분`
}

/**
 * 손절까지·목표까지 몇 점인가. **거리를 같이 말한다** —
 * 가격만 있으면 그것이 가까운 값인지 먼 값인지 읽는 사람이 빼기를 해야 한다.
 */
export function formatDistance(from: number | null, to: number | null): string {
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return ''
  const gap = Math.abs(to - from)
  return `${gap.toFixed(2)}점`
}
