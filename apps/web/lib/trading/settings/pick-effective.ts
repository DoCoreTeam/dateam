/**
 * 여러 판 중 이 거래일에 유효한 하나를 고른다 — 순수 함수
 *
 * `store.ts` 에서 떼어 냈다. 저장소는 `server-only` 라 테스트가 import 하는 순간 죽는데,
 * **정작 틀리기 쉬운 것은 이 고르기**다. 유효 시작일이 기준일보다 뒤인 줄을 안 거르면
 * 미리 저장해 둔 다음 판이 오늘 판단에 섞이고, 「전략 변경은 다음 거래일부터」가
 * 그 자리에서 깨진다. 죽는 자리가 아니라 **틀리는 자리**를 시험할 수 있어야 한다.
 */

import type { TradingSettingValue } from './registry.ts'

export interface EffectiveRow {
  key: string
  value: TradingSettingValue
  version: number
  /** `YYYY-MM-DD`. 글자 비교로 날짜 비교가 되는 꼴이라 그대로 비교한다 */
  effective_trade_date: string
}

export function pickEffective<T extends EffectiveRow>(
  rows: readonly T[],
  tradeDate: string,
): Map<string, T> {
  const best = new Map<string, T>()
  for (const row of rows) {
    if (row.effective_trade_date > tradeDate) continue
    const prev = best.get(row.key)
    if (!prev || row.version > prev.version) best.set(row.key, row)
  }
  return best
}
