import 'server-only'

/**
 * KIS 계좌 조회 — **조회만 한다** (명세 M1)
 *
 * 부를 수 있는 것은 `KIS_ACCOUNT_QUERIES` 뿐이고, 그 표에 주문은 없다.
 * 조회와 주문은 같은 `/trading/` 경로 아래 살고 TR 앞 네 글자도 겹친다 —
 * 가르는 것은 **끝 글자**다(조회 `R`, 주문 `U`). 그 규칙을
 * `lib/policy/trading-no-order-guard.test.ts` 가 이 파일을 훑으며 지킨다.
 *
 * 값 읽기·계좌번호 가리기·실패 분류는 전부 `account-request.ts` 의 순수 함수다.
 * 여기는 왕복과 순서만 맡는다.
 */

import { createRateQueue, type RateQueue } from './rate-queue.ts'
import { readEnvelope, type KisAuth, type KisEnvelope } from './kis-request.ts'
import { type KisEnv, type KisAccountKey } from './endpoints.ts'
import {
  accountKeyFor, accountTrId, accountHeaders, accountUrl, accountFailure,
  balanceParams, fillsParams, depositParams,
  parseBalance, parseFills, parseDeposit, openQuantity,
  type AccountRef, type AccountFailure, type Position, type Fill, type DepositSummary,
} from './account-request.ts'

export type AccountResult<T> = { ok: true; value: T } | ({ ok: false } & AccountFailure)

export interface AccountClientOptions {
  env: KisEnv
  auth: KisAuth
  acct: AccountRef
  minIntervalMs: number
  /** 야간 세션인가. 밤이면 밤 TR 을 부른다 */
  isNight?: boolean
}

async function call<T>(
  queue: RateQueue, env: KisEnv, auth: KisAuth,
  key: KisAccountKey, params: Record<string, string>,
): Promise<AccountResult<KisEnvelope<T>>> {
  const tr = accountTrId(key, env)
  if (!tr.ok) {
    return {
      ok: false,
      ...accountFailure('paper_unsupported', key),
      userMessage: '모의투자 계좌로는 이 조회를 할 수 없습니다',
    }
  }
  return queue.run(async () => {
    let response: Response
    try {
      response = await fetch(accountUrl(env, key, params), {
        method: 'GET',
        headers: accountHeaders(auth, tr.trId),
        cache: 'no-store',
      })
    } catch (error) {
      return {
        ok: false as const,
        ...accountFailure('network', error instanceof Error ? error.name : 'unknown'),
      }
    }
    const body = (await response.json().catch(() => null)) as KisEnvelope<T> | null
    const failure = readEnvelope(body, response.status)
    if (failure) return { ok: false as const, ...accountFailure('kis', failure.reason) }
    return { ok: true as const, value: body as KisEnvelope<T> }
  })
}

export interface AccountClient {
  /** 지금 들고 있는 것 */
  positions(): Promise<AccountResult<Position[]>>
  /** 그날의 체결 */
  fills(tradeDate: string): Promise<AccountResult<Fill[]>>
  /** 아직 안 채워진 주문 */
  openOrders(tradeDate: string): Promise<AccountResult<Fill[]>>
  /** 예수금·증거금 */
  deposit(): Promise<AccountResult<DepositSummary>>
}

export function createAccountClient(options: AccountClientOptions): AccountClient {
  const queue = createRateQueue({ minIntervalMs: options.minIntervalMs })
  const { env, auth, acct } = options
  const night = options.isNight ?? false
  const keyOf = (base: KisAccountKey) => accountKeyFor(base, night)

  return {
    async positions() {
      const r = await call<unknown[]>(queue, env, auth, keyOf('balance'), balanceParams(acct))
      if (!r.ok) return r
      return { ok: true, value: parseBalance((r.value.output1 ?? []) as unknown[]) }
    },

    async fills(tradeDate) {
      const r = await call<unknown[]>(queue, env, auth, keyOf('fills'),
        fillsParams({ acct, startDate: tradeDate, endDate: tradeDate, which: 'filled' }))
      if (!r.ok) return r
      return { ok: true, value: parseFills((r.value.output1 ?? []) as unknown[]) }
    },

    async openOrders(tradeDate) {
      const r = await call<unknown[]>(queue, env, auth, keyOf('fills'),
        fillsParams({ acct, startDate: tradeDate, endDate: tradeDate, which: 'open' }))
      if (!r.ok) return r
      // KIS 가 미체결로 준 것 중에서도 남은 수량이 0 인 줄이 온다. 그것은 미체결이 아니다
      return { ok: true, value: parseFills((r.value.output1 ?? []) as unknown[]).filter((f) => openQuantity(f) > 0) }
    },

    async deposit() {
      const r = await call<unknown>(queue, env, auth, 'deposit', depositParams(acct))
      if (!r.ok) return r
      return { ok: true, value: parseDeposit(r.value.output2 ?? r.value.output ?? r.value.output1) }
    },
  }
}
