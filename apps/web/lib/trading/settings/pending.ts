/**
 * 지금 쓰는 값과 **예약된 값** — 순수 함수
 *
 * ## 왜 필요한가 (실측 2026-09-27)
 *
 * 설정은 **다음 거래일부터** 듣는다(§15.2). 그런데 설정 화면은 **오늘 유효한 값**을 그린다.
 * 그래서 값을 고쳐 저장하면 「판 N으로 저장했습니다」가 뜨는데 입력칸은 옛 값 그대로이고,
 * 새로고침하면 방금 넣은 값이 **사라진 것처럼** 보인다.
 *
 * 저장은 제대로 됐다. 화면이 그 사실을 못 말할 뿐이다 — 그런데 사용자에게는
 * 「저장이 안 됐다」와 구별되지 않는다. 그리고 한 번 그렇게 보이면 같은 값을 몇 번 더 누른다.
 *
 * ## 왜 순수 함수인가
 *
 * 틀리기 쉬운 것은 고르기다(`pick-effective.ts` 와 같은 이유). 「오늘 것보다 판이 큰데
 * 유효일이 아직 안 온 줄」을 골라내는 규칙은 DB 없이 시험할 수 있어야 한다.
 */

import { pickEffective, type EffectiveRow } from './pick-effective.ts'
import type { TradingSettingValue } from './registry.ts'

export interface PendingChange {
  /** 오늘 판단에 쓰이는 값 */
  current: TradingSettingValue | undefined
  /** 아직 유효일이 안 온 가장 큰 판의 값. 없으면 null */
  next: TradingSettingValue | null
  /** 그 예약이 언제부터인가. `next` 가 null 이면 null */
  from: string | null
}

/**
 * 키마다 「지금 값」과 「예약된 값」을 함께 돌려준다.
 *
 * @param rows 그 키들의 판 전부 (유효일 제한 없이 읽은 것)
 * @param tradeDate 오늘 거래일 `YYYY-MM-DD`
 */
export function pendingByKey<T extends EffectiveRow>(
  rows: readonly T[],
  tradeDate: string,
): Map<string, PendingChange> {
  const effective = pickEffective(rows, tradeDate)

  /** 키마다 **유효일이 아직 안 온 줄 중 판이 가장 큰 것**. 저장기가 판을 올려 쌓으므로 그것이 마지막 뜻이다 */
  const reserved = new Map<string, T>()
  for (const row of rows) {
    if (row.effective_trade_date <= tradeDate) continue
    const prev = reserved.get(row.key)
    if (!prev || row.version > prev.version) reserved.set(row.key, row)
  }

  const out = new Map<string, PendingChange>()
  for (const key of new Set(rows.map((r) => r.key))) {
    const next = reserved.get(key)
    out.set(key, {
      current: effective.get(key)?.value,
      next: next ? next.value : null,
      from: next ? next.effective_trade_date : null,
    })
  }
  return out
}

/**
 * 화면이 입력칸에 넣을 값.
 *
 * **예약이 있으면 예약된 값**이다 — 사용자가 고치려는 대상은 「다음에 쓸 값」이지
 * 「오늘 쓰는 값」이 아니다. 오늘 값은 그 옆에서 따로 말한다.
 */
export function editingValue(p: PendingChange | undefined): TradingSettingValue | undefined {
  if (!p) return undefined
  return p.next !== null ? p.next : p.current
}
