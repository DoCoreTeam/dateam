import 'server-only'

/**
 * 내가 적은 진입 기록 읽고 쓰기 (마이그 295)
 *
 * **서비스롤을 쓴다.** 표는 anon·authenticated 에게 권한이 없고 정책도 없어 전부 막혀 있다 —
 * 다른 `trading_*` 표와 같은 벽이다. 그래서 사람 확인은 **부르는 쪽**이 한다
 * (`app/(trading)/trading/actions.ts` 의 `tradingAccess()`).
 *
 * 그 확인이 위에 있다는 사실이 이 파일의 전제다. 여기서 또 확인하면 두 판정이 갈리고,
 * 갈리면 「화면은 열리는데 창구가 403」이 된다.
 *
 * 조건 없는 일괄 갱신을 안 만든다 — 모든 질의가 `user_id` 로 좁혀진다(S2).
 */

import { createAdminClient } from '@/lib/supabase/server'
import type { Direction } from './manual-entry.ts'

export interface ManualEntryRow {
  id: string
  direction: Direction
  entryPrice: number
  quantity: number
  stopPrice: number | null
  targetPrice: number | null
  enteredAt: string
}

/** 지금 열려 있는 줄. 없으면 null. 한 사람이 한 월물에 하나뿐이다(유일 인덱스) */
export async function loadOpenManualEntry(
  userId: string,
  contractCode: string,
): Promise<ManualEntryRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_manual_entries')
    .select('id, direction, entry_price, quantity, stop_price, target_price, entered_at')
    .eq('user_id', userId)
    .eq('contract_code', contractCode)
    .is('exited_at', null)
    .limit(1)
  if (error) throw new Error(`내가 적은 기록을 읽지 못했습니다: ${error.message}`)
  const row = (data ?? [])[0]
  if (!row) return null
  return {
    id: String(row.id),
    direction: row.direction as Direction,
    entryPrice: Number(row.entry_price),
    quantity: Number(row.quantity),
    stopPrice: row.stop_price === null ? null : Number(row.stop_price),
    targetPrice: row.target_price === null ? null : Number(row.target_price),
    enteredAt: String(row.entered_at),
  }
}

export async function insertManualEntry(input: {
  userId: string
  contractCode: string
  direction: Direction
  entryPrice: number
  quantity: number
  stopPrice: number | null
  targetPrice: number | null
  judgmentId: string | null
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_manual_entries').insert({
    user_id: input.userId,
    contract_code: input.contractCode,
    direction: input.direction,
    entry_price: input.entryPrice,
    quantity: input.quantity,
    stop_price: input.stopPrice,
    target_price: input.targetPrice,
    judgment_id: input.judgmentId,
  })
  // supabase-js 는 insert 오류를 던지지 않고 돌려준다. 안 보면 0건이 조용히 성공으로 보인다
  if (error) throw new Error(`기록하지 못했습니다: ${error.message}`)
}

/**
 * 그 줄을 닫는다. **id 와 user_id 를 함께 건다** —
 * id 만 걸면 남의 줄 id 를 아는 사람이 남의 줄을 닫을 수 있다.
 */
export async function closeManualEntry(input: {
  userId: string
  id: string
  exitPrice: number
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from('trading_manual_entries')
    .update({ exited_at: new Date().toISOString(), exit_price: input.exitPrice })
    .eq('id', input.id)
    .eq('user_id', input.userId)
    .is('exited_at', null)
  if (error) throw new Error(`닫지 못했습니다: ${error.message}`)
}
