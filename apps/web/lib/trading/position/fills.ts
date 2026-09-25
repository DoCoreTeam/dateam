import 'server-only'

/**
 * 체결을 읽어 적는다 (1-C 「KIS 체결 인식·대조」)
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * `AccountClient.fills` 는 1-C 에서 만들어 시험까지 붙였는데 **부르는 자리가 없었다.**
 * 그래서 `trading_fills` 는 한 줄도 안 쌓였고, 우리 기록이 비어 있으니
 * 계좌 대조는 언제나 「계좌에만 있다」로 어긋났고 실현 손익은 언제나 0원이었다.
 * 배선 가드는 함수 이름만 봐서 객체 메서드를 못 봤다 — 그 구멍은 같은 판 마지막 항목에서 막는다.
 *
 * ## 실패해도 안 던진다
 *
 * 체결 조회는 매분 도는 일의 곁가지다. 여기서 던지면 그 분의 수집과 판단이 통째로 죽는다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { toFillRows, openOrderNosOf } from './fills-core.ts'
import type { AccountClient } from '../broker/account.ts'
import type { Fill } from '../broker/account-request.ts'

export interface SyncFillsResult {
  /** 이번에 넣거나 갱신한 줄 수 */
  saved: number
  /** 아직 안 채워진 주문번호들 */
  openOrderNos: string[]
  /** 무슨 일이 있었나. 실행 기록에 그대로 실린다 */
  reason: string
}

export async function syncFills(
  account: AccountClient, tradeDate: string, now: Date,
): Promise<SyncFillsResult> {
  const filled = await account.fills(tradeDate)
  if (!filled.ok) {
    return { saved: 0, openOrderNos: [], reason: `fills_failed:${filled.reason}` }
  }
  const open = await account.openOrders(tradeDate)
  // 미체결 조회만 실패하면 체결은 그대로 적는다 — 둘은 다른 사실이다
  const openNos = open.ok ? openOrderNosOf(open.value) : []

  const saved = await saveFills(filled.value, now)
  const openNote = open.ok ? '' : `,open_failed:${open.reason}`
  return {
    saved,
    openOrderNos: openNos,
    reason: `fills:${saved}/${filled.value.length}${openNote}`,
  }
}

/**
 * 표에 넣는다. 같은 체결이 두 번 안 들어간다 — PK `(order_no, fill_seq)` 로 덮어쓴다.
 *
 * `first_seen_at` 은 **넘기지 않는다.** 처음 본 시각은 처음 넣을 때 DB 기본값이 정하고,
 * 다시 볼 때마다 갱신되면 상한이 뒤로 밀려 「언제 체결됐나」의 범위가 넓어지기만 한다.
 */
export async function saveFills(fills: readonly Fill[], now: Date): Promise<number> {
  const rows = toFillRows(fills)
  if (rows.length === 0) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_fills').upsert(
    rows.map((r) => ({
      order_no: r.orderNo,
      fill_seq: r.fillSeq,
      contract_code: r.contractCode,
      side: r.side,
      quantity: r.quantity,
      price: r.price,
      order_at: r.orderAt,
      filled_at: r.filledAt,
      fee_krw: r.feeKrw,
      synced_at: now.toISOString(),
    })),
    { onConflict: 'order_no,fill_seq' },
  )
  if (error) throw new Error(`체결을 적지 못했습니다: ${error.message}`)
  return rows.length
}
