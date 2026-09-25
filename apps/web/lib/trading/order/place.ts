import 'server-only'

/**
 * 주문 보내기 — **멱등하고, 재시도하지 않는다** (설계 §4)
 *
 * ## 왜 재시도를 안 하나
 *
 * 주문은 되돌릴 수 없다. 응답을 못 받았을 때 「안 나갔겠지」로 다시 부르면 **두 번 나간다.**
 * 그리고 두 번 나간 사실은 체결이 돌아와야 안다 — 그때는 이미 2계약이다.
 *
 * 그래서 응답이 불확실하면 `unknown` 으로 두고, **미체결 조회로 사실을 확인**한다.
 * 확인될 때까지 그 신호는 아무것도 안 한다.
 *
 * ## 왜 선점이 먼저인가
 *
 * 크론이 겹치면 두 실행이 같은 신호를 본다. 유일 키로 행을 **먼저** 넣고,
 * 넣는 데 성공한 실행만 KIS 를 부른다. 다른 실행은 유일 키에 걸려 아무것도 안 보낸다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { armedNow } from './arming.ts'
import { checkArming, type ArmContext, type ArmEnv } from './arming-policy.ts'
import {
  buildPlaceOrder, orderTrId, orderUrl, orderHeaders, readOrderNo, describeOrder,
  type Session,
} from './order-request.ts'
import type { AccountRef } from '../broker/account-request.ts'
import type { KisAuth } from '../broker/kis-request.ts'

export type OrderKind = 'entry' | 'exit'

export interface PlaceInput {
  env: ArmEnv
  session: Session
  auth: KisAuth
  acct: AccountRef
  signalId: string
  orderKind: OrderKind
  contractCode: string
  direction: 'long' | 'short'
  /** 무엇 때문에 내나 — signal · stop · target · time · session_close */
  trigger: string
  now: Date
  /** 주문 직전에 다시 재는 관문 */
  armCtx: ArmContext
}

export type PlaceResult =
  | { placed: true; orderNo: string; detail: string }
  /** 이미 낸 주문이거나, 낼 수 없는 상태다. **오류가 아니다** */
  | { placed: false; reason: string; userMessage: string }
  /** 나갔는지 모른다. **다시 안 부른다** — 미체결 조회로만 확인한다 */
  | { placed: false; reason: 'unknown'; userMessage: string; unknown: true }

const UNKNOWN_MESSAGE = '주문이 나갔는지 확인하지 못했습니다. 미체결 조회로 확인한 뒤 판단합니다'

/**
 * 한 번 낸다.
 *
 * 순서가 규칙이다: 무장 확인 → 관문 재측정 → 선점 → 호출 → 결과 기록.
 * 앞을 건너뛰면 그 건너뛴 자리가 돈이 나가는 자리다.
 */
export async function placeOrder(input: PlaceInput): Promise<PlaceResult> {
  // ① 무장했나. 만료까지 본다
  if (!(await armedNow(input.env, input.now))) {
    return { placed: false, reason: 'not_armed', userMessage: '자동 주문이 무장되지 않았습니다' }
  }

  /**
   * ② 관문을 **다시** 잰다. 무장은 하루를 가는데 그 사이에 관문이 깨질 수 있다 —
   * 무장할 때 한 번만 재면 「아침에 멀쩡했으니 하루 종일 멀쩡하다」가 된다.
   */
  const gate = checkArming(input.armCtx)
  if (!gate.allowed) {
    return {
      placed: false,
      reason: `gate:${gate.blocks.map((b) => b.check).join('+')}`,
      userMessage: gate.blocks.map((b) => b.userMessage).join(' · '),
    }
  }

  const tr = orderTrId('place', input.env, input.session)
  if (!tr.ok) {
    return { placed: false, reason: tr.reason, userMessage: '모의투자로는 야간 주문을 낼 수 없습니다' }
  }

  const built = buildPlaceOrder({
    acct: input.acct,
    contractCode: input.contractCode,
    direction: input.direction,
    quantity: 1,
    unitPrice: 0,
    // 사람 지연이 없어졌으므로 시장가로 낸다. 진입 한계가는 신호가 이미 정했다
    priceType: 'market',
  })
  if (!built.ok) return { placed: false, reason: built.reason, userMessage: built.userMessage }

  // ③ 선점 — 넣는 데 성공한 실행만 KIS 를 부른다
  const claimed = await claimOrder(input)
  if (!claimed) {
    return { placed: false, reason: 'already_placed', userMessage: '이미 낸 주문입니다' }
  }

  // ④ 한 번만 부른다. **재시도 루프가 없다**
  let response: Response
  try {
    response = await fetch(orderUrl(input.env, 'place'), {
      method: 'POST',
      headers: orderHeaders(input.auth, tr.trId),
      body: JSON.stringify(built.body),
      cache: 'no-store',
    })
  } catch (error) {
    /**
     * 연결이 끊겼다. **나갔는지 모른다** — 요청이 서버에 닿았을 수도 있다.
     * 다시 부르지 않는다.
     */
    await finishOrder(claimed, {
      status: 'unknown',
      reason: `network:${error instanceof Error ? error.name : 'unknown'}`,
      orderNo: null,
      now: input.now,
    })
    return { placed: false, reason: 'unknown', userMessage: UNKNOWN_MESSAGE, unknown: true }
  }

  const body = (await response.json().catch(() => null)) as
    { rt_cd?: string; msg1?: string; output?: unknown } | null

  if (!response.ok || body === null) {
    // HTTP 가 실패해도 주문이 들어갔을 수 있다. 확실하지 않으면 unknown 이다
    await finishOrder(claimed, {
      status: 'unknown', reason: `http:${response.status}`, orderNo: null, now: input.now,
    })
    return { placed: false, reason: 'unknown', userMessage: UNKNOWN_MESSAGE, unknown: true }
  }

  if (body.rt_cd !== '0') {
    /**
     * KIS 가 명시적으로 거절했다. 이것은 **확실한 실패**다 —
     * 거절 응답을 받았다는 것은 주문이 안 들어갔다는 뜻이다.
     */
    await finishOrder(claimed, {
      status: 'failed', reason: `kis:${body.rt_cd ?? 'none'}`, orderNo: null, now: input.now,
    })
    return { placed: false, reason: `kis_rejected:${body.rt_cd}`, userMessage: '증권사가 주문을 거절했습니다' }
  }

  const orderNo = readOrderNo(body.output)
  if (!orderNo) {
    // 성공이라는데 번호가 없다. 나갔는지 모른다
    await finishOrder(claimed, {
      status: 'unknown', reason: 'no_order_no', orderNo: null, now: input.now,
    })
    return { placed: false, reason: 'unknown', userMessage: UNKNOWN_MESSAGE, unknown: true }
  }

  await finishOrder(claimed, { status: 'sent', reason: 'placed', orderNo, now: input.now })
  return { placed: true, orderNo, detail: describeOrder(built.body) }
}

