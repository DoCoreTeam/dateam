import 'server-only'

/**
 * 자동 주문 — **열린 포지션 위험 바로 다음** (§10.2 · 설계 §4)
 *
 * 돈이 걸린 일이 곁가지(지식·운영자) 뒤로 밀리면 안 된다. 감시가 먼저이고,
 * 그 다음이 주문이고, 지식과 운영자는 그 뒤다.
 *
 * **무장이 안 됐으면 여기서 끝난다.** 그것이 지금까지(Release 1~3)와 같은 상태다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { armedNow, enforceDisarm } from '../order/arming.ts'
import { orderFailureStreak, ordersToday, placeOrder, unknownOrders, resolveUnknown } from '../order/place.ts'
import { shouldExit, exitOrderKind, entryAndExitArmTogether, type ExitContext } from '../order/exit-plan.ts'

import type { ArmContext, ArmEnv } from '../order/arming-policy.ts'
import type { AccountRef } from '../broker/account-request.ts'
import type { KisAuth } from '../broker/kis-request.ts'
import type { Session } from '../order/order-request.ts'

export interface OrderJobInput {
  now: Date
  env: ArmEnv
  session: Session
  auth: KisAuth
  acct: AccountRef | null
  /** 오늘의 시작·끝 (주문 수를 셀 구간) */
  dayStart: Date
  dayEnd: Date
  /** 멈추는 장치 문턱 */
  maxOrdersPerDay: number
  maxOrderFailureStreak: number
  /** 지금 상태 */
  reconciliationRequired: boolean
  protectionBreached: boolean
  /** 주문 직전에 다시 잴 관문 */
  armCtx: ArmContext
  /** 아직 주문 안 낸 신호. 없으면 진입 주문이 없다 */
  pendingEntry: {
    signalId: string
    contractCode: string
    direction: 'long' | 'short'
  } | null
  /** 들고 있는 포지션. 없으면 청산 주문이 없다 */
  openPosition: ({ signalId: string; contractCode: string } & ExitContext) | null
  /** 지금 계좌에 남은 미체결 주문번호. `unknown` 을 푸는 데 쓴다 */
  openOrderNos: readonly string[]
}

export interface OrderJobResult {
  reason: string
  placed: number
}

/**
 * 매분 한 걸음.
 *
 * 순서: 무장 확인 → 멈추는 장치 → 모르는 주문 확인 → **청산 먼저** → 진입.
 *
 * 청산이 진입보다 먼저인 이유: 들고 있는 것을 정리하는 일이 새로 드는 일보다 급하다.
 * 같은 분에 둘 다 할 수 있어도 청산을 먼저 낸다.
 */
export async function runOrderJob(input: OrderJobInput): Promise<OrderJobResult> {
  if (!input.acct) return { reason: 'order=no_account', placed: 0 }
  if (!(await armedNow(input.env, input.now))) return { reason: 'order=not_armed', placed: 0 }

  // 멈추는 장치. 하나라도 걸리면 여기서 풀리고 이번 분에는 아무것도 안 낸다
  const guard = await enforceDisarm(input.env, {
    expiresAt: await readExpiry(input.env),
    now: input.now,
    ordersToday: await ordersToday(input.env, input.dayStart, input.dayEnd),
    maxOrdersPerDay: input.maxOrdersPerDay,
    orderFailureStreak: await orderFailureStreak(input.env),
    maxOrderFailureStreak: input.maxOrderFailureStreak,
    reconciliationRequired: input.reconciliationRequired,
    protectionBreached: input.protectionBreached,
  })
  if (guard !== 'armed') return { reason: `order=${guard}`, placed: 0 }

  /**
   * 나갔는지 모르는 주문이 있으면 **그것부터 확인**한다. 확인 전에는 새로 안 낸다 —
   * 확인 안 하고 새 주문을 내면 그 둘이 같은 신호일 수 있다.
   */
  const unknowns = await unknownOrders(input.env, 5)
  if (unknowns.length > 0) {
    const resolved = await confirmUnknownOrders(input.env, input.openOrderNos, input.now)
    return { reason: `order=resolved_unknown:${resolved}`, placed: 0 }
  }

  /**
   * 무장은 진입과 청산을 **함께** 켠다(설계 §5). 나눌 수 있으면
   * 사람이 자리를 비운 사이에 들어간 포지션의 청산을 아무도 안 본다.
   */
  if (!entryAndExitArmTogether()) return { reason: 'order=entry_exit_split', placed: 0 }

  let placed = 0
  const notes: string[] = []

  // 청산이 먼저다 — 들고 있는 것을 정리하는 일이 새로 드는 일보다 급하다
  if (input.openPosition) {
    const hit = shouldExit(input.openPosition)
    if (hit) {
      const r = await placeOrder({
        env: input.env, session: input.session, auth: input.auth, acct: input.acct,
        signalId: input.openPosition.signalId,
        orderKind: exitOrderKind(),
        contractCode: input.openPosition.contractCode,
        // 청산은 들고 있는 것의 **반대**로 낸다
        direction: input.openPosition.direction === 'long' ? 'short' : 'long',
        trigger: hit.trigger,
        now: input.now,
        armCtx: input.armCtx,
      })
      if (r.placed) placed += 1
      notes.push(`exit:${hit.trigger}:${r.placed ? 'placed' : r.reason}`)
    }
  }

  if (input.pendingEntry) {
    const r = await placeOrder({
      env: input.env, session: input.session, auth: input.auth, acct: input.acct,
      signalId: input.pendingEntry.signalId,
      orderKind: 'entry',
      contractCode: input.pendingEntry.contractCode,
      direction: input.pendingEntry.direction,
      trigger: 'signal',
      now: input.now,
      armCtx: input.armCtx,
    })
    if (r.placed) placed += 1
    notes.push(`entry:${r.placed ? 'placed' : r.reason}`)
  }

  return {
    reason: `order=${notes.length > 0 ? notes.join(',') : 'nothing_to_do'}`,
    placed,
  }
}

async function readExpiry(env: ArmEnv): Promise<Date> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_arming').select('expires_at').eq('env', env).maybeSingle()
  if (error) throw new Error(`무장 만료를 읽지 못했습니다: ${error.message}`)
  // 행이 없으면 **이미 만료**다. 모르면 막는 쪽
  return data ? new Date(data.expires_at) : new Date(0)
}

/**
 * 나갔는지 모르는 주문을 미체결 조회로 확인한다.
 *
 * **다시 주문해서 확인하지 않는다.** 부르는 쪽이 미체결 목록을 넘겨 준다.
 */
export async function confirmUnknownOrders(
  env: ArmEnv, openOrderNos: readonly string[], now: Date,
): Promise<number> {
  const pending = await unknownOrders(env, 20)
  let resolved = 0
  for (const order of pending) {
    // 주문번호를 못 받았으므로 종목으로 짝을 짓는다. 1계약·한 종목이라 이것으로 충분하다
    const found = openOrderNos.length > 0
    await resolveUnknown(order.id, found, found ? (openOrderNos[0] ?? null) : null, now)
    resolved += 1
  }
  return resolved
}
