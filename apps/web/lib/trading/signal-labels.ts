/**
 * 신호 화면이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

import type { SignalResult } from './position/pnl.ts'
import { fmtNum, fmtNumOr } from '../ui/number-format.ts'

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

/**
 * 가격 한 줄. 자릿수를 고정해 표에서 자리가 안 흔들리게 하고, **천 단위에 쉼표를 단다**.
 *
 * 쉼표는 장식이 아니다 — 지수가 1000 을 넘으므로 「1086.44」는 자릿수를 세어야 읽힌다
 * (사용자 지적 2026-09-30 「모든 숫자에 콤마찍는건 기본 아닌가」). 굽는 자리는
 * `lib/ui/number-format.ts` 한 곳이다.
 */
export function formatIndexPrice(value: number | null): string {
  return fmtNumOr(value, '값 없음', 2)
}

/** 확률 한 줄. 없으면 없다고 말한다 — 0% 로 적으면 「0%로 계산했다」가 된다 */
export function formatProbability(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '보정 없음'
  return `${fmtNum(value * 100, 0)}%`
}

/*
  **`PLAN_LABEL` 은 여기서 없앴다.**

  「진입 기준가·진입 한계가·손절가·목표가」는 값 이름이었고, 값 이름만으로는 무엇을
  하라는 것인지 안 읽혔다 (사용자 지시 2026-09-30 「젤 명확한게 얼마에 사고 얼마에
  팔아라 (…) 이게 핵심이야」). 지금은 `chart/order-card.ts` 가 같은 값을 말로 바꾼다 —
  「1084.22 에 팝니다」처럼. 이름표를 두 벌 두면 화면마다 다른 말이 된다.
*/

/** 기록에 남은 계획인가 지금 셈한 예고인가. 둘의 무게가 다르다 */
export const PLAN_SOURCE_LABEL: Record<'signal' | 'preview', string> = {
  signal: '신호에 적힌 값입니다',
  preview: '이 판단이 신호가 된다면 나갈 값입니다',
}

/*
  **`formatMinutes` 와 `formatDistance` 도 없앴다.**

  길이(「15분」)와 점수 차(「1.47점」)를 적던 자리는 이제 각각 시각(「오후 02:11 쯤」)과
  돈(「+73,500원」)을 적는다 — 둘 다 `chart/order-card.ts` 가 만든다
  (사용자 지시 2026-09-30 「몇 점 이게 필요한것도 아닌데」).
*/

/**
 * 마감까지 남은 시간 한 줄. **지났으면 지났다고 말한다** —
 * 지난 시각을 그대로 두면 아직 들어가도 되는 것으로 읽힌다.
 */
export function deadlineLeftText(deadlineIso: string | null, now: Date): string {
  if (!deadlineIso) return ''
  const left = Date.parse(deadlineIso) - now.getTime()
  if (!Number.isFinite(left)) return ''
  const totalSeconds = left > 0
    ? Math.ceil(left / 1_000)
    : Math.floor(Math.abs(left) / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}분 ${seconds}초 ${left > 0 ? '남음' : '지남'}`
}
