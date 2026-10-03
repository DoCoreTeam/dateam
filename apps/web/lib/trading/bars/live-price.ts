import 'server-only'

/**
 * 실시간 현재가 한 번 — 저장값 확인 → 분산 슬롯 선점 → KIS 조회 → 같은 표에 저장.
 *
 * 탭마다 SSE 연결이 하나씩 생겨도 KIS 는 설정 주기당 한 번만 불러야 한다. 저장값 나이를
 * 읽는 것만으로는 동시 요청이 모두 같은 묵은 값을 보고 함께 나가는 경쟁 조건이 생긴다.
 * 그래서 기존 `record_public_hit` 의 원자적 시간창 카운터를 분산 슬롯으로 재사용한다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { recordSystemEvent } from '@/lib/system-log/record'
import { kstTodayKey } from '@/lib/datetime/kst'
import { loadTradingSettings } from '../settings/store.ts'
import { loadTodayContractCode } from '../contracts/today-contract.ts'
import { getAccessToken } from '../broker/token.ts'
import { loadAppCredential } from '../broker/credentials.ts'
import { createKisClient } from '../broker/kis-client.ts'
import { liveWindowAt } from '../live-window.ts'
import { loadLastPrice, saveLastPrice, type LastPrice } from './last-price.ts'
import {
  isLivePriceFresh,
  livePricePushSeconds,
  priceFromKis,
  type LivePricePayload,
} from './live-price-core.ts'

export interface LivePriceContext {
  contractCode: string
  pushSeconds: number
  env: 'real' | 'paper'
  tokenRefreshMarginMinutes: number
  minIntervalMs: number
}

export type LivePriceRead =
  | { ok: true; price: LivePricePayload | null; source: 'cache' | 'broker' | 'follower' | 'closed' }
  | { ok: false; price: LivePricePayload | null; reason: string }

function numberSetting(values: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = Number(values[key])
  return Number.isFinite(value) ? value : fallback
}

export async function loadLivePriceContext(now: Date): Promise<LivePriceContext | null> {
  /*
    **월물은 `loadTodayContractCode` 하나에게만 묻는다.** 이 자리가 `is_front` 를 직접
    읽던 동안 수집은 그날 굳힌 월물을 모으고 있었고, 둘이 갈라진 날 화면의 현재가와
    쌓인 봉이 서로 다른 종목이 됐다(실측 2026-10-02).

    설정을 먼저 읽는다 — 덮어쓰기 값이 그 규칙의 첫 줄이라 월물 조회와 나란히 못 보낸다.
  */
  const { values } = await loadTradingSettings(kstTodayKey(now))
  const contractCode = await loadTodayContractCode(
    String(values.front_contract_code_override ?? ''),
    now,
  )
  if (!contractCode) return null
  return {
    contractCode,
    pushSeconds: livePricePushSeconds(values.price_push_seconds),
    env: values.kis_env === 'paper' ? 'paper' : 'real',
    tokenRefreshMarginMinutes: numberSetting(values, 'kis_token_refresh_margin_minutes', 30),
    minIntervalMs: numberSetting(values, 'kis_min_interval_ms', 200),
  }
}

/**
 * 설정 주기의 이번 시간창을 한 연결만 맡는다.
 * 계측 DB가 실패하면 외부 호출은 fail-closed 한다 — 실패 때 모두 통과시키면 한도 장치가 아니다.
 */
export async function claimLivePriceSlot(context: LivePriceContext): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('record_public_hit', {
    p_bucket: `trading-price:${context.contractCode}`,
    p_window_seconds: context.pushSeconds,
    p_keep_windows: 20,
  })
  if (error) {
    await noteFailure(new Error(`실시간 가격 슬롯 선점 실패: ${error.message}`), 'slot_failed')
    return false
  }
  const row = Array.isArray(data) ? data[0] : data
  return Number(row?.out_hits) === 1
}

function payload(last: LastPrice | null): LivePricePayload | null {
  return last
    ? { contractCode: last.contractCode, price: last.price, observedAt: last.observedAt }
    : null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function readLivePrice(
  context: LivePriceContext,
  now: Date,
  runId: string,
): Promise<LivePriceRead> {
  const cached = await loadLastPrice(context.contractCode)
  if (!liveWindowAt(now).live) return { ok: true, price: payload(cached), source: 'closed' }
  if (isLivePriceFresh(cached, now, context.pushSeconds)) {
    return { ok: true, price: payload(cached), source: 'cache' }
  }

  const mine = await claimLivePriceSlot(context)
  if (!mine) {
    // 선점한 연결이 쓰기를 끝낼 짧은 틈을 준 뒤 같은 저장값을 읽는다.
    await wait(Math.min(250, Math.max(80, context.minIntervalMs)))
    const followed = await loadLastPrice(context.contractCode)
    return { ok: true, price: payload(followed ?? cached), source: 'follower' }
  }

  const token = await getAccessToken({
    env: context.env,
    refreshMarginMinutes: context.tokenRefreshMarginMinutes,
    runId,
    now,
  })
  if (!token.ok) return failure(cached, token.reason)

  const credential = await loadAppCredential(context.env)
  if (!credential) return failure(cached, 'no_credential')

  const kis = createKisClient({
    env: context.env,
    auth: {
      accessToken: token.accessToken,
      appKey: credential.appKey,
      appSecret: credential.appSecret,
    },
    minIntervalMs: context.minIntervalMs,
    requestTimeoutMs: 5_000,
  })
  const result = await kis.price(context.contractCode)
  if (!result.ok) return failure(cached, result.reason)

  const price = priceFromKis(result.value.futs_prpr)
  if (price === null) return failure(cached, 'invalid_price')

  const observedAt = new Date()
  const saved = await saveLastPrice(context.contractCode, price, observedAt)
  if (!saved.saved) {
    await noteFailure(new Error(saved.reason), 'save_failed')
  }
  return {
    ok: true,
    price: { contractCode: context.contractCode, price, observedAt: observedAt.toISOString() },
    source: 'broker',
  }
}

async function failure(cached: LastPrice | null, reason: string): Promise<LivePriceRead> {
  await noteFailure(new Error(reason), reason)
  return { ok: false, price: payload(cached), reason }
}

async function noteFailure(error: Error, hint: string): Promise<void> {
  await recordSystemEvent({
    source: 'host_api',
    feature: 'trading/live-price',
    route: '/api/trading/price/stream',
    error,
    blocksUser: false,
    hint,
  })
}