/** 선점. 유일 키에 걸리면 남이 이미 이 신호를 맡았다 */
async function claimOrder(input: PlaceInput): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('trading_orders').insert({
    signal_id: input.signalId,
    order_kind: input.orderKind,
    env: input.env,
    contract_code: input.contractCode,
    direction: input.direction,
    quantity: 1,
    unit_price: 0,
    trigger: input.trigger,
    status: 'pending',
    requested_at: input.now.toISOString(),
  }).select('id')
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return null
    throw new Error(`주문을 선점하지 못했습니다: ${error.message}`)
  }
  return ((data ?? [])[0]?.id as string | undefined) ?? null
}

async function finishOrder(id: string, input: {
  status: 'sent' | 'failed' | 'unknown'
  reason: string
  orderNo: string | null
  now: Date
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from('trading_orders').update({
    status: input.status,
    reason: input.reason.slice(0, 300),
    broker_order_no: input.orderNo,
    user_message: input.status === 'unknown' ? UNKNOWN_MESSAGE : null,
    responded_at: input.now.toISOString(),
  }).eq('id', id)
  if (error) throw new Error(`주문 결과를 적지 못했습니다: ${error.message}`)
}

/** 나갔는지 모르는 주문들. 미체결 조회가 이것을 확인한다 */
export async function unknownOrders(env: ArmEnv, limit = 20): Promise<
  { id: string; signalId: string; contractCode: string; requestedAt: Date }[]
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_orders')
    .select('id, signal_id, contract_code, requested_at')
    .eq('env', env)
    .eq('status', 'unknown')
    .order('requested_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`확인 못 한 주문을 읽지 못했습니다: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    signalId: String(r.signal_id),
    contractCode: String(r.contract_code),
    requestedAt: new Date(r.requested_at),
  }))
}

/**
 * 미체결 조회로 확인한 결과를 적는다.
 *
 * **여기서만** `unknown` 이 풀린다 — 다시 주문해서 확인하지 않는다.
 */
export async function resolveUnknown(
  id: string, found: boolean, orderNo: string | null, now: Date,
): Promise<void> {
  await finishOrder(id, {
    status: found ? 'sent' : 'failed',
    reason: found ? 'confirmed_by_open_orders' : 'not_found_in_open_orders',
    orderNo,
    now,
  })
}

/** 연속 주문 실패 수 (멈추는 장치). 최근 것부터 세고 성공을 만나면 멈춘다 */
export async function orderFailureStreak(env: ArmEnv, limit = 20): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_orders')
    .select('status')
    .eq('env', env)
    .order('requested_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`주문 기록을 읽지 못했습니다: ${error.message}`)
  let streak = 0
  for (const row of (data ?? []) as { status: string }[]) {
    if (row.status === 'sent') break
    if (row.status === 'failed' || row.status === 'unknown') streak += 1
  }
  return streak
}

/** 오늘 낸 주문 수 (멈추는 장치) */
export async function ordersToday(env: ArmEnv, from: Date, to: Date): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { count, error } = await admin
    .from('trading_orders')
    .select('id', { count: 'exact', head: true })
    .eq('env', env)
    .gte('requested_at', from.toISOString())
    .lt('requested_at', to.toISOString())
  if (error) throw new Error(`주문 수를 세지 못했습니다: ${error.message}`)
  return count ?? 0
}
