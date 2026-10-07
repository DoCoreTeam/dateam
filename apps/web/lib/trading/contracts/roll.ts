/**
 * 월물 교체를 **실제로 판정한다** (§6.3)
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * `shouldRollover` 는 1-A 때 만들었는데 **부르는 곳이 0곳이었다**(실측 2026-09-26).
 * 그래서 근월물은 KIS 마스터가 표시한 것을 그대로 따랐고,
 * 「차월물 거래량이 근월물을 넘은 첫 거래일에 갈아탄다」는 규칙은 문서에만 있었다.
 *
 * 규칙이 없으면 만기 당일까지 유동성이 마른 월물로 판단하게 된다 —
 * 그 월물의 호가는 벌어져 있고, 벌어진 호가는 손절을 못 나가게 한다.
 *
 * ## 하루 한 번이다
 *
 * 교체는 거래일 단위 결정이다. 매분 물으면 KIS 호출이 분마다 하나 더 늘고,
 * 장중에 답이 바뀌면 같은 날 앞뒤 봉이 서로 다른 월물로 판단된다.
 * 그래서 그날 값을 굳히기 전에 **한 번만** 묻는다.
 *
 * ## 거래량은 **거래가 끝난 날**의 것을 본다
 *
 * 묻는 때가 자정이다. 그 시각 「오늘 누적 거래량」은 두 월물 모두 0 근처라,
 * 그것을 견주면 한 계약 차이로 월물이 바뀐다 — 판정이 아니라 동전 던지기다.
 *
 * 실측 2026-10-02: 그렇게 해서 만기가 엿새 남은 10월물(그날 거래량 84,206)을 두고
 * 11월물(957)로 갈아탔다. 11월물은 거래가 듬성해 분봉이 빠지는 분이 많고,
 * 그래서 수집이 매분 `bar_missing` 을 적어 **확정 봉이 하루 종일 0건**이었다.
 *
 * 그래서 묻는 값은 마지막으로 **끝난** 거래일의 하루 거래량이다.
 * 「차월물이 근월물을 넘은 다음 거래일에 갈아탄다」가 원래 규칙이 뜻하던 바이기도 하다.
 */

import { shouldRollover, nextContractOf, type ContractInfo } from './contract-rules.ts'
import { tradingDaysBetween, coversRange, type OpenDay } from '../calendar/trading-days.ts'

export interface RollInput {
  today: string
  contracts: readonly ContractInfo[]
  /** KIS 마스터가 근월물이라고 한 것 */
  frontCode: string
  /** 휴장일 표. 못 받았으면 빈 배열 */
  openDays: readonly OpenDay[]
  /** 설정 `rollover_days_before_last` */
  daysBefore: number
  /**
   * 거래량을 믿을 만하다고 보는 최소 합. 이보다 적으면 판정을 안 한다.
   * 설정 `rollover_min_volume`. 안 주면 기본값
   */
  minVolume?: number
  /**
   * 그 월물의 **마지막으로 끝난 거래일** 하루 거래량을 묻는다. 못 읽으면 null.
   *
   * 당일 누적값을 넘기면 안 된다 — 이 함수가 불리는 때는 자정이고 그때 당일 누적은 0 이다.
   */
  lastSessionVolumeOf: (code: string) => Promise<number | null>
}

/**
 * 하루 거래량 합이 이보다 적으면 둘을 못 견준다. 미니 코스피200 은 한가한 날도
 * 근월물 하루 거래량이 만 단위라, 1,000 은 「거의 안 움직인 날」을 거르는 선이다
 */
export const DEFAULT_MIN_VOLUME = 1_000

export type RollResult =
  | { rolled: false; reason: 'no_next' | 'unknown_volume' | 'unknown_days' | 'front_still_heavier'; frontCode: string }
  | {
      rolled: true
      /**
       * `deadline_reached_while_thin` 은 기한이 와서 갈아탔는데 차월물이 아직 근월물의
       * 절반도 안 되는 날이다. 막을 수 없는 교체지만 그 월물이 왜 한가한지는 이 줄이 답한다
       */
      reason: 'next_volume_exceeded' | 'deadline_reached' | 'deadline_reached_while_thin'
      frontCode: string
      fromCode: string
    }

/**
 * 오늘 갈아탈까.
 *
 * **모르면 안 갈아탄다.** 거래량이나 남은 거래일을 못 읽었는데 갈아타면
 * 근거 없이 월물을 바꾸는 것이고, 바꾼 날의 지표는 앞뒤가 이어지지 않는다.
 * 안 갈아탄 사유는 실행 기록에 남으므로 「왜 그대로인가」는 답할 수 있다.
 */
export async function decideRoll(input: RollInput): Promise<RollResult> {
  const front = input.contracts.find((c) => c.code === input.frontCode)
  const next = nextContractOf(input.contracts)
  if (!front || !next) return { rolled: false, reason: 'no_next', frontCode: input.frontCode }

  if (!coversRange(input.openDays, input.today, front.lastTradingDay)) {
    return { rolled: false, reason: 'unknown_days', frontCode: input.frontCode }
  }
  const daysLeft = tradingDaysBetween(input.openDays, input.today, front.lastTradingDay)
  if (daysLeft === null) return { rolled: false, reason: 'unknown_days', frontCode: input.frontCode }

  const [frontVolume, nextVolume] = await Promise.all([
    input.lastSessionVolumeOf(front.code), input.lastSessionVolumeOf(next.code),
  ])
  if (frontVolume === null || nextVolume === null) {
    /**
     * 기한은 거래량을 안 보고도 온다. 거래량을 못 읽었다고 기한까지 못 본 척하면
     * KIS 가 답을 늦게 주는 날이 만기와 겹쳤을 때 그 월물로 만기 당일을 맞는다
     */
    if (daysLeft <= input.daysBefore) {
      return { rolled: true, reason: 'deadline_reached', frontCode: next.code, fromCode: front.code }
    }
    return { rolled: false, reason: 'unknown_volume', frontCode: input.frontCode }
  }

  /**
   * **둘 다 안 움직인 날로는 못 정한다.**
   *
   * 거래량이 0 대 0 이면 `nextVolume > frontVolume` 이 거짓이라 우연히 안 갈아타지만,
   * 0 대 1 이면 한 계약으로 월물이 바뀐다. 그 한 계약은 정보가 아니다.
   * 모르면 안 갈아탄다는 이 파일의 규율을 여기에도 적용한다 — 기한은 아래에서 그대로 걸린다.
   */
  if (frontVolume + nextVolume < Math.max(1, input.minVolume ?? DEFAULT_MIN_VOLUME)) {
    if (daysLeft <= input.daysBefore) {
      return { rolled: true, reason: 'deadline_reached', frontCode: next.code, fromCode: front.code }
    }
    return { rolled: false, reason: 'unknown_volume', frontCode: input.frontCode }
  }

  const decision = shouldRollover({
    frontVolume, nextVolume, tradingDaysUntilLast: daysLeft, daysBefore: input.daysBefore,
  })
  if (!decision.roll) return { rolled: false, reason: 'front_still_heavier', frontCode: input.frontCode }
  return { rolled: true, reason: decision.reason, frontCode: next.code, fromCode: front.code }
}
