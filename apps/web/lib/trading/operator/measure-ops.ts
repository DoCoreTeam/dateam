import 'server-only'

/**
 * 운영자 점검이 볼 값을 잰다 (§16)
 *
 * ## 왜 늦게 생겼나
 *
 * `tick` 이 `runOperatorJob` 에 넘기던 열한 칸이 **전부 `null`** 이었다(실측 2026-09-26).
 * 주석은 「1-C 는 아직 이 값들을 한자리에 모으지 않는다」고 적어 두었는데,
 * 그 뒤 게이트 재기(`measureGate`)·시장 재기(`measureMarket`)·감시(`runWatch`)가
 * 생기면서 **거의 다 모였다.** 주석이 코드보다 늦은 것이다.
 *
 * 전부 null 이면 점검은 매번 「잴 수 없음」만 말하고, 그것은 점검을 안 하는 것과 같다.
 *
 * ## 못 재는 것은 그대로 null
 *
 * 0 으로 접지 않는다. `actualBars: 0` 은 「어제 봉이 하나도 없다」는 강한 사실이고,
 * 「못 셌다」와 전혀 다르다. 앞의 것은 경보고 뒤의 것은 침묵이다.
 */

import { countBarsBetween } from '../bars/store.ts'
import { pendingNotifications } from '../notify/outbox.ts'
import { expectedBarCount } from './ops-core.ts'

export interface OpsMeasureInput {
  contractCode: string
  /** 어제 세션의 접속매매 구간. 모르면 null */
  previousSession: { start: Date; end: Date } | null
  now: Date
}

export interface OpsMeasurement {
  expectedBars: number | null
  actualBars: number | null
  pendingNotifications: number | null
  /** 못 잰 것들. 실행 기록에 실린다 */
  unmeasured: string[]
}

/**
 * 봉 수와 대기 알림을 잰다. **하나가 실패해도 나머지는 잰다** —
 * 한 값을 못 읽었다고 점검 전체를 포기하면 그때가 제일 위험한 순간이다.
 */
export async function measureOps(input: OpsMeasureInput): Promise<OpsMeasurement> {
  const unmeasured: string[] = []
  const expected = input.previousSession
    ? expectedBarCount(input.previousSession.start, input.previousSession.end)
    : null
  if (expected === null) unmeasured.push('expectedBars')

  let actual: number | null = null
  if (input.previousSession) {
    try {
      actual = await countBarsBetween({
        contractCode: input.contractCode,
        tf: '1m',
        from: input.previousSession.start,
        to: input.previousSession.end,
      })
    } catch { unmeasured.push('actualBars') }
  } else {
    unmeasured.push('actualBars')
  }

  let pending: number | null = null
  try {
    pending = (await pendingNotifications(input.now)).length
  } catch { unmeasured.push('pendingNotifications') }

  return { expectedBars: expected, actualBars: actual, pendingNotifications: pending, unmeasured }
}
